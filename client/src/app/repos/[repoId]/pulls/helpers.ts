import type { ReviewRecord } from "@devdigest/shared";
import { SIZE_MEDIUM_MAX, SIZE_SMALL_MAX, type PrMeta, type SizeInfo } from "./constants";

/**
 * Each agent's own most recent `kind === "review"` row for a PR — mirrors the
 * server's PR-list aggregation (`server/src/modules/pulls/routes.ts`): a
 * re-run of the SAME agent supersedes its own older review, but every
 * DISTINCT agent's latest review counts. `reviews` must be newest-first
 * (the order `GET /pulls/:id/reviews` already returns).
 */
export function latestReviewPerAgent(reviews: ReviewRecord[]): ReviewRecord[] {
  const seen = new Set<string>();
  const result: ReviewRecord[] = [];
  for (const r of reviews) {
    if (r.kind !== "review") continue;
    const key = r.agent_id ?? `review:${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(r);
  }
  return result;
}

/** Bucket a PR into S/M/L by total changed lines. */
export function sizeOf(pr: PrMeta): SizeInfo {
  const lines = pr.additions + pr.deletions;
  const size = lines < SIZE_SMALL_MAX ? "S" : lines < SIZE_MEDIUM_MAX ? "M" : "L";
  return { size, lines };
}

/** Compact relative time for the list's UPDATED column (e.g. "3h", "2d"). */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const m = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
