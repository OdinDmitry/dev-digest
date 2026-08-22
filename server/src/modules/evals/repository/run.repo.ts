import { and, desc, eq } from 'drizzle-orm';
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
}
