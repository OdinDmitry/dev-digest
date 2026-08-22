import type { EvalSuiteRun } from "@devdigest/shared";

/* Pure formatters shared across every eval-run surface: RunHistoryTable,
   RunCompareDialog, EvalDashboardView and EvalsTab's own metrics block
   (D16 — promoted out of RunHistoryTable/helpers.ts once a third consumer
   made the duplication real rather than speculative). */

/** A displayed metric/cost value: `text` is what renders, `absent` is true
 *  exactly when the underlying value is `null` — never derived from `0`
 *  (client/insights.md, 2026-07-30: `?? 0` before a display collapses
 *  "missing" into "zero"). */
export interface DisplayValue {
  text: string;
  absent: boolean;
}

/** A recall/precision/citation-accuracy fraction (0..1) as a percentage, or
 *  an em dash when the metric has no value (AC-27/AC-37 — a metric whose
 *  denominator was zero is absent, never rendered as 0%). */
export function formatMetricPercent(v: number | null): DisplayValue {
  if (v == null) return { text: "—", absent: true };
  return { text: `${Math.round(v * 100)}%`, absent: false };
}

/** A run's USD cost, or an em dash when it could not be determined
 *  (AC-37 — a cost of `null` is a distinct state from a cost of `0`). */
export function formatRunCost(v: number | null): DisplayValue {
  if (v == null) return { text: "—", absent: true };
  if (v === 0) return { text: "$0.00", absent: false };
  if (v >= 1) return { text: `$${v.toFixed(2)}`, absent: false };
  return { text: `$${Number(v.toPrecision(2))}`, absent: false };
}

/** "N/M" pass count, or an em dash while the run hasn't finished scoring
 *  (`cases_passed` is `null` until a run completes). */
export function formatPassCount(casesPassed: number | null, casesTotal: number): DisplayValue {
  if (casesPassed == null) return { text: "—", absent: true };
  return { text: `${casesPassed}/${casesTotal}`, absent: false };
}

/** Render a run's `started_at` for a table (falls back to the raw ISO
 *  string on an unparseable date, matching `ReviewRunAccordion`'s `formatWhen`). */
export function formatStartedAt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** The two selected runs in chronological order (earlier, later) — the
 *  selection order a user clicks in is not the comparison's "old → new"
 *  order. Ties break on `id` for determinism. */
export function chronological(a: EvalSuiteRun, b: EvalSuiteRun): [EvalSuiteRun, EvalSuiteRun] {
  if (a.started_at === b.started_at) return a.id <= b.id ? [a, b] : [b, a];
  return a.started_at <= b.started_at ? [a, b] : [b, a];
}
