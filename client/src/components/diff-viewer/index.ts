/* diff-viewer — unified-diff viewer with optional inline GitHub comments.
   Public surface: the DiffViewer component + the DiffCommentApi contract, plus
   the row-rendering primitives (Line, lineRowFor, lineSignFor) so OTHER diff
   UIs (e.g. the Skills version-diff modal) render add/del rows identically
   without re-deriving the `--code-add`/`--code-del` styling — deliberately
   NOT re-exporting CodeLine, which is coupled to the inline-comment machinery
   these other UIs don't want. */
export { DiffViewer } from "./DiffViewer";
export type { DiffCommentApi } from "./comments";
export { lineRowFor, lineSignFor } from "./styles";
export type { Line } from "./helpers";
