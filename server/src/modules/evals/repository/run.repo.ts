import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';

/**
 * `eval_suite_runs` / `eval_case_results` data-access. Method bodies only in
 * this phase — no caller yet (Phase B wires the background runner against
 * these). Kept local to this module, mirroring `EvalCaseRow` above.
 */
export type EvalSuiteRunRow = typeof t.evalSuiteRuns.$inferSelect;
export type EvalCaseResultRow = typeof t.evalCaseResults.$inferSelect;

export interface InsertEvalSuiteRun {
  workspaceId: string;
  agentId: string;
  systemPrompt: string;
  provider: string;
  model: string;
  strategy: string;
  skills: unknown;
  capturedContext: unknown;
  casesTotal: number;
}

/** One frozen case result row to insert at run start (Phase B populates the
 *  outcome fields as each case finishes). */
export interface InsertEvalCaseResult {
  runId: string;
  caseId: string | null;
  ordinal: number;
  caseName: string;
  caseRepoId: string | null;
  caseInputDiff: string;
  caseExpectations: unknown;
}

/** A frozen case, without `runId`/`ordinal` — the caller only decides the
 *  case SET; `createRunWithFrozenCases` assigns `ordinal` (array index). */
export type FrozenCaseInput = Omit<InsertEvalCaseResult, 'runId' | 'ordinal'>;

/** The outcome fields recorded on one case result as it finishes. */
export interface CaseResultOutcome {
  status: 'passed' | 'failed' | 'errored';
  error: string | null;
  findings: unknown;
  rawFindingsCount: number;
  expectedCount: number;
  matchedCount: number;
  costUsd: number | null;
  durationMs: number | null;
}

export interface CompleteRunValues {
  passedCount: number;
  erroredCount: number;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  costUsd: number | null;
  durationMs: number;
}

export interface FailRunValues {
  erroredCount: number;
  durationMs: number;
}

/** One dashboard-ready row per agent that owns >=1 eval case (Phase B —
 *  `EvalService.dashboard` turns this into `EvalDashboardEntry`). */
export interface EvalDashboardRow {
  agentId: string;
  casesTotal: number;
  activeRun: EvalSuiteRunRow | null;
  lastCompletedRun: EvalSuiteRunRow | null;
}

export class EvalRunRepository {
  constructor(private db: Db) {}

  async createRun(values: InsertEvalSuiteRun): Promise<EvalSuiteRunRow> {
    const [row] = await this.db
      .insert(t.evalSuiteRuns)
      .values({
        workspaceId: values.workspaceId,
        agentId: values.agentId,
        systemPrompt: values.systemPrompt,
        provider: values.provider,
        model: values.model,
        strategy: values.strategy,
        skills: values.skills,
        capturedContext: values.capturedContext,
        casesTotal: values.casesTotal,
      })
      .returning();
    return row!;
  }

  async insertCaseResults(
    runId: string,
    rows: InsertEvalCaseResult[],
  ): Promise<EvalCaseResultRow[]> {
    if (rows.length === 0) return [];
    return this.db
      .insert(t.evalCaseResults)
      .values(
        rows.map((r) => ({
          runId,
          caseId: r.caseId,
          ordinal: r.ordinal,
          caseName: r.caseName,
          caseRepoId: r.caseRepoId,
          caseInputDiff: r.caseInputDiff,
          caseExpectations: r.caseExpectations,
        })),
      )
      .returning();
  }

