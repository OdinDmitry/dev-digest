import type { ConventionCandidate } from "@devdigest/shared";

/** Pure helpers for the Conventions page — no I/O. */

/** Most recent `created_at` across a set of candidates, or null when empty. */
export function latestScanAt(candidates: ConventionCandidate[]): Date | null {
  if (candidates.length === 0) return null;
  let latest = 0;
  for (const c of candidates) {
    const t = Date.parse(c.created_at);
    if (!Number.isNaN(t) && t > latest) latest = t;
  }
  return latest > 0 ? new Date(latest) : null;
}

/** Coarse "Xh ago" / "Xm ago" / "just now" — no i18n library needed for this. */
export function relativeTime(date: Date, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
