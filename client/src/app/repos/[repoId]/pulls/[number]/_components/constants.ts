/** Constants shared across the PR-detail route's `_components/` (findings
 *  severity colour, used by `FindingCard`, `RunTraceDrawer`'s
 *  `FindingsSection`, and `DiffTab`'s `SmartDiffViewer`). Sibling-level file,
 *  following the precedent of `pulls/constants.ts` one level up. */

/** Severity → CSS colour token. */
export const SEV_COLOR: Record<string, string> = {
  CRITICAL: "var(--crit)",
  WARNING: "var(--warn)",
  SUGGESTION: "var(--sugg)",
  INFO: "var(--info)",
};

/** Fallback colour for an unknown severity. */
export const SEV_COLOR_FALLBACK = "var(--text-muted)";
