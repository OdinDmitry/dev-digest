import type { CiRun } from "@devdigest/shared";

/** `iso` → the browser's locale format, or the raw string when unparsable. */
export function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Verdict/status enum values are snake_case; message keys are camelCase. */
export const VERDICT_KEY: Record<string, string> = {
  approved: "approved",
  changes_requested: "changesRequested",
  commented: "commented",
  skipped: "skipped",
};
export const STATUS_KEY: Record<string, string> = {
  in_progress: "inProgress",
  recorded: "recorded",
  unavailable: "unavailable",
};

/** Retrieved text — the job link is emitted only for an `https://` URL
 *  (security A05: reject anything else, e.g. `javascript:`). */
export function isHttpsUrl(url: string | null | undefined): url is string {
  return !!url && url.startsWith("https://");
}

/** Most-recent-first — defensive client-side sort even though the route
 *  already returns runs in this order, so a future server-side change can't
 *  silently reorder the page without a visible regression here too. */
export function sortByRecency(runs: CiRun[]): CiRun[] {
  return [...runs].sort((a, b) => {
    const at = a.ran_at ? new Date(a.ran_at).getTime() : 0;
    const bt = b.ran_at ? new Date(b.ran_at).getTime() : 0;
    return bt - at;
  });
}
