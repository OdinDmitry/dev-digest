import type { Db } from '../../../db/client.js';

/**
 * `EvalRepository` — composing facade over the per-aggregate repositories
 * (`case.repo.ts`, `run.repo.ts`), mirroring `modules/reviews/repository.ts`.
 * Consumers depend on this class, never on the split files directly.
 */
import {
  EvalCaseRepository,
  type EvalCaseRow,
  type InsertEvalCase,
  type UpdateEvalCase,
} from './case.repo.js';
import {
  EvalRunRepository,
  type EvalSuiteRunRow,
  type EvalCaseResultRow,
  type InsertEvalSuiteRun,
  type InsertEvalCaseResult,
} from './run.repo.js';

export type {
  EvalCaseRow,
  InsertEvalCase,
  UpdateEvalCase,
  EvalSuiteRunRow,
  EvalCaseResultRow,
  InsertEvalSuiteRun,
  InsertEvalCaseResult,
};

export class EvalRepository {
  private cases: EvalCaseRepository;
  private runs: EvalRunRepository;

  constructor(db: Db) {
    this.cases = new EvalCaseRepository(db);
    this.runs = new EvalRunRepository(db);
  }

  // ---- eval_cases -----------------------------------------------------

  listForAgent(workspaceId: string, agentId: string): Promise<EvalCaseRow[]> {
    return this.cases.listForAgent(workspaceId, agentId);
  }

  getCaseById(workspaceId: string, id: string): Promise<EvalCaseRow | undefined> {
    return this.cases.getById(workspaceId, id);
  }

  createCase(values: InsertEvalCase): Promise<EvalCaseRow> {
    return this.cases.create(values);
  }

  updateCase(
    workspaceId: string,
    id: string,
    patch: UpdateEvalCase,
  ): Promise<EvalCaseRow | undefined> {
    return this.cases.update(workspaceId, id, patch);
  }

  deleteCase(workspaceId: string, id: string): Promise<boolean> {
    return this.cases.delete(workspaceId, id);
  }

  // ---- eval_suite_runs / eval_case_results (Phase B wires the caller) -----

  createRun(values: InsertEvalSuiteRun): Promise<EvalSuiteRunRow> {
    return this.runs.createRun(values);
  }

  insertCaseResults(runId: string, rows: InsertEvalCaseResult[]): Promise<EvalCaseResultRow[]> {
    return this.runs.insertCaseResults(runId, rows);
  }

  getRun(workspaceId: string, runId: string): Promise<EvalSuiteRunRow | undefined> {
    return this.runs.getRun(workspaceId, runId);
  }

  listRunsForAgent(workspaceId: string, agentId: string): Promise<EvalSuiteRunRow[]> {
    return this.runs.listRunsForAgent(workspaceId, agentId);
  }

  latestCompletedRun(workspaceId: string, agentId: string): Promise<EvalSuiteRunRow | undefined> {
    return this.runs.latestCompletedRun(workspaceId, agentId);
  }

  activeRunForAgent(workspaceId: string, agentId: string): Promise<EvalSuiteRunRow | undefined> {
    return this.runs.activeRunForAgent(workspaceId, agentId);
  }
}
