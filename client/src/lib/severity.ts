/** Finding severity → CSS colour token. Shared across the PR-detail route's
 *  `_components/` (`FindingCard`, `RunTraceDrawer`'s `FindingsSection`,
 *  `DiffTab`'s `SmartDiffViewer`) and the multi-agent review results screen. */

/** Severity → CSS colour token. */
export const SEV_COLOR: Record<string, string> = {
  CRITICAL: "var(--crit)",
  WARNING: "var(--warn)",
  SUGGESTION: "var(--sugg)",
  INFO: "var(--info)",
};

/** Fallback colour for an unknown severity. */
export const SEV_COLOR_FALLBACK = "var(--text-muted)";
