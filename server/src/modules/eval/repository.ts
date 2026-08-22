import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { EvalCaseRow, EvalExpectationRow } from '../../db/rows.js';
import type {
  EvalAgentSummary,
  EvalCaseLatestResult,
  EvalCaseRecord,
  EvalCaseResult,
  EvalExpectationKind,
  EvalInvokedSkill,
  EvalReturnedFinding,
  EvalRunStatus,
  EvalSuiteRun,
  EvalSuiteRunDetail,
} from '@devdigest/shared';
import {
  EvalCaseLatestResult as EvalCaseLatestResultSchema,
  EvalReturnedFinding as EvalReturnedFindingSchema,
} from '@devdigest/shared';

/**
 * EvalRepository — the only file in the eval module that touches the DB.
 * Every method is workspace-scoped; every list orders by its sort key PLUS
 * `id` (`server/insights.md:48`). Reading `actual_output` always goes
 * through `EvalReturnedFinding.array().safeParse(...)` with a fallback to
 * `[]` — never a bare `as` cast (`server/insights.md:46`). `EvalCaseRow`/
 * `EvalExpectationRow` come from `db/rows.js` (the `$inferSelect` types) so
 * the column list is enumerated exactly once — see `db/rows.ts`.
 */

function toCaseRecord(row: EvalCaseRow, expectations: EvalExpectationRow[]): EvalCaseRecord {
  // Never a bare `as` cast — a legacy/partial document must not throw the
  // route (server/insights.md 2026-08-17); the new `latest_result` column
  // follows the same rule as `actual_output` below.
  const latestResultParsed =
    row.latestResult == null ? null : EvalCaseLatestResultSchema.safeParse(row.latestResult);
  const latestResult: EvalCaseLatestResult | null =
    latestResultParsed && latestResultParsed.success ? latestResultParsed.data : null;
  return {
    id: row.id,
    agent_id: row.ownerId,
    name: row.name,
    source_finding_id: row.sourceFindingId,
    file: row.file,
    start_line: row.startLine,
    end_line: row.endLine,
    fragment: row.inputDiff,
    expectations: expectations.map((e) => ({
      id: e.id,
      kind: e.kind as EvalExpectationKind,
      file: e.file,
      start_line: e.startLine,
      end_line: e.endLine,
    })),
    created_at: row.createdAt.toISOString(),
    severity: row.severity,
    category: row.category,
    latest_result: latestResult,
  };
}

export interface InsertEvalCase {
  workspaceId: string;
  agentId: string;
  name: string;
  sourceFindingId: string;
  file: string;
  startLine: number;
  endLine: number;
  fragment: string;
  expectationKind: EvalExpectationKind;
  severity: string | null;
  category: string | null;
}

/** The name is a case's ONLY mutable field (AC-45) — the expectation-editing
 *  path (`expectations` + the delete/re-insert branch) is retired by SPEC-04. */
export interface UpdateEvalCase {
  name: string;
}

export interface InsertSuiteRun {
  workspaceId: string;
  agentId: string;
  agentName: string;
  agentVersion: number;
  caseIds: string[];
  invokedSkills: { skillId: string; skillVersion: number; skillName: string; linkOrder: number }[];
}

export interface RecordCaseResult {
  actualOutput: EvalReturnedFinding[] | null;
  pass: boolean | null;
  costUsd: number | null;
  error: string | null;
}

export interface FinalizeSuiteRun {
  status: 'completed' | 'failed';
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  costUsd: number | null;
  casesPassed: number | null;
  casesFailedToComplete: number;
}

/** Shared select projection for the suite-run base row + agent name. */
interface SuiteRunBaseRow {
  id: string;
  agentId: string;
  agentName: string;
  agentVersion: number;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  casesTotal: number;
  casesCompleted: number;
  casesPassed: number | null;
  casesFailedToComplete: number;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  costUsd: number | null;
}

