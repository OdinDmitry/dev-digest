import type {
  EvalAgentSummary,
  EvalCaseCreate,
  EvalCaseDraft,
  EvalCaseRecord,
  EvalCaseUpdate,
  EvalSuiteRun,
  EvalSuiteRunDetail,
  LLMProvider,
  Provider,
} from '@devdigest/shared';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import type { AgentsRepository } from '../agents/repository.js';
import type { ReviewRepository } from '../reviews/repository.js';
import { EvalRepository } from './repository.js';
import { EvalRunner } from './runner.js';
import { cutFragment, expectationKindFor, normalizeRange } from './helpers.js';

/**
 * EvalService — case CRUD (draft → create → update → soft-delete) plus the
 * read surfaces (case set, run history, run detail, recent runs). Explicit
 * deps only, never the raw DI `Container` (`onion-architecture` § Dependencies
 * of a service) — `llm` arrives as a bound function so ring 2 never holds the
 * composition root. Run START/EXECUTION is delegated to `EvalRunner`
 * (`runner.ts`), constructed here with the same `repo`/`agents`/`llm`.
 */
export interface EvalServiceDeps {
  repo: EvalRepository;
  agents: AgentsRepository;
  reviews: Pick<ReviewRepository, 'findingContext' | 'getPrFiles'>;
  llm: (id: Provider) => Promise<LLMProvider>;
}

export class EvalService {
  private runner: EvalRunner;

  constructor(private deps: EvalServiceDeps) {
    this.runner = new EvalRunner({ repo: deps.repo, agents: deps.agents, llm: deps.llm });
  }

  /** `GET /findings/:id/eval-case-draft` (AC-5, AC-40, AC-41, AC-10). */
  async getDraft(workspaceId: string, findingId: string): Promise<EvalCaseDraft> {
    const ctx = await this.deps.reviews.findingContext(findingId);
    if (!ctx || ctx.pull.workspaceId !== workspaceId || !ctx.review.agentId) {
      throw new NotFoundError('Finding not found');
    }
    const agent = await this.deps.agents.getById(workspaceId, ctx.review.agentId);
    if (!agent) throw new NotFoundError('Finding not found');

    // A finding's own line range is a model artefact and can be inverted
    // (Contracts § inverted ranges) — normalise once, before the fragment cut
    // and before it is surfaced to the client.
    const range = normalizeRange(ctx.finding.startLine, ctx.finding.endLine);
    const fragment = await this.cutFindingFragment(
      { file: ctx.finding.file, startLine: range.start, endLine: range.end },
      ctx.pull.id,
    );
    const existingCase = (await this.deps.repo.getCaseBySourceFinding(workspaceId, findingId)) ?? null;

    return {
      finding_id: findingId,
      agent_id: agent.id,
      agent_name: agent.name,
      suggested_name: ctx.finding.title,
      file: ctx.finding.file,
      start_line: range.start,
      end_line: range.end,
      fragment,
      expectation_kind: expectationKindFor({
        acceptedAt: ctx.finding.acceptedAt,
        dismissedAt: ctx.finding.dismissedAt,
      }),
      existing_case: existingCase,
    };
  }

  /** `POST /agents/:id/eval-cases` (AC-40, AC-41, AC-43, AC-44, AC-10).
   *  Returns `created: false` when a case already exists for this finding
   *  (AC-10) — the route maps that to 200 instead of 201. The expectation
   *  type is NOT on the wire; it is derived from the finding's own decision,
   *  and a finding with no decision (neither accepted nor dismissed) has no
   *  defensible type — refused with a 422, the only direction that keeps
   *  this endpoint total (Open questions 1). */
  async createCase(
    workspaceId: string,
    agentId: string,
    input: EvalCaseCreate,
  ): Promise<{ created: boolean; case: EvalCaseRecord }> {
    const agent = await this.deps.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const ctx = await this.deps.reviews.findingContext(input.finding_id);
    if (!ctx || ctx.pull.workspaceId !== workspaceId || ctx.review.agentId !== agentId) {
      throw new NotFoundError('Finding not found');
    }

    const existing = await this.deps.repo.getCaseBySourceFinding(workspaceId, input.finding_id);
    if (existing) return { created: false, case: existing };

    const expectationKind = expectationKindFor({
      acceptedAt: ctx.finding.acceptedAt,
      dismissedAt: ctx.finding.dismissedAt,
    });
    if (expectationKind === null) {
      throw new ValidationError(
        'This finding must be accepted or dismissed before it can become an eval case.',
      );
    }

    // Normalise before the fragment cut and before either the case row or its
    // expectation is persisted (Contracts § inverted ranges) — the CHECK
    // constraint on `eval_case_expectations` requires end_line >= start_line,
    // and an inverted finding range would otherwise violate it.
    const range = normalizeRange(ctx.finding.startLine, ctx.finding.endLine);
    const fragment = await this.cutFindingFragment(
      { file: ctx.finding.file, startLine: range.start, endLine: range.end },
      ctx.pull.id,
    );

    const created = await this.deps.repo.insertCase({
      workspaceId,
      agentId,
      name: input.name,
      sourceFindingId: input.finding_id,
      file: ctx.finding.file,
      startLine: range.start,
      endLine: range.end,
      fragment,
      expectationKind,
      // AC-44 — copied from the finding at creation, never touched again.
      severity: ctx.finding.severity,
      category: ctx.finding.category,
    });
    return { created: true, case: created };
  }

