import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { BriefDoc, BriefRecord, PrRunSummary } from '@devdigest/shared';
import { BriefRecord as BriefRecordSchema } from '@devdigest/shared';
import { pickLatestReviewPerPr, rollupSeverities } from '../pulls/status.js';

/**
 * `pr_brief` data-access — the ONLY file in this module touching Drizzle. It
 * owns `pr_brief` and the run-summary read across `reviews`/`findings`
 * (`agent_runs` is not needed: score/verdict live on the `reviews` row
 * itself — see the plan's Open Questions §4). Row types die here — nothing
 * past this boundary sees a raw DB row.
 */
export class BriefRepository {
  constructor(private db: Db) {}

  /**
   * Cache read, scoped to a specific head commit. `row.headSha !== headSha`
   * (a brief stored for an OLDER commit) is treated identically to "nothing
   * stored" (AC-9) — the caller (`BriefService`) still runs `requirePull`
   * first, this method never re-asserts workspace scope on its own (it takes
   * no `workspaceId`; Constraint 8's guard lives in the service, not here).
   */
  async getForHead(prId: string, headSha: string): Promise<BriefRecord | null> {
    const [row] = await this.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    if (!row || row.headSha !== headSha) return null;
    // Constraint 9: a `.default()` on a persisted contract is only real if
    // the read path parses — never cast `row.json as BriefRecord`. Fall back
    // to `null` (treated as absent) on a parse failure rather than throwing.
    const parsed = BriefRecordSchema.safeParse(row.json);
    return parsed.success ? parsed.data : null;
  }

  /** Replace the whole stored brief for `prId`, keyed by the head commit it
   *  was generated for. `onConflictDoUpdate` on the `prId` PK — one row per
   *  PR, never a duplicate. */
  async upsert(prId: string, headSha: string, doc: BriefDoc): Promise<BriefRecord> {
    const record: BriefRecord = { ...doc, pr_id: prId, head_sha: headSha };
    const now = new Date();
    await this.db
      .insert(t.prBrief)
      .values({ prId, headSha, json: record, createdAt: now })
      .onConflictDoUpdate({
        target: t.prBrief.prId,
        set: { headSha, json: record, createdAt: now },
      });
    return record;
  }

  /**
   * The PR's latest completed review (`kind: 'review'`), as verdict + finding
   * counts + score — or `null` when there is none. Uses `pickLatestReviewPerPr`
   * (T15) so "which review is the score" is structurally the same rule the
   * PR list uses, not a second, independently-drifting copy.
   */
  async runSummary(prId: string): Promise<PrRunSummary | null> {
    const rows = await this.db
      .select({
        prId: t.reviews.prId,
        reviewId: t.reviews.id,
        verdict: t.reviews.verdict,
        score: t.reviews.score,
      })
      .from(t.reviews)
      .where(and(eq(t.reviews.prId, prId), eq(t.reviews.kind, 'review')))
      .orderBy(desc(t.reviews.createdAt));

    const latest = pickLatestReviewPerPr(rows).get(prId);
    if (!latest) return null;

    const findingRows = await this.db
      .select({ severity: t.findings.severity })
      .from(t.findings)
      .where(and(eq(t.findings.reviewId, latest.reviewId), isNull(t.findings.dismissedAt)));
    const counts = rollupSeverities(findingRows);

    return {
      // A `kind: 'review'` row always carries a verdict by the time it's
      // persisted (`run-executor.ts`); the empty-string fallback is defensive
      // only, never expected to fire on real data.
      verdict: latest.verdict ?? '',
      findings_count: counts.critical + counts.warning + counts.suggestion,
      blockers_count: counts.critical,
      score: latest.score,
    };
  }
}
