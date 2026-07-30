import type { ReviewRecord, FindingRecord } from "@devdigest/shared";

/**
 * This run's (undismissed) findings, keyed by run_id — feeds the timeline
 * row's hover popup with data already on the page (no extra fetch). Scoped
 * to kind==="review" (matches the server's "latest review" semantics
 * elsewhere) and MERGED rather than overwritten on a duplicate run_id, so a
 * stray non-review row sharing a run_id can't silently drop findings.
 */
export function buildFindingsByRunId(runs: ReviewRecord[]): Map<string, FindingRecord[]> {
  const m = new Map<string, FindingRecord[]>();
  for (const r of runs) {
    if (r.kind !== "review" || !r.run_id) continue;
    const kept = r.findings.filter((f) => !f.dismissed_at);
    m.set(r.run_id, [...(m.get(r.run_id) ?? []), ...kept]);
  }
  return m;
}
