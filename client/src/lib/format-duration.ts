/** Format a duration in milliseconds for display. `null`/`undefined` (no
 *  duration recorded, e.g. an estimate with no prior run) renders as "—" —
 *  same convention as `formatCost` (`@/lib/format-cost`). */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}
