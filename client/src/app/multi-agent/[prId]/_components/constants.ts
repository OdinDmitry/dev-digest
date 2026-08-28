/** Multi-agent results route (`/multi-agent/[prId]`) view-mode constants.
 *  `VIEW_MODES` is the single source of truth for the `?view=` whitelist —
 *  `isViewMode` derives its guard from the same array, so the route never
 *  carries a second, independently-maintained literal list (the exact bug
 *  `client/insights.md:73` records for a `?tab=` whitelist). */
export const VIEW_MODES = ["columns", "tabs"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

export function isViewMode(value: string | null | undefined): value is ViewMode {
  return value != null && (VIEW_MODES as readonly string[]).includes(value);
}
