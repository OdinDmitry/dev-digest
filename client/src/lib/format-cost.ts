/** Format an LLM run's USD cost for display. `null`/`undefined` (no usage
 *  data, e.g. a failed run) renders as "—", never "$0.00". */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null) return "—";
  if (usd === 0) return "$0.00";
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  // Sub-$1: 2 significant figures, trailing zeros trimmed (e.g. $0.06,
  // $0.014, $0.0013) — toFixed(2) alone would round small costs to $0.00/$0.01.
  return `$${Number(usd.toPrecision(2))}`;
}