  /** `GET /agents/:id/eval-cases`. */
  async listCases(workspaceId: string, agentId: string): Promise<EvalCaseRecord[]> {
    const agent = await this.deps.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    return this.deps.repo.listCasesForAgent(workspaceId, agentId);
  }

  /** `PUT /eval-cases/:id` — the name is the case's ONLY mutable field
   *  (AC-45; SPEC-04 § Contracts, Eval case). The expectation-editing path
   *  (and the AC-11 overlap check it drove) is retired — a case carries
   *  exactly one expectation and it is fixed at creation. */
  async updateCase(
    workspaceId: string,
    id: string,
    input: EvalCaseUpdate,
  ): Promise<EvalCaseRecord> {
    const updated = await this.deps.repo.updateCase(workspaceId, id, { name: input.name });
    if (!updated) throw new NotFoundError('Eval case not found');
    return updated;
  }

  /** `DELETE /eval-cases/:id` — soft delete; a recorded run's rows are never
   *  touched (AC-12). */
  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    return this.deps.repo.softDeleteCase(workspaceId, id);
  }

  /** `POST /agents/:id/eval-runs` (AC-13, AC-16). */
  async startRun(workspaceId: string, agentId: string): Promise<EvalSuiteRun> {
    const agent = await this.deps.agents.getConfigById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    return this.runner.start(workspaceId, agent);
  }

  /** `GET /agents/:id/eval-runs` — newest first. */
  async listRuns(workspaceId: string, agentId: string): Promise<EvalSuiteRun[]> {
    const agent = await this.deps.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    return this.deps.repo.listSuiteRunsForAgent(workspaceId, agentId);
  }

  /** `GET /eval-runs/:id`. */
  async getRun(workspaceId: string, id: string): Promise<EvalSuiteRunDetail> {
    const run = await this.deps.repo.getSuiteRunDetail(workspaceId, id);
    if (!run) throw new NotFoundError('Eval run not found');
    return run;
  }

  /** `GET /eval-runs?limit=` — every status, across every agent, newest
   *  first (AC-62). SPEC-04 retires the completed-only filter: a run whose
   *  every case failed to complete must stay visible. */
  async listRecentRuns(workspaceId: string, limit: number): Promise<EvalSuiteRun[]> {
    return this.deps.repo.listSuiteRuns(workspaceId, limit);
  }

  /** `GET /eval-agents` — one row per agent with its most recent run of ANY
   *  status, or null when never run (AC-63, AC-4). */
  async listAgentSummaries(workspaceId: string): Promise<EvalAgentSummary[]> {
    return this.deps.repo.latestRunPerAgent(workspaceId);
  }

  /** `POST /eval-cases/:id/verify` (AC-46). Delegates to the runner — a
   *  single-case verification touches only `eval_cases.latest_result`. */
  async verifyCase(workspaceId: string, id: string): Promise<EvalCaseRecord> {
    return this.runner.verifyCase(workspaceId, id);
  }

  /** Cut the fragment for a finding's own file/range; throws the 422 the
   *  spec's "diff fragment cannot be cut" edge case needs. */
  private async cutFindingFragment(
    finding: { file: string; startLine: number; endLine: number },
    prId: string,
  ): Promise<string> {
    const prFiles = await this.deps.reviews.getPrFiles(prId);
    const prFile = prFiles.find((f) => f.path === finding.file);
    const fragment = cutFragment(finding.file, prFile?.patch ?? '', finding.startLine, finding.endLine);
    if (fragment === null) {
      throw new ValidationError(
        'Cannot cut a diff fragment for this finding: its file has no recorded patch covering this range.',
      );
    }
    return fragment;
  }
}
