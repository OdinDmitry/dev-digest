import type {
  EvalCapturedContext,
  EvalContextExclusion,
  EvalExpectation,
  EvalPerTrace,
  EvalRun,
  LLMProvider,
  Provider,
  ReviewStrategy,
} from '@devdigest/shared';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { NotFoundError, AppError } from '../../platform/errors.js';
import type { Logger } from '../reviews/run-executor.js';
import type { AgentsRepository } from '../agents/repository.js';
import type { ContextService } from '../context/service.js';
import type { EvalRepository, FrozenCaseInput } from './repository/index.js';
import { buildEvalReviewInput, mergeCapturedContext, runMetricsFrom, runToEvalRun } from './helpers.js';
import { scoreCase } from './scoring.js';
import { AGENT_NOT_FOUND_MESSAGE, EVAL_NO_CASES_MESSAGE } from './constants.js';

/**
 * modules/evals/runner.ts — the background suite-run job (`onion-architecture`
 * "Where the side effects go": a job is another way to enter a use case, so it
 * is a ring-2 class with explicit deps, no `Container`, no Drizzle import —
 * same shape as any other service. `server/src/modules/reviews/run-executor.ts`
 * is the reference pattern (read-only; never modified by this module).
 */
export interface EvalSuiteRunnerDeps {
  repo: EvalRepository;
  agents: AgentsRepository;
  /** Constructed per run, mirroring `run-executor.ts:480-486`'s explicit-deps
   *  `ContextService` construction. */
  buildContext: () => ContextService;
  llm: (provider: Provider) => Promise<LLMProvider>;
  logger?: Logger;
}

export interface EvaluateOneInput {
  systemPrompt: string;
  provider: Provider;
  model: string;
  strategy: ReviewStrategy;
  skills: string[];
  documents: { path: string; text: string }[];
  inputDiff: string;
  expectations: EvalExpectation[];
  sessionId: string;
}

export interface EvaluateOneOutput {
  /** `case_id`/`name`/`stored` are NOT known to `evaluateOne` (its input
   *  carries no case identity) — the caller (`execute`/`previewCase`) sets
   *  them on the returned value before persisting or responding. */
  result: EvalPerTrace;
  documents: { path: string; text: string }[];
  excluded: { path: string; reason: string }[];
}

export interface ResolvedCaseContext {
  documents: { path: string; text: string }[];
  excluded: EvalContextExclusion[];
}

/**
 * Resolve one case's project context for eval. Content-only (AC-11 / AC-49):
 * always empty — `assembleForRun` is never called, regardless of `caseRepoId`.
 * `memo` is unused but kept so call sites (suite execute + preview) stay aligned.
 */
export async function resolveCaseContext(
  _contextService: ContextService,
  _workspaceId: string,
  _agentId: string,
  _caseRepoId: string | null,
  _memo: Map<string, ResolvedCaseContext>,
): Promise<ResolvedCaseContext> {
  return { documents: [], excluded: [] };
}

export class EvalSuiteRunner {
  constructor(private deps: EvalSuiteRunnerDeps) {}

