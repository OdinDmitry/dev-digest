import type { EvalCase, EvalCaseInput, EvalCaseSeed, EvalCaseUpdate, EvalExpectation } from '@devdigest/shared';
import { sliceDiff } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import type { AgentsRepository } from '../agents/repository.js';
import type { RepoRepository } from '../repos/repository.js';
import type { ReviewRepository } from '../reviews/repository.js';
import { loadDiff } from '../reviews/diff-loader.js';
import type { EvalRepository } from './repository/index.js';
import {
  caseRowToDto,
  resolveExpectations,
  seedExpectationFrom,
  type EvalSeedFinding,
} from './helpers.js';
import {
  AGENT_NOT_FOUND_MESSAGE,
  EVAL_CASE_NOT_FOUND_MESSAGE,
  REPO_NOT_FOUND_MESSAGE,
  FINDING_NOT_FOUND_MESSAGE,
  FINDING_NOT_DECIDED_MESSAGE,
} from './constants.js';

/** Body accepted by `POST /findings/:id/eval-case` — `owner_id`/`repo_id` are
 *  deliberately absent; both are derived server-side (AC-5, AC-46). */
export interface CreateEvalCaseFromFindingInput {
  name: string;
  input_diff?: string;
  expectations?: EvalExpectation[];
  notes?: string | null;
}

/**
 * modules/evals/service.ts — ring 2 use cases. Explicit deps
 * (`onion-architecture` "Dependencies of a service"); `container` is
 * narrowed to `Pick<Container, 'git' | 'config'>` because `loadDiff`
 * (`modules/reviews/diff-loader.ts`, read-only reference pattern, never
 * modified) reads `container.git` — see the plan's Decision 5. `loadDiff`'s
 * own parameter type is the full `Container`, so the narrowed dep is cast
 * back at the two call sites below; it is never widened on this class.
 *
 * Every method takes `workspaceId` first and enforces it on every branch —
 * including early returns — either directly (`NotFoundError` before any
 * other read) or by relying on an already workspace-scoped repository call.
 */
export interface EvalServiceDeps {
  repo: EvalRepository;
  agents: AgentsRepository;
  repos: RepoRepository;
  reviews: ReviewRepository;
  container: Pick<Container, 'git' | 'config'>;
}

export class EvalService {
  constructor(private deps: EvalServiceDeps) {}

  async listCases(workspaceId: string, agentId: string): Promise<EvalCase[]> {
    const agent = await this.deps.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError(AGENT_NOT_FOUND_MESSAGE);

    const rows = await this.deps.repo.listForAgent(workspaceId, agentId);
    const dtos: EvalCase[] = [];
    for (const row of rows) {
      const repoFullName = await this.repoFullName(workspaceId, row.repoId);
      // last_outcome is always null in this phase — Phase B's run history
      // is what populates it (AC-34).
      dtos.push(caseRowToDto(row, repoFullName, null));
    }
    return dtos;
  }

  async createCase(workspaceId: string, agentId: string, input: EvalCaseInput): Promise<EvalCase> {
    const agent = await this.deps.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError(AGENT_NOT_FOUND_MESSAGE);

    const expectations = resolveExpectations(null, input.expectations);
    const repoFullName = await this.assertRepo(workspaceId, input.repo_id);

    const row = await this.deps.repo.createCase({
      workspaceId,
      ownerId: agentId,
      name: input.name,
      inputDiff: input.input_diff,
      repoId: input.repo_id,
      expectations,
      notes: input.notes ?? null,
    });
    return caseRowToDto(row, repoFullName, null);
  }

