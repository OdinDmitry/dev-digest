import type {
  EvalCase,
  EvalCaseInput,
  EvalCaseSeed,
  EvalCaseUpdate,
  EvalComparison,
  EvalDashboard,
  EvalDashboardEntry,
  EvalExpectation,
  EvalRun,
  EvalRunRecord,
  EvalRunResult,
} from '@devdigest/shared';
import { sliceDiff } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError, ValidationError } from '../../platform/errors.js';
import type { AgentsRepository } from '../agents/repository.js';
import type { RepoRepository } from '../repos/repository.js';
import type { ReviewRepository } from '../reviews/repository.js';
import { loadDiff } from '../reviews/diff-loader.js';
import type { ContextService } from '../context/service.js';
import type { EvalRepository } from './repository/index.js';
import {
  caseResultToTrace,
  caseRowToDto,
  evalRunRecord,
  metricDelta,
  buildComparison,
  resolveExpectations,
  runToEvalRun,
  seedExpectationFrom,
  type EvalSeedFinding,
} from './helpers.js';
import { EvalSuiteRunner, resolveCaseContext, type ResolvedCaseContext } from './runner.js';
import {
  AGENT_NOT_FOUND_MESSAGE,
  EVAL_CASE_NOT_FOUND_MESSAGE,
  EVAL_CASE_EXISTS_FOR_FINDING_MESSAGE,
  EVAL_RUN_ACTIVE_MESSAGE,
  EVAL_RUN_NOT_FOUND_MESSAGE,
  REPO_NOT_FOUND_MESSAGE,
  FINDING_NOT_FOUND_MESSAGE,
  FINDING_NOT_DECIDED_MESSAGE,
  STALE_RUN_MS,
} from './constants.js';

/** Postgres unique-violation (23505) on the "one active run per agent"
 *  partial index — the race a second concurrent `POST .../eval-runs` can
 *  hit between this service's own `activeRunForAgent` check and the
 *  transactional insert. Translated here so no Postgres error code ever
 *  reaches a route (`onion-architecture` "Errors"). */
function isActiveRunConflict(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === '23505' &&
    (err as { constraint_name?: string }).constraint_name === 'eval_suite_runs_one_active_per_agent'
  );
}

function isOriginFindingConflict(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === '23505' &&
    (err as { constraint_name?: string }).constraint_name === 'eval_cases_origin_finding_uq'
  );
}

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
  /** The suite-run background job (Phase B) — `startSuiteRun` fires it,
   *  `previewCase` shares its `evaluateOne`. */
  runner: EvalSuiteRunner;
  /** Constructed per call, mirroring `EvalSuiteRunnerDeps.buildContext` —
   *  `previewCase` resolves a case's context WITHOUT going through the
   *  runner's `execute` loop, so it needs its own `ContextService`. */
  buildContext: () => ContextService;
}

export class EvalService {
  constructor(private deps: EvalServiceDeps) {}

  async listCases(workspaceId: string, agentId: string): Promise<EvalCase[]> {
    const agent = await this.deps.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError(AGENT_NOT_FOUND_MESSAGE);

    // AC-34 — each case's result from its agent's most recent COMPLETED
    // suite run, one grouped query rather than one per case.
    const [rows, lastOutcomes] = await Promise.all([
      this.deps.repo.listForAgent(workspaceId, agentId),
      this.deps.repo.lastOutcomeByCase(agentId),
    ]);
    const dtos: EvalCase[] = [];
    for (const row of rows) {
      const repoFullName = await this.repoFullName(workspaceId, row.repoId);
      const outcomeRow = lastOutcomes.get(row.id);
      dtos.push(caseRowToDto(row, repoFullName, outcomeRow ? caseResultToTrace(outcomeRow) : null));
    }
    return dtos;
  }

