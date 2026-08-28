/** Constants shared across the PR-detail route's `_components/` (findings
 *  severity colour, used by `FindingCard`, `RunTraceDrawer`'s
 *  `FindingsSection`, and `DiffTab`'s `SmartDiffViewer`). Sibling-level file,
 *  following the precedent of `pulls/constants.ts` one level up.
 *
 *  `SEV_COLOR`/`SEV_COLOR_FALLBACK` moved to `@/lib/severity` (also used by
 *  the multi-agent review results screen) and are re-exported here unchanged
 *  so existing importers of this module keep working. */
export { SEV_COLOR, SEV_COLOR_FALLBACK } from "@/lib/severity";
