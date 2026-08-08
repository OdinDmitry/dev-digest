import { and, eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { Intent } from '@devdigest/shared';
import type { PullRow } from '../../../db/rows.js';

// ---- PR lookup (workspace-scoped) -----------------------------------------

export async function getPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<PullRow | undefined> {
  const [row] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
  return row;
}

export async function getRepo(
  db: Db,
  repoId: string,
): Promise<typeof t.repos.$inferSelect | undefined> {
  const [row] = await db.select().from(t.repos).where(eq(t.repos.id, repoId));
  return row;
}

export async function getPrFiles(
  db: Db,
  prId: string,
): Promise<(typeof t.prFiles.$inferSelect)[]> {
  return db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
}

/** Workspace-scoped existence check — for callers (e.g. `SmartDiffService`)
 *  that only need to decide whether to throw `NotFoundError`, never the row
 *  itself. Row types must not cross the repository boundary into a service. */
export async function pullExists(db: Db, workspaceId: string, prId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: t.pullRequests.id })
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
  return !!row;
}

/** Workspace-scoped `repo_id` projection — doubles as the existence check
 *  AND the repo lookup for callers (e.g. `BlastService`) that need the repo
 *  id but must not have `PullRow` (with its full patch/id fields) cross into
 *  a ring-2 service. `null` means "no such PR in this workspace" (either it
 *  doesn't exist, or it belongs to another workspace) — both map to the same
 *  `NotFoundError` at the call site, so no row shape is ever exposed. */
export async function pullRepoId(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ repoId: t.pullRequests.repoId })
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
  return row?.repoId ?? null;
}

/** Domain-projected `pr_files` summary (path/additions/deletions only) — for
 *  callers that need per-file change stats but not the full row (patch, id,
 *  prId). Mirrors `latestFindingLocations`'s explicit `.select({...})` shape. */
export async function prFileSummaries(
  db: Db,
  prId: string,
): Promise<{ path: string; additions: number; deletions: number }[]> {
  return db
    .select({ path: t.prFiles.path, additions: t.prFiles.additions, deletions: t.prFiles.deletions })
    .from(t.prFiles)
    .where(eq(t.prFiles.prId, prId));
}

/**
 * Record the commit a review just ran against, so the PR list can derive
 * `reviewed` vs `needs_review` (head moved since the last review) vs `stale`.
 */
export async function markReviewed(db: Db, prId: string, sha: string): Promise<void> {
  await db
    .update(t.pullRequests)
    .set({ lastReviewedSha: sha })
    .where(eq(t.pullRequests.id, prId));
}

// ---- intent ---------------------------------------------------------------

export async function upsertIntent(db: Db, prId: string, intent: Intent): Promise<void> {
  await db
    .insert(t.prIntent)
    .values({
      prId,
      intent: intent.intent,
      inScope: intent.in_scope,
      outOfScope: intent.out_of_scope,
    })
    .onConflictDoUpdate({
      target: t.prIntent.prId,
      set: { intent: intent.intent, inScope: intent.in_scope, outOfScope: intent.out_of_scope },
    });
}

export async function getIntent(db: Db, prId: string): Promise<Intent | undefined> {
  const [row] = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
  if (!row) return undefined;
  return { intent: row.intent, in_scope: row.inScope, out_of_scope: row.outOfScope };
}