  async getRun(workspaceId: string, runId: string): Promise<EvalSuiteRunRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalSuiteRuns)
      .where(and(eq(t.evalSuiteRuns.workspaceId, workspaceId), eq(t.evalSuiteRuns.id, runId)));
    return row;
  }

  /** An agent's run history, newest first. */
  async listRunsForAgent(workspaceId: string, agentId: string): Promise<EvalSuiteRunRow[]> {
    return this.db
      .select()
      .from(t.evalSuiteRuns)
      .where(
        and(eq(t.evalSuiteRuns.workspaceId, workspaceId), eq(t.evalSuiteRuns.agentId, agentId)),
      )
      .orderBy(desc(t.evalSuiteRuns.startedAt), desc(t.evalSuiteRuns.id));
  }

  /** Most recent `completed` run for an agent (delta baseline / dashboard). */
  async latestCompletedRun(
    workspaceId: string,
    agentId: string,
  ): Promise<EvalSuiteRunRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalSuiteRuns)
      .where(
        and(
          eq(t.evalSuiteRuns.workspaceId, workspaceId),
          eq(t.evalSuiteRuns.agentId, agentId),
          eq(t.evalSuiteRuns.state, 'completed'),
        ),
      )
      .orderBy(desc(t.evalSuiteRuns.startedAt), desc(t.evalSuiteRuns.id))
      .limit(1);
    return row;
  }

  /** A `pending`/`running` run for an agent, if any — the DB invariant
   *  (`eval_suite_runs_one_active_per_agent`) guarantees at most one. */
  async activeRunForAgent(
    workspaceId: string,
    agentId: string,
  ): Promise<EvalSuiteRunRow | undefined> {
    const rows = await this.db
      .select()
      .from(t.evalSuiteRuns)
      .where(
        and(eq(t.evalSuiteRuns.workspaceId, workspaceId), eq(t.evalSuiteRuns.agentId, agentId)),
      );
    return rows.find((r) => r.state === 'pending' || r.state === 'running');
  }

  /**
   * AC-21/AC-30 — the run row plus one `eval_case_results` row per captured
   * case, `ordinal` ascending from the array index, in ONE transaction: a
   * concurrent reader must never observe a run with zero case rows. Opened
   * internally (mirroring `ContextRepository.replaceForOwner`,
   * `modules/context/repository.ts:78-100`) rather than accepting an
   * executor — `EvalSuiteRunnerDeps` carries no `db` handle for a caller to
   * extend this into a larger transaction, and "run + its frozen cases" is
   * itself the whole unit of work this method represents.
   */
  async createRunWithFrozenCases(
    values: InsertEvalSuiteRun,
    cases: FrozenCaseInput[],
  ): Promise<{ run: EvalSuiteRunRow; results: EvalCaseResultRow[] }> {
    return this.db.transaction(async (tx) => {
      const [run] = await tx
        .insert(t.evalSuiteRuns)
        .values({
          workspaceId: values.workspaceId,
          agentId: values.agentId,
          systemPrompt: values.systemPrompt,
          provider: values.provider,
          model: values.model,
          strategy: values.strategy,
          skills: values.skills,
          capturedContext: values.capturedContext,
          casesTotal: values.casesTotal,
        })
        .returning();

      const results =
        cases.length === 0
          ? []
          : await tx
              .insert(t.evalCaseResults)
              .values(
                cases.map((c, ordinal) => ({
                  runId: run!.id,
                  ordinal,
                  caseId: c.caseId,
                  caseName: c.caseName,
                  caseRepoId: c.caseRepoId,
                  caseInputDiff: c.caseInputDiff,
                  caseExpectations: c.caseExpectations,
                })),
              )
              .returning();

      return { run: run!, results };
    });
  }

  /** `pending` → `running`, once, when the first case's evaluation begins. */
  async markRunning(runId: string): Promise<void> {
    await this.db
      .update(t.evalSuiteRuns)
      .set({ state: 'running' })
      .where(eq(t.evalSuiteRuns.id, runId));
  }

  /** Record one case's outcome and advance the run's progress counter — the
   *  two always change together, so they go in one transaction. */
  async recordCaseResult(
    runId: string,
    resultId: string,
    outcome: CaseResultOutcome,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(t.evalCaseResults)
        .set({
          status: outcome.status,
          error: outcome.error,
          findings: outcome.findings,
          rawFindingsCount: outcome.rawFindingsCount,
          expectedCount: outcome.expectedCount,
          matchedCount: outcome.matchedCount,
          costUsd: outcome.costUsd,
          durationMs: outcome.durationMs,
        })
        .where(eq(t.evalCaseResults.id, resultId));
      await tx
        .update(t.evalSuiteRuns)
        .set({ casesDone: sql`${t.evalSuiteRuns.casesDone} + 1` })
        .where(eq(t.evalSuiteRuns.id, runId));
    });
  }

  /** `running` → `completed`, with metrics (AC-15..AC-18 aggregate, never
   *  `null` on this path — a `null` `RunMetrics` routes to `failRun`
   *  instead, see `runner.ts`). */
  async completeRun(runId: string, values: CompleteRunValues): Promise<EvalSuiteRunRow> {
    const [row] = await this.db
      .update(t.evalSuiteRuns)
      .set({
        state: 'completed',
        finishedAt: new Date(),
        passedCount: values.passedCount,
        erroredCount: values.erroredCount,
        recall: values.recall,
        precision: values.precision,
        citationAccuracy: values.citationAccuracy,
        costUsd: values.costUsd,
        durationMs: values.durationMs,
      })
      .where(eq(t.evalSuiteRuns.id, runId))
      .returning();
    return row!;
  }

  /** `running` → `failed` — every case errored (AC-29): metrics stay
   *  `null` (the columns' own default), never zeroed. */
  async failRun(runId: string, values: FailRunValues): Promise<EvalSuiteRunRow> {
    const [row] = await this.db
      .update(t.evalSuiteRuns)
      .set({
        state: 'failed',
        finishedAt: new Date(),
        erroredCount: values.erroredCount,
        durationMs: values.durationMs,
        recall: null,
        precision: null,
        citationAccuracy: null,
        costUsd: null,
      })
      .where(eq(t.evalSuiteRuns.id, runId))
      .returning();
    return row!;
  }

  /** AC-53 — overwrite the run's running captured-context snapshot. Always
   *  the full merged `EvalCapturedContext`, never a partial patch. */
  async appendCapturedContext(runId: string, capturedContext: unknown): Promise<void> {
    await this.db
      .update(t.evalSuiteRuns)
      .set({ capturedContext })
      .where(eq(t.evalSuiteRuns.id, runId));
  }

  /** A run plus its frozen case results, `ordinal` ascending — the shape
   *  `GET /eval-runs/:id` and `compareRuns` both need. */
  async getRunWithResults(
    workspaceId: string,
    runId: string,
  ): Promise<{ run: EvalSuiteRunRow; results: EvalCaseResultRow[] } | undefined> {
    const run = await this.getRun(workspaceId, runId);
    if (!run) return undefined;
    const results = await this.db
      .select()
      .from(t.evalCaseResults)
      .where(eq(t.evalCaseResults.runId, runId))
      .orderBy(asc(t.evalCaseResults.ordinal));
    return { run, results };
  }

  /**
   * AC-34 — for every case result belonging to a COMPLETED run of `agentId`,
   * keep only the most recent (by the OWNING run's `started_at`) per
   * `caseId`. A result whose `caseId` is `null` (its case has since been
   * deleted) is not addressable by any live case and is skipped. Read by
   * `EvalService.listCases` and merged into the `EvalCase` DTO.
   */
  async lastOutcomeByCase(agentId: string): Promise<Map<string, EvalCaseResultRow>> {
    const rows = await this.db
      .select({ result: t.evalCaseResults })
      .from(t.evalCaseResults)
      .innerJoin(t.evalSuiteRuns, eq(t.evalCaseResults.runId, t.evalSuiteRuns.id))
      .where(and(eq(t.evalSuiteRuns.agentId, agentId), eq(t.evalSuiteRuns.state, 'completed')))
      .orderBy(desc(t.evalSuiteRuns.startedAt), desc(t.evalSuiteRuns.id));

    const byCase = new Map<string, EvalCaseResultRow>();
    for (const { result } of rows) {
      if (!result.caseId) continue;
      if (!byCase.has(result.caseId)) byCase.set(result.caseId, result);
    }
    return byCase;
  }

  /**
   * One row per agent that owns >=1 eval case in the workspace, with its
   * case count, current active run (if any) and most recent completed run
   * (if any) — the whole dashboard's data, in three queries total instead of
   * one per agent (`EvalService.dashboard`/`runAllAgents`).
   */
  async dashboardRows(workspaceId: string): Promise<EvalDashboardRow[]> {
    const caseCounts = await this.db
      .select({
        agentId: t.evalCases.ownerId,
        // postgres-js returns count() as a string — cast in SQL AND coerce below.
        count: sql<number>`count(*)::int`,
      })
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerKind, 'agent')))
      .groupBy(t.evalCases.ownerId);
    if (caseCounts.length === 0) return [];

    const agentIds = caseCounts.map((c) => c.agentId);
    const runs = await this.db
      .select()
      .from(t.evalSuiteRuns)
      .where(
        and(
          eq(t.evalSuiteRuns.workspaceId, workspaceId),
          inArray(t.evalSuiteRuns.agentId, agentIds),
        ),
      )
      .orderBy(desc(t.evalSuiteRuns.startedAt), desc(t.evalSuiteRuns.id));

    const activeByAgent = new Map<string, EvalSuiteRunRow>();
    const completedByAgent = new Map<string, EvalSuiteRunRow>();
    for (const run of runs) {
      if ((run.state === 'pending' || run.state === 'running') && !activeByAgent.has(run.agentId)) {
        activeByAgent.set(run.agentId, run);
      }
      if (run.state === 'completed' && !completedByAgent.has(run.agentId)) {
        completedByAgent.set(run.agentId, run);
      }
    }

    return caseCounts.map((c) => ({
      agentId: c.agentId,
      casesTotal: Number(c.count),
      activeRun: activeByAgent.get(c.agentId) ?? null,
      lastCompletedRun: completedByAgent.get(c.agentId) ?? null,
    }));
  }
}