const SUITE_RUN_SELECT = {
  id: t.evalSuiteRuns.id,
  agentId: t.evalSuiteRuns.agentId,
  agentName: t.agents.name,
  agentVersion: t.evalSuiteRuns.agentVersion,
  status: t.evalSuiteRuns.status,
  startedAt: t.evalSuiteRuns.startedAt,
  completedAt: t.evalSuiteRuns.completedAt,
  casesTotal: t.evalSuiteRuns.casesTotal,
  casesCompleted: t.evalSuiteRuns.casesCompleted,
  casesPassed: t.evalSuiteRuns.casesPassed,
  casesFailedToComplete: t.evalSuiteRuns.casesFailedToComplete,
  recall: t.evalSuiteRuns.recall,
  precision: t.evalSuiteRuns.precision,
  citationAccuracy: t.evalSuiteRuns.citationAccuracy,
  costUsd: t.evalSuiteRuns.costUsd,
} as const;

export class EvalRepository {
  constructor(private db: Db) {}

  // ---- eval_cases + eval_case_expectations --------------------------------

  /** The active (non-deleted) case already created from a finding, if any
   *  (AC-10). */
  async getCaseBySourceFinding(
    workspaceId: string,
    findingId: string,
  ): Promise<EvalCaseRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.sourceFindingId, findingId),
          sql`${t.evalCases.deletedAt} is null`,
        ),
      );
    if (!row) return undefined;
    const expectations = await this.expectationsForCase(row.id);
    return toCaseRecord(row, expectations);
  }

  /** An active case by id, scoped to the workspace. */
  async getCase(workspaceId: string, id: string): Promise<EvalCaseRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.id, id),
          sql`${t.evalCases.deletedAt} is null`,
        ),
      );
    if (!row) return undefined;
    const expectations = await this.expectationsForCase(row.id);
    return toCaseRecord(row, expectations);
  }

  /** An agent's active case set, newest first (`ORDER BY created_at DESC, id`). */
  async listCasesForAgent(workspaceId: string, agentId: string): Promise<EvalCaseRecord[]> {
    const rows = await this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerId, agentId),
          sql`${t.evalCases.deletedAt} is null`,
        ),
      )
      .orderBy(desc(t.evalCases.createdAt), t.evalCases.id);
    if (rows.length === 0) return [];
    const expectationRows = await this.db
      .select()
      .from(t.evalCaseExpectations)
      .where(
        inArray(
          t.evalCaseExpectations.caseId,
          rows.map((r) => r.id),
        ),
      );
    const byCase = new Map<string, EvalExpectationRow[]>();
    for (const e of expectationRows) {
      const list = byCase.get(e.caseId) ?? [];
      list.push(e);
      byCase.set(e.caseId, list);
    }
    return rows.map((r) => toCaseRecord(r, byCase.get(r.id) ?? []));
  }

  /** Insert a case with its single confirmed expectation (AC-7/AC-8). */
  async insertCase(values: InsertEvalCase): Promise<EvalCaseRecord> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(t.evalCases)
        .values({
          workspaceId: values.workspaceId,
          ownerKind: 'agent',
          ownerId: values.agentId,
          name: values.name,
          inputDiff: values.fragment,
          sourceFindingId: values.sourceFindingId,
          file: values.file,
          startLine: values.startLine,
          endLine: values.endLine,
          severity: values.severity,
          category: values.category,
        })
        .returning();
      const [expectation] = await tx
        .insert(t.evalCaseExpectations)
        .values({
          caseId: row!.id,
          kind: values.expectationKind,
          file: values.file,
          startLine: values.startLine,
          endLine: values.endLine,
        })
        .returning();
      return toCaseRecord(row!, [expectation!]);
    });
  }

  /** Update the name — the case's ONLY mutable field (AC-45). Fragment, file,
   *  range, severity, category and expectation are captured at creation and
   *  never touched here; the expectation-replacement path SPEC-04 retires
   *  (formerly here as a delete/re-insert into `eval_case_expectations`) is
   *  gone. */
  async updateCase(
    workspaceId: string,
    id: string,
    patch: UpdateEvalCase,
  ): Promise<EvalCaseRecord | undefined> {
    const [row] = await this.db
      .update(t.evalCases)
      .set({ name: patch.name })
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.id, id),
          sql`${t.evalCases.deletedAt} is null`,
        ),
      )
      .returning();
    if (!row) return undefined;
    const expectations = await this.expectationsForCase(row.id);
    return toCaseRecord(row, expectations);
  }

  /** Write a case's most recent result — a suite run OR a single-case
   *  verification (AC-48). Never touches `eval_suite_runs`/`eval_runs`, which
   *  is what makes AC-49/AC-50 structural rather than a promise. */
  async writeLatestResult(caseId: string, snapshot: EvalCaseLatestResult): Promise<void> {
    await this.db
      .update(t.evalCases)
      .set({ latestResult: snapshot })
      .where(eq(t.evalCases.id, caseId));
  }

  /** Soft delete — no `eval_cases` row is ever removed. */
  async softDeleteCase(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .update(t.evalCases)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.id, id),
          sql`${t.evalCases.deletedAt} is null`,
        ),
      )
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  private async expectationsForCase(caseId: string): Promise<EvalExpectationRow[]> {
    return this.db
      .select()
      .from(t.evalCaseExpectations)
      .where(eq(t.evalCaseExpectations.caseId, caseId));
  }

  // ---- eval_suite_runs + eval_run_skills + eval_runs -----------------------

  /**
   * Snapshot the covered case set AND the invoked skill set atomically at run
   * start (AC-14, AC-38): one `eval_suite_runs` row, one pre-inserted
   * `eval_runs` row per covered case (so the set can never grow after this
   * call returns), and one `eval_run_skills` row per invoked skill. Relies on
   * the partial unique index `eval_one_running_per_agent` for AC-16 — a
   * concurrent start for the same agent throws the raw Postgres unique-
   * violation error; the caller (runner) translates it into a 409.
   */
  async startSuiteRun(values: InsertSuiteRun): Promise<EvalSuiteRun> {
    return this.db.transaction(async (tx) => {
      const [run] = await tx
        .insert(t.evalSuiteRuns)
        .values({
          workspaceId: values.workspaceId,
          agentId: values.agentId,
          agentVersion: values.agentVersion,
          status: 'running',
          casesTotal: values.caseIds.length,
          casesCompleted: 0,
          casesFailedToComplete: 0,
        })
        .returning();
      const suiteRun = run!;

      if (values.caseIds.length > 0) {
        await tx.insert(t.evalRuns).values(
          values.caseIds.map((caseId) => ({
            caseId,
            suiteRunId: suiteRun.id,
          })),
        );
      }
      if (values.invokedSkills.length > 0) {
        await tx.insert(t.evalRunSkills).values(
          values.invokedSkills.map((s) => ({
            suiteRunId: suiteRun.id,
            skillId: s.skillId,
            skillVersion: s.skillVersion,
            skillName: s.skillName,
            linkOrder: s.linkOrder,
          })),
        );
      }

      const invokedSkills: EvalInvokedSkill[] = values.invokedSkills
        .slice()
        .sort((a, b) => a.linkOrder - b.linkOrder)
        .map((s) => ({ skill_id: s.skillId, skill_version: s.skillVersion, name: s.skillName }));

      return {
        id: suiteRun.id,
        agent_id: values.agentId,
        agent_name: values.agentName,
        agent_version: values.agentVersion,
        invoked_skills: invokedSkills,
        status: 'running',
        started_at: suiteRun.startedAt.toISOString(),
        completed_at: null,
        cases_total: values.caseIds.length,
        cases_completed: 0,
        cases_passed: null,
        cases_failed_to_complete: 0,
        recall: null,
        precision: null,
        citation_accuracy: null,
        cost_usd: null,
        case_ids: values.caseIds,
      };
    });
  }

  /** Bumped after every case, success or failure (AC-15). */
  async bumpCaseProgress(suiteRunId: string): Promise<void> {
    await this.db
      .update(t.evalSuiteRuns)
      .set({ casesCompleted: sql`${t.evalSuiteRuns.casesCompleted} + 1` })
      .where(eq(t.evalSuiteRuns.id, suiteRunId));
  }

  /** Update the pre-inserted per-case row with its outcome. */
  async recordCaseResult(
    suiteRunId: string,
    caseId: string,
    result: RecordCaseResult,
  ): Promise<void> {
    await this.db
      .update(t.evalRuns)
      .set({
        actualOutput: result.actualOutput,
        pass: result.pass,
        costUsd: result.costUsd,
        error: result.error,
      })
      .where(and(eq(t.evalRuns.suiteRunId, suiteRunId), eq(t.evalRuns.caseId, caseId)));
  }

  /** Write the run's terminal row ONCE — a completed run is never rewritten. */
  async finalizeSuiteRun(suiteRunId: string, values: FinalizeSuiteRun): Promise<void> {
    await this.db
      .update(t.evalSuiteRuns)
      .set({
        status: values.status,
        completedAt: new Date(),
        recall: values.recall,
        precision: values.precision,
        citationAccuracy: values.citationAccuracy,
        costUsd: values.costUsd,
        casesPassed: values.casesPassed,
        casesFailedToComplete: values.casesFailedToComplete,
      })
      .where(eq(t.evalSuiteRuns.id, suiteRunId));
  }

  /** `GET /agents/:id/eval-runs` — newest first. */
  async listSuiteRunsForAgent(workspaceId: string, agentId: string): Promise<EvalSuiteRun[]> {
    const rows = await this.db
      .select(SUITE_RUN_SELECT)
      .from(t.evalSuiteRuns)
      .innerJoin(t.agents, eq(t.agents.id, t.evalSuiteRuns.agentId))
      .where(and(eq(t.evalSuiteRuns.workspaceId, workspaceId), eq(t.evalSuiteRuns.agentId, agentId)))
      .orderBy(desc(t.evalSuiteRuns.startedAt), t.evalSuiteRuns.id);
    return this.attachSuiteRunExtras(rows);
  }

  /** `GET /eval-runs?limit=` — every status, across agents, newest first
   *  (AC-62). SPEC-04 retires the `status = 'completed'` filter: a run whose
   *  every case failed to complete must stay visible and selectable. */
  async listSuiteRuns(workspaceId: string, limit: number): Promise<EvalSuiteRun[]> {
    const rows = await this.db
      .select(SUITE_RUN_SELECT)
      .from(t.evalSuiteRuns)
      .innerJoin(t.agents, eq(t.agents.id, t.evalSuiteRuns.agentId))
      .where(eq(t.evalSuiteRuns.workspaceId, workspaceId))
      .orderBy(desc(t.evalSuiteRuns.startedAt), t.evalSuiteRuns.id)
      .limit(limit);
    return this.attachSuiteRunExtras(rows);
  }

  /** `GET /eval-agents` — one row per agent, its most recent run of ANY
   *  status (or null when never run), ordered by agent name then id (AC-63,
   *  AC-4). Distinct-on the latest suite run per agent id in one query. */
  async latestRunPerAgent(workspaceId: string): Promise<EvalAgentSummary[]> {
    const agentRows = await this.db
      .select({ id: t.agents.id, name: t.agents.name })
      .from(t.agents)
      .where(eq(t.agents.workspaceId, workspaceId))
      .orderBy(asc(t.agents.name), asc(t.agents.id));
    if (agentRows.length === 0) return [];

    const latestRows = await this.db
      .selectDistinctOn([t.evalSuiteRuns.agentId], SUITE_RUN_SELECT)
      .from(t.evalSuiteRuns)
      .innerJoin(t.agents, eq(t.agents.id, t.evalSuiteRuns.agentId))
      .where(eq(t.evalSuiteRuns.workspaceId, workspaceId))
      .orderBy(
        asc(t.evalSuiteRuns.agentId),
        desc(t.evalSuiteRuns.startedAt),
        desc(t.evalSuiteRuns.id),
      );
    const latestRuns = await this.attachSuiteRunExtras(latestRows);
    const runByAgent = new Map<string, EvalSuiteRun>();
    for (const run of latestRuns) runByAgent.set(run.agent_id, run);

    return agentRows.map((a) => ({
      agent_id: a.id,
      agent_name: a.name,
      latest_run: runByAgent.get(a.id) ?? null,
    }));
  }

  /** `GET /eval-runs/:id` — the suite run plus its per-case results. */
  async getSuiteRunDetail(workspaceId: string, id: string): Promise<EvalSuiteRunDetail | undefined> {
    const [row] = await this.db
      .select(SUITE_RUN_SELECT)
      .from(t.evalSuiteRuns)
      .innerJoin(t.agents, eq(t.agents.id, t.evalSuiteRuns.agentId))
      .where(and(eq(t.evalSuiteRuns.workspaceId, workspaceId), eq(t.evalSuiteRuns.id, id)));
    if (!row) return undefined;
    const [suiteRun] = await this.attachSuiteRunExtras([row]);

    const resultRows = await this.db
      .select({ run: t.evalRuns, caseName: t.evalCases.name })
      .from(t.evalRuns)
      .leftJoin(t.evalCases, eq(t.evalCases.id, t.evalRuns.caseId))
      .where(eq(t.evalRuns.suiteRunId, id))
      .orderBy(asc(t.evalCases.name), asc(t.evalRuns.id));

    const results: EvalCaseResult[] = resultRows.map(({ run, caseName }) => {
      // Never a bare `as` cast — a legacy document (or a still-unset one)
      // must not throw the route (server/insights.md 2026-08-17).
      const parsed = EvalReturnedFindingSchema.array().safeParse(run.actualOutput);
      return {
        case_id: run.caseId,
        case_name: caseName ?? '',
        completed: run.actualOutput !== null,
        error: run.error,
        passed: run.pass,
        findings: parsed.success ? parsed.data : [],
        cost_usd: run.costUsd,
      };
    });

    return { ...suiteRun!, results };
  }

  /** On boot: any `eval_suite_runs` row still 'running' is orphaned — mark it
   *  failed (AC-16, T12). NOT workspace-scoped, mirroring
   *  `ReviewRepository.reapStaleRunningRuns`. */
  async reapOrphanedRunningRuns(): Promise<number> {
    const rows = await this.db
      .update(t.evalSuiteRuns)
      .set({ status: 'failed', completedAt: new Date() })
      .where(eq(t.evalSuiteRuns.status, 'running'))
      .returning({ id: t.evalSuiteRuns.id });
    return rows.length;
  }

  private async attachSuiteRunExtras(rows: SuiteRunBaseRow[]): Promise<EvalSuiteRun[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);

    const caseRows = await this.db
      .select({ suiteRunId: t.evalRuns.suiteRunId, caseId: t.evalRuns.caseId })
      .from(t.evalRuns)
      .where(inArray(t.evalRuns.suiteRunId, ids));
    const caseIdsByRun = new Map<string, string[]>();
    for (const r of caseRows) {
      if (!r.suiteRunId) continue;
      const list = caseIdsByRun.get(r.suiteRunId) ?? [];
      list.push(r.caseId);
      caseIdsByRun.set(r.suiteRunId, list);
    }

    const skillRows = await this.db
      .select()
      .from(t.evalRunSkills)
      .where(inArray(t.evalRunSkills.suiteRunId, ids))
      .orderBy(asc(t.evalRunSkills.linkOrder));
    const skillsByRun = new Map<string, EvalInvokedSkill[]>();
    for (const r of skillRows) {
      const list = skillsByRun.get(r.suiteRunId) ?? [];
      list.push({ skill_id: r.skillId, skill_version: r.skillVersion, name: r.skillName });
      skillsByRun.set(r.suiteRunId, list);
    }

    return rows.map((r) => ({
      id: r.id,
      agent_id: r.agentId,
      agent_name: r.agentName,
      agent_version: r.agentVersion,
      invoked_skills: skillsByRun.get(r.id) ?? [],
      status: r.status as EvalRunStatus,
      started_at: r.startedAt.toISOString(),
      completed_at: r.completedAt ? r.completedAt.toISOString() : null,
      cases_total: r.casesTotal,
      cases_completed: r.casesCompleted,
      cases_passed: r.casesPassed,
      cases_failed_to_complete: r.casesFailedToComplete,
      recall: r.recall,
      precision: r.precision,
      citation_accuracy: r.citationAccuracy,
      cost_usd: r.costUsd,
      case_ids: caseIdsByRun.get(r.id) ?? [],
    }));
  }
}