  async createCase(workspaceId: string, agentId: string, input: EvalCaseInput): Promise<EvalCase> {
    const agent = await this.deps.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError(AGENT_NOT_FOUND_MESSAGE);

    const expectations = resolveExpectations(null, input.expectations);

    const row = await this.deps.repo.createCase({
      workspaceId,
      ownerId: agentId,
      name: input.name,
      inputDiff: input.input_diff,
      // Content-only (AC-47): ignore body.repo_id for context association.
      repoId: null,
      expectations,
      notes: input.notes ?? null,
    });
    return caseRowToDto(row, null, null);
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

    const existing = await this.deps.repo.findCaseByOriginFindingId(workspaceId, finding.id);

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
      existing_case_id: existing?.id ?? null,
    };
  }

  /** AC-5/AC-46 — `owner_id` from the finding's review; `repo_id` always null
   *  (content-only evals). Body never supplies either. */
  async createFromFinding(
    workspaceId: string,
    findingId: string,
    body: CreateEvalCaseFromFindingInput,
  ): Promise<EvalCase> {
    const { finding, agentId, pullId, pullRow, repoRow } = await this.requireFindingOrigin(
      workspaceId,
      findingId,
    );

    const existing = await this.deps.repo.findCaseByOriginFindingId(workspaceId, finding.id);
    if (existing) {
      throw new AppError('eval_case_exists', EVAL_CASE_EXISTS_FOR_FINDING_MESSAGE, 409);
    }

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

    const row = await this.deps.repo
      .createCase({
        workspaceId,
        ownerId: agentId!,
        name: body.name,
        inputDiff,
        // Content-only evals (AC-46): no repo association for context resolution.
        repoId: null,
        expectations,
        notes: body.notes ?? null,
        originFindingId: finding.id,
        originPrId: pullId,
      })
      .catch((err) => {
        if (isOriginFindingConflict(err)) {
          throw new AppError('eval_case_exists', EVAL_CASE_EXISTS_FOR_FINDING_MESSAGE, 409);
        }
        throw err;
      });
    return caseRowToDto(row, null, null);
  }

  // ---- suite runs (Phase B) -------------------------------------------------

  /** AC-21/AC-23 — start a suite run for an agent. 409s when a run is
   *  already active, UNLESS it is stale (older than `STALE_RUN_MS` — the
   *  process that ran it is presumed dead), in which case it is failed and
   *  replaced. Also catches the race a second concurrent request can hit
   *  between that check and the transactional insert. */
  async startSuiteRun(workspaceId: string, agentId: string): Promise<EvalRun> {
    const agent = await this.deps.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError(AGENT_NOT_FOUND_MESSAGE);

    const active = await this.deps.repo.activeRunForAgent(workspaceId, agentId);
    if (active) {
      const ageMs = Date.now() - active.startedAt.getTime();
      if (ageMs < STALE_RUN_MS) {
        throw new AppError('eval_run_active', EVAL_RUN_ACTIVE_MESSAGE, 409);
      }
      await this.deps.repo.failRun(active.id, { erroredCount: active.erroredCount, durationMs: ageMs });
    }

    try {
      return await this.deps.runner.start(workspaceId, agentId);
    } catch (err) {
      if (isActiveRunConflict(err)) {
        throw new AppError('eval_run_active', EVAL_RUN_ACTIVE_MESSAGE, 409);
      }
      throw err;
    }
  }

  /** AC-24/AC-26/AC-29 — a single run, with its per-case results. */
  async getRun(workspaceId: string, runId: string): Promise<EvalRun> {
    const found = await this.deps.repo.getRunWithResults(workspaceId, runId);
    if (!found) throw new NotFoundError(EVAL_RUN_NOT_FOUND_MESSAGE);
    const agent = await this.deps.agents.getById(workspaceId, found.run.agentId);
    return runToEvalRun(found.run, agent?.name ?? null, found.results);
  }

  /** AC-23/AC-24 — the agent's `pending`/`running` run, if any (polled by
   *  the client while a run is in flight). */
  async getActiveRun(workspaceId: string, agentId: string): Promise<EvalRun | null> {
    const agent = await this.deps.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError(AGENT_NOT_FOUND_MESSAGE);

    const active = await this.deps.repo.activeRunForAgent(workspaceId, agentId);
    if (!active) return null;
    const found = await this.deps.repo.getRunWithResults(workspaceId, active.id);
    if (!found) return null;
    return runToEvalRun(found.run, agent.name, found.results);
  }

  /** AC-36/AC-38 — an agent's run history, newest first, each with its
   *  delta against the immediately preceding COMPLETED run. */
  async listRuns(workspaceId: string, agentId: string): Promise<EvalRunRecord[]> {
    const agent = await this.deps.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError(AGENT_NOT_FOUND_MESSAGE);

    const rows = await this.deps.repo.listRunsForAgent(workspaceId, agentId); // started_at DESC
    return rows.map((row, i) => {
      const earlier = rows.slice(i + 1).find((r) => r.state === 'completed') ?? null;
      return evalRunRecord(row, metricDelta(row, earlier));
    });
  }

  /** AC-40/AC-42/AC-54 — compare two of an agent's runs. Both ids must
   *  belong to `agentId` in this workspace (the route's own `:id`). */
  async compareRuns(
    workspaceId: string,
    agentId: string,
    runIdA: string,
    runIdB: string,
  ): Promise<EvalComparison> {
    const agent = await this.deps.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError(AGENT_NOT_FOUND_MESSAGE);

    const [a, b] = await Promise.all([
      this.deps.repo.getRunWithResults(workspaceId, runIdA),
      this.deps.repo.getRunWithResults(workspaceId, runIdB),
    ]);
    if (!a || !b || a.run.agentId !== agentId || b.run.agentId !== agentId) {
      throw new NotFoundError(EVAL_RUN_NOT_FOUND_MESSAGE);
    }
    return buildComparison(a.run, b.run, a.results, b.results);
  }

  /** AC-33 — evaluate one case with the agent's CURRENT config, writing
   *  nothing. Shares `runner.evaluateOne` with `execute` so a preview can
   *  never diverge from what a real run would produce for this case. */
  async previewCase(workspaceId: string, caseId: string): Promise<EvalRunResult> {
    const caseRow = await this.deps.repo.getCaseById(workspaceId, caseId);
    if (!caseRow) throw new NotFoundError(EVAL_CASE_NOT_FOUND_MESSAGE);

    const agent = await this.deps.agents.getById(workspaceId, caseRow.ownerId);
    if (!agent) throw new NotFoundError(AGENT_NOT_FOUND_MESSAGE);

    // Constraint 11 — same "enabled links only" filter as a real run.
    const links = await this.deps.agents.linkedSkills(agent.id);
    const skillBodies = links.filter((l) => l.skill.enabled).map((l) => l.skill.body);

    const contextService = this.deps.buildContext();
    const memo = new Map<string, ResolvedCaseContext>();
    const resolved = await resolveCaseContext(
      contextService,
      workspaceId,
      agent.id,
      caseRow.repoId,
      memo,
    );

    const expectations = (caseRow.expectedOutput as EvalExpectation[] | null) ?? [];
    const { result } = await this.deps.runner.evaluateOne({
      systemPrompt: agent.systemPrompt,
      provider: agent.provider,
      model: agent.model,
      strategy: agent.strategy,
      skills: skillBodies,
      documents: resolved.documents,
      inputDiff: caseRow.inputDiff,
      expectations,
      sessionId: `eval-preview:${caseRow.id}`,
    });

    return {
      case_id: caseRow.id,
      stored: false,
      result: { ...result, case_id: caseRow.id, name: caseRow.name, stored: false },
    };
  }

  /** AC-31/AC-32 — the workspace eval dashboard: one entry per agent with
   *  >=1 eval case (present even when it has never run), plus the
   *  run-all-agents confirmation counts (agents WITHOUT an active run —
   *  the only ones `runAllAgents` actually starts). */
  async dashboard(workspaceId: string): Promise<EvalDashboard> {
    const rows = await this.deps.repo.dashboardRows(workspaceId);
    if (rows.length === 0) {
      return { agents: [], run_all: { agent_count: 0, case_count: 0 } };
    }

    const allAgents = await this.deps.agents.list(workspaceId);
    const agentById = new Map(allAgents.map((a) => [a.id, a]));

    const entries: EvalDashboardEntry[] = [];
    let runAllAgentCount = 0;
    let runAllCaseCount = 0;
    for (const row of rows) {
      const agent = agentById.get(row.agentId);
      if (!agent) continue; // defensive — a case row always belongs to a live agent

      if (!row.activeRun) {
        runAllAgentCount += 1;
        runAllCaseCount += row.casesTotal;
      }

      entries.push({
        agent_id: agent.id,
        agent_name: agent.name,
        model: agent.model,
        cases_total: row.casesTotal,
        never_run: row.lastCompletedRun === null,
        running: row.activeRun !== null,
        last_run_started_at: row.lastCompletedRun ? row.lastCompletedRun.startedAt.toISOString() : null,
        traces_passed: row.lastCompletedRun ? row.lastCompletedRun.passedCount : null,
        traces_total: row.lastCompletedRun ? row.lastCompletedRun.casesTotal : null,
        recall: row.lastCompletedRun?.recall ?? null,
        precision: row.lastCompletedRun?.precision ?? null,
        citation_accuracy: row.lastCompletedRun?.citationAccuracy ?? null,
      });
    }

    return {
      agents: entries,
      run_all: { agent_count: runAllAgentCount, case_count: runAllCaseCount },
    };
  }

  /** AC-31 — start a run for every agent that has >=1 eval case and no
   *  already-active run. A 409 racing with a concurrent start for the same
   *  agent is swallowed (that agent simply isn't in the returned list),
   *  never surfaced as a whole-batch failure. */
  async runAllAgents(workspaceId: string): Promise<EvalRun[]> {
    const rows = await this.deps.repo.dashboardRows(workspaceId);
    const runs: EvalRun[] = [];
    for (const row of rows) {
      if (row.activeRun) continue;
      try {
        runs.push(await this.startSuiteRun(workspaceId, row.agentId));
      } catch (err) {
        if (err instanceof AppError && err.statusCode === 409) continue;
        throw err;
      }
    }
    return runs;
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
