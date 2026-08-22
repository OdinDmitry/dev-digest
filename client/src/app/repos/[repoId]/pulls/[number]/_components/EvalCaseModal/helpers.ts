/** Pure helpers for EvalCaseModal. */

/** Format a case/draft's line range ("11" when single-line, else "11-15"). */
export function lineRangeLabel(r: { start_line: number; end_line: number }): string {
  return r.start_line === r.end_line ? `${r.start_line}` : `${r.start_line}-${r.end_line}`;
}
