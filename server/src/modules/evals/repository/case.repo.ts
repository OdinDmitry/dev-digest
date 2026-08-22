import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { EvalExpectation } from '@devdigest/shared';

/**
 * One `eval_cases` row, joined with the display-only bits of its origin
 * (finding title / PR number) that are NOT stored on the case itself — only
 * `origin_finding_id`/`origin_pr_id` are. Kept local to this module (not
 * `db/rows.ts`) since no other module reads eval cases (Constraints §5).
 */
export interface EvalCaseRow {
  id: string;
  workspaceId: string;
  ownerKind: 'skill' | 'agent';
  ownerId: string;
  name: string;
  inputDiff: string;
  expectedOutput: unknown;
  notes: string | null;
  repoId: string | null;
  originFindingId: string | null;
  originPrId: string | null;
  originFindingTitle: string | null;
  originPrNumber: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InsertEvalCase {
  workspaceId: string;
  /** The owning agent id — always derived server-side, never from the body. */
  ownerId: string;
  name: string;
  inputDiff: string;
  repoId: string | null;
  expectations: EvalExpectation[];
  notes?: string | null;
  originFindingId?: string | null;
  originPrId?: string | null;
}

export interface UpdateEvalCase {
  name?: string;
  inputDiff?: string;
  repoId?: string | null;
  expectations?: EvalExpectation[];
  notes?: string | null;
}

const selection = {
  id: t.evalCases.id,
  workspaceId: t.evalCases.workspaceId,
  ownerKind: t.evalCases.ownerKind,
  ownerId: t.evalCases.ownerId,
  name: t.evalCases.name,
  inputDiff: t.evalCases.inputDiff,
  expectedOutput: t.evalCases.expectedOutput,
  notes: t.evalCases.notes,
  repoId: t.evalCases.repoId,
  originFindingId: t.evalCases.originFindingId,
  originPrId: t.evalCases.originPrId,
  originFindingTitle: t.findings.title,
  originPrNumber: t.pullRequests.number,
  createdAt: t.evalCases.createdAt,
  updatedAt: t.evalCases.updatedAt,
};

function baseQuery(db: Db) {
  return db
    .select(selection)
    .from(t.evalCases)
    .leftJoin(t.findings, eq(t.evalCases.originFindingId, t.findings.id))
    .leftJoin(t.pullRequests, eq(t.evalCases.originPrId, t.pullRequests.id));
}

export class EvalCaseRepository {
  constructor(private db: Db) {}

  /** Every case owned by an agent, workspace-scoped. `created_at ASC, id ASC`
   *  — `id` is a unique final tiebreaker (`server/insights.md` 2026-08-04). */
  async listForAgent(workspaceId: string, agentId: string): Promise<EvalCaseRow[]> {
    return baseQuery(this.db)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.ownerId, agentId),
        ),
      )
      .orderBy(asc(t.evalCases.createdAt), asc(t.evalCases.id));
  }

  async getById(workspaceId: string, id: string): Promise<EvalCaseRow | undefined> {
    const [row] = await baseQuery(this.db).where(
      and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)),
    );
    return row;
  }

  async create(values: InsertEvalCase): Promise<EvalCaseRow> {
    const [inserted] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: 'agent',
        ownerId: values.ownerId,
        name: values.name,
        inputDiff: values.inputDiff,
        repoId: values.repoId,
        expectedOutput: values.expectations,
        notes: values.notes ?? null,
        originFindingId: values.originFindingId ?? null,
        originPrId: values.originPrId ?? null,
      })
      .returning({ id: t.evalCases.id });
    const row = await this.getById(values.workspaceId, inserted!.id);
    return row!;
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateEvalCase,
  ): Promise<EvalCaseRow | undefined> {
    const [updated] = await this.db
      .update(t.evalCases)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.inputDiff !== undefined ? { inputDiff: patch.inputDiff } : {}),
        ...(patch.repoId !== undefined ? { repoId: patch.repoId } : {}),
        ...(patch.expectations !== undefined ? { expectedOutput: patch.expectations } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning({ id: t.evalCases.id });
    if (!updated) return undefined;
    return this.getById(workspaceId, updated.id);
  }

  /** Returns false if no such case existed in the workspace. */
  async delete(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }
}
