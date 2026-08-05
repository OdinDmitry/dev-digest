/* diff-viewer — unified-diff viewer with optional inline GitHub comments.
   Public surface: the DiffViewer component + the DiffCommentApi contract, plus
   the row-rendering primitives (Line, lineRowFor, lineSignFor) so OTHER diff
   UIs (e.g. the Skills version-diff modal) render add/del rows identically
   without re-deriving the `--code-add`/`--code-del` styling — deliberately
   NOT re-exporting CodeLine, which is coupled to the inline-comment machinery
   these other UIs don't want. FileCard IS re-exported: it's the natural
   per-file rendering unit (header + lines) for a caller (e.g. SmartDiffViewer)
   that needs to lay out one file per group rather than one flat file list —
   it needs none of CodeLine's inline-comment-specific machinery to be useful
   standalone. */
export { DiffViewer } from "./DiffViewer";
export { FileCard } from "./FileCard";
export type { DiffCommentApi } from "./comments";
export { lineRowFor, lineSignFor } from "./styles";
export type { Line } from "./helpers";