  async updateCase(workspaceId: string, id: string, patch: EvalCaseUpdate): Promise<EvalCase> {
    const existing = await this.deps.repo.getCaseById(workspaceId, id);
    if (!existing) throw new NotFoundError(EVAL_CASE_NOT_FOUND_MESSAGE);

    const storedExpectations = (existing.expectedOutput as EvalExpectation[] | null) ?? [];
    const expectations = resolveExpectations(storedExpectations, patch.expectations);

    const repoFullName =
      patch.repo_id !== undefined
        ? await this.assertRepo(workspaceId, patch.repo_id)
        : await this.repoFullName(workspaceId, existing.repoId);

    const row = await this.deps.repo.updateCase(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.input_diff !== undefined ? { inputDiff: patch.input_diff } : {}),
      ...(patch.repo_id !== undefined ? { repoId: patch.repo_id } : {}),
      expectations,
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    });
    if (!row) throw new NotFoundError(EVAL_CASE_NOT_FOUND_MESSAGE);
    return caseRowToDto(row, repoFullName, null);
  }

  async deleteCase(workspaceId: string, id: string): Promise<void> {
    const ok = await this.deps.repo.deleteCase(workspaceId, id);
    if (!ok) throw new NotFoundError(EVAL_CASE_NOT_FOUND_MESSAGE);
  }

  /** AC-1/AC-3/AC-4 — the prefill for the eval-case dialog opened from a
   *  finding. Persists nothing. */
  async seedFromFinding(workspaceId: string, findingId: string): Promise<EvalCaseSeed> {
    const { finding, agentId, pullId, pullNumber, pullRow, repoRow } =
      await this.requireFindingOrigin(workspaceId, findingId);

    const diff = await loadDiff(
      this.deps.container as unknown as Container,
      this.deps.reviews,
      workspaceId,
      pullRow,
      repoRow,
    );

    return {
      agent_id: agentId!,
      agent_name: (await this.deps.agents.getById(workspaceId, agentId!))!.name,
      repo_id: repoRow.id,
      repo_full_name: repoRow.fullName,
      name: finding.title,
      input_diff: sliceDiff(diff, finding.file),
      expectations: [seedExpectationFrom(finding)],
      origin: {
        finding_id: finding.id,
        pr_id: pullId,
        pr_number: pullNumber,
        finding_title: finding.title,
      },
    };
  }

  /** AC-5/AC-46 — `owner_id`/`repo_id` are derived here, never read from the
   *  request body. */
  async createFromFinding(
    workspaceId: string,
    findingId: string,
    body: CreateEvalCaseFromFindingInput,
  ): Promise<EvalCase> {
    const { finding, agentId, pullId, pullRow, repoRow } = await this.requireFindingOrigin(
      workspaceId,
      findingId,
    );

    const expectations =
      body.expectations !== undefined
        ? resolveExpectations(null, body.expectations)
        : [seedExpectationFrom(finding)];

    let inputDiff = body.input_diff;
    if (inputDiff === undefined) {
      const diff = await loadDiff(
        this.deps.container as unknown as Container,
        this.deps.reviews,
        workspaceId,
        pullRow,
        repoRow,
      );
      inputDiff = sliceDiff(diff, finding.file);
    }

    const row = await this.deps.repo.createCase({
      workspaceId,
      ownerId: agentId!,
      name: body.name,
      inputDiff,
      repoId: repoRow.id,
      expectations,
      notes: body.notes ?? null,
      originFindingId: finding.id,
      originPrId: pullId,
    });
    return caseRowToDto(row, repoRow.fullName, null);
  }

  // ---- internal -----------------------------------------------------------

  /** Resolve + validate a finding's origin for both seed and create-from
   *  paths: workspace guard, "has been decided" guard, agent + repo lookup.
   *
   *  `db/rows.ts` row types (`FindingRow`/`ReviewRow`/`PullRow`) die at the
   *  repository boundary and must not cross into ring 2
   *  (`onion-architecture`, "What crosses each boundary") — so `finding` and
   *  the scalar `agentId`/`pullId`/`pullNumber` reads below are mapped out
   *  of `findingContext`'s row-shaped result right here, at the boundary
   *  where it's consumed. `pullRow` is the one exception: it is never read
   *  by this service, only forwarded into `loadDiff` — an accepted,
   *  documented seam into the do-not-modify `reviews/diff-loader.ts` helper
   *  (see the class doc comment above re: the `container` cast). */
  private async requireFindingOrigin(workspaceId: string, findingId: string) {
    const ctx = await this.deps.reviews.findingContext(findingId);
    if (!ctx || ctx.pull.workspaceId !== workspaceId) {
      throw new NotFoundError(FINDING_NOT_FOUND_MESSAGE);
    }

    const finding: EvalSeedFinding & { id: string; dismissedAt: Date | null } = {
      id: ctx.finding.id,
      file: ctx.finding.file,
      startLine: ctx.finding.startLine,
      endLine: ctx.finding.endLine,
      title: ctx.finding.title,
      severity: ctx.finding.severity,
      category: ctx.finding.category,
      acceptedAt: ctx.finding.acceptedAt,
      dismissedAt: ctx.finding.dismissedAt,
    };
    const agentId = ctx.review.agentId;
    const pullId = ctx.pull.id;
    const pullNumber = ctx.pull.number;
    const pullRepoId = ctx.pull.repoId;
    const pullRow = ctx.pull;

    // AC-2 — a finding neither accepted nor dismissed has no eval-case seed.
    if (finding.acceptedAt == null && finding.dismissedAt == null) {
      throw new ValidationError(FINDING_NOT_DECIDED_MESSAGE);
    }
    if (!agentId) throw new NotFoundError(AGENT_NOT_FOUND_MESSAGE);
    const agent = await this.deps.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError(AGENT_NOT_FOUND_MESSAGE);

    const repoRow = await this.deps.repos.getById(workspaceId, pullRepoId);
    if (!repoRow) throw new NotFoundError(REPO_NOT_FOUND_MESSAGE);

    return { finding, agentId, pullId, pullNumber, pullRow, repoRow };
  }

  private async repoFullName(workspaceId: string, repoId: string | null): Promise<string | null> {
    if (!repoId) return null;
    const repo = await this.deps.repos.getById(workspaceId, repoId);
    return repo?.fullName ?? null;
  }

  /** Resolve a repo id, workspace-scoped, throwing if it does not exist —
   *  used whenever a request carries a `repo_id` to persist. */
  private async assertRepo(workspaceId: string, repoId: string | null): Promise<string | null> {
    if (!repoId) return null;
    const repo = await this.deps.repos.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError(REPO_NOT_FOUND_MESSAGE);
    return repo.fullName;
  }
}