  /**
   * AC-21/AC-30 — capture the agent's config + case set NOW (so a case
   * created/edited/deleted afterward cannot change this run), persist a
   * pending run and one frozen result row per case, fire `execute` without
   * awaiting, and return the run in its just-created `pending` state.
   */
  async start(workspaceId: string, agentId: string): Promise<EvalRun> {
    // Constraint 10 — fetch the agent workspace-scoped BEFORE `linkedSkills`
    // (which is not itself workspace-scoped).
    const agent = await this.deps.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError(AGENT_NOT_FOUND_MESSAGE);

    // Constraint 11 — only enabled linked skills, in link order, {name, body}.
    const links = await this.deps.agents.linkedSkills(agentId);
    const capturedSkills = links
      .filter((l) => l.skill.enabled)
      .map((l) => ({ name: l.skill.name, body: l.skill.body }));

    const cases = await this.deps.repo.listForAgent(workspaceId, agentId);
    if (cases.length === 0) {
      // AC-22's server half — the route/client never offers this control for
      // a case-less agent, but the check is enforced here too.
      throw new AppError('no_eval_cases', EVAL_NO_CASES_MESSAGE, 400);
    }

    const frozenCases: FrozenCaseInput[] = cases.map((c) => ({
      caseId: c.id,
      caseName: c.name,
      caseRepoId: c.repoId,
      caseInputDiff: c.inputDiff,
      caseExpectations: c.expectedOutput,
    }));

    const emptyContext: EvalCapturedContext = { documents: [], excluded: [] };
    const { run, results } = await this.deps.repo.createRunWithFrozenCases(
      {
        workspaceId,
        agentId,
        systemPrompt: agent.systemPrompt,
        provider: agent.provider,
        model: agent.model,
        strategy: agent.strategy,
        skills: capturedSkills,
        capturedContext: emptyContext,
        casesTotal: cases.length,
      },
      frozenCases,
    );

    // Fire-and-forget — the route returns the `pending` run immediately
    // (AC-21); a failure inside `execute` is never allowed to throw here
    // (`execute` itself never throws — see its own doc comment), but this
    // `.catch` is a last-resort safety net so a truly unexpected rejection
    // is logged rather than becoming an unhandled rejection.
    void this.execute(workspaceId, run.id).catch((err) => {
      this.deps.logger?.error(
        { runId: run.id, agentId, err: (err as Error).message },
        'eval suite run: execute rejected unexpectedly',
      );
    });

    return runToEvalRun(run, agent.name, results);
  }

  /**
   * The background loop. Never throws: a per-case failure is recorded on
   * that case's row (`evaluateOne` never lets a throw escape either) and the
   * loop continues (AC-27) — this method's own top-level work (marking
   * `running`, resolving context, recording a result) all goes through the
   * repository, whose own failures WOULD propagate; that is an accepted
   * "the run is stuck" outcome distinct from a per-case evaluation failure.
   */
  async execute(workspaceId: string, runId: string): Promise<void> {
    const found = await this.deps.repo.getRunWithResults(workspaceId, runId);
    if (!found) return;
    const { run, results } = found;

    await this.deps.repo.markRunning(runId);

    const contextService = this.deps.buildContext();
    const contextMemo = new Map<string, ResolvedCaseContext>();
    const skills = (run.skills as { name: string; body: string }[] | null) ?? [];
    const skillBodies = skills.map((s) => s.body);

    let capturedContext: EvalCapturedContext = { documents: [], excluded: [] };
    let erroredCount = 0;
    const runStart = Date.now();

    for (const resultRow of results) {
      const resolved = await resolveCaseContext(
        contextService,
        workspaceId,
        run.agentId,
        resultRow.caseRepoId,
        contextMemo,
      );

      // AC-53 — merge THIS case's context into the run's running captured
      // context and persist after every case, so a reload mid-run already
      // shows what has been used so far.
      capturedContext = mergeCapturedContext(capturedContext, {
        documents: resolved.documents.map((d) => ({
          repo_id: resultRow.caseRepoId,
          path: d.path,
          text: d.text,
        })),
        excluded: resolved.excluded,
      });
      await this.deps.repo.appendCapturedContext(runId, capturedContext);

      const { result } = await this.evaluateOne({
        systemPrompt: run.systemPrompt,
        provider: run.provider as Provider,
        model: run.model,
        strategy: run.strategy as ReviewStrategy,
        skills: skillBodies,
        documents: resolved.documents,
        inputDiff: resultRow.caseInputDiff,
        expectations: (resultRow.caseExpectations as EvalExpectation[] | null) ?? [],
        sessionId: `eval:${runId}:${resultRow.id}`,
      });

      if (result.errored) erroredCount += 1;

      await this.deps.repo.recordCaseResult(runId, resultRow.id, {
        // `evaluateOne` only ever returns 'passed' | 'failed' | 'errored'
        // (never the row's own pre-eval 'pending' default) — see its two
        // return sites above; `EvalPerTrace.status`'s wider `EvalCaseStatus`
        // type doesn't encode that narrowing.
        status: result.status as 'passed' | 'failed' | 'errored',
        error: result.error,
        findings: result.findings,
        rawFindingsCount: result.raw_findings_count,
        expectedCount: result.expected_count,
        matchedCount: result.matched_count,
        costUsd: result.cost_usd,
        durationMs: result.duration_ms,
      });
    }

    // Re-read the just-recorded rows rather than tracking them in memory —
    // `runMetricsFrom`/the cost rollup both need the PERSISTED outcome, and
    // this keeps `execute` from ever disagreeing with what `getRun` reads.
    const finalResults = (await this.deps.repo.getRunWithResults(workspaceId, runId))?.results ?? results;
    const metrics = runMetricsFrom(finalResults);
    const durationMs = Date.now() - runStart;
    // Constraint 6/5 — costs propagate as null, never 0: unknown if ANY case
    // reported an unknown cost (including one that never reached the LLM).
    const costUsd = finalResults.some((r) => r.costUsd == null)
      ? null
      : finalResults.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);

