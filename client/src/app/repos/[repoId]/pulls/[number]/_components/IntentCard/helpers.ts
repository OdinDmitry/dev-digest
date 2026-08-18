import type { BriefRisk } from "@devdigest/shared";

/** high > medium > low. Ties (same severity) are broken by original stored
 *  order — this is a manual tie-break, not a bare `Array.prototype.sort`
 *  call, so the "stable within a severity" behaviour doesn't depend on the
 *  runtime's sort-stability guarantee. */
const SEVERITY_RANK: Record<BriefRisk["severity"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

/** Sorts risks by descending severity, preserving the stored order of risks
 *  that share a severity. Pure — does not mutate `risks`. */
export function sortRisks(risks: BriefRisk[]): BriefRisk[] {
  return risks
    .map((risk, index) => ({ risk, index }))
    .sort((a, b) => SEVERITY_RANK[a.risk.severity] - SEVERITY_RANK[b.risk.severity] || a.index - b.index)
    .map((entry) => entry.risk);
}
