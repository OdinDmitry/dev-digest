import type { FindingRecord, Severity } from "@devdigest/shared";
import type { SeverityKey } from "../../../_components/SeverityCounts";
import { LOW_CONFIDENCE_THRESHOLD, SEVERITY_ORDER } from "./constants";

const SEVERITY_KEY_TO_ENUM: Record<SeverityKey, Severity> = {
  critical: "CRITICAL",
  warning: "WARNING",
  suggestion: "SUGGESTION",
};

/** Optionally drop low-confidence / non-matching-severity findings, sort by severity. */
export function visibleFindings(
  findings: FindingRecord[],
  hideLow: boolean,
  severityFilter?: SeverityKey | null,
): FindingRecord[] {
  let shown = findings;
  if (hideLow) shown = shown.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD);
  if (severityFilter) shown = shown.filter((f) => f.severity === SEVERITY_KEY_TO_ENUM[severityFilter]);
  return [...shown].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}