    if (metrics === null) {
      // AC-29 — every case errored: failed, metrics stay null.
      await this.deps.repo.failRun(runId, { erroredCount, durationMs });
    } else {
      await this.deps.repo.completeRun(runId, {
        passedCount: metrics.passed,
        erroredCount,
        recall: metrics.recall,
        precision: metrics.precision,
        citationAccuracy: metrics.citation_accuracy,
        costUsd,
        durationMs,
      });
    }
  }

  /**
   * One case, no persistence — shared by `execute` and
   * `EvalService.previewCase` so the two can never diverge (AC-28). Any
   * throw (LLM resolution, the review itself) becomes an `errored` trace
   * rather than propagating — `execute`'s loop and `previewCase`'s
   * single-shot response both rely on this never rejecting.
   */
  async evaluateOne(input: EvaluateOneInput): Promise<EvaluateOneOutput> {
    const start = Date.now();
    try {
      const llm = await this.deps.llm(input.provider);
      const diff = parseUnifiedDiff(input.inputDiff);
      const reviewInput = buildEvalReviewInput({
        systemPrompt: input.systemPrompt,
        model: input.model,
        strategy: input.strategy,
        diff,
        llm,
        skills: input.skills,
        specs: input.documents,
        sessionId: input.sessionId,
      });
      const outcome = await reviewPullRequest(reviewInput);
      // Constraint 5 — `dropped` are grounding rejects; raw = grounded + dropped.
      const rawCount = outcome.review.findings.length + outcome.dropped.length;
      const score = scoreCase(input.expectations, outcome.review.findings, rawCount);

      const result: EvalPerTrace = {
        case_id: null,
        name: '',
        status: score.passed ? 'passed' : 'failed',
        pass: score.passed,
        errored: false,
        error: null,
        findings: outcome.review.findings,
        raw_findings_count: rawCount,
        expected_count: score.expectedCount,
        matched_count: score.matchedCount,
        cost_usd: outcome.costUsd,
        duration_ms: Date.now() - start,
        stored: false,
      };
      return { result, documents: input.documents, excluded: [] };
    } catch (err) {
      const result: EvalPerTrace = {
        case_id: null,
        name: '',
        status: 'errored',
        pass: false,
        errored: true,
        error: (err as Error).message,
        findings: [],
        raw_findings_count: 0,
        expected_count: input.expectations.filter((e) => e.kind === 'must_find').length,
        matched_count: 0,
        cost_usd: null,
        duration_ms: Date.now() - start,
        stored: false,
      };
      return { result, documents: input.documents, excluded: [] };
    }
  }
}
