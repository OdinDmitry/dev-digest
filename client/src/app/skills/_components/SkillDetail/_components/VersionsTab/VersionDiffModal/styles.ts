import type { CSSProperties } from "react";

/** Co-located styles for VersionDiffModal. Colour comes from the shared
 *  `lineRowFor`/`lineSignFor` (components/diff-viewer); the gutter/text
 *  layout here is a local copy since those two are the only row primitives
 *  the diff-viewer barrel exports (CodeLine itself stays comment-coupled). */
export const s = {
  body: {
    maxHeight: 480,
    overflow: "auto",
    fontSize: 13,
    lineHeight: "20px",
  } satisfies CSSProperties,
  lineNo: {
    width: 44,
    textAlign: "right",
    padding: "0 10px 0 0",
    color: "var(--text-muted)",
    userSelect: "none",
    flexShrink: 0,
  } satisfies CSSProperties,
  lineText: {
    flex: 1,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "var(--text-primary)",
    paddingRight: 12,
  } satisfies CSSProperties,
  empty: { padding: 24, fontSize: 13, color: "var(--text-muted)", textAlign: "center" } satisfies CSSProperties,
  tooLarge: {
    padding: 24,
    fontSize: 13,
    color: "var(--text-muted)",
    textAlign: "center",
    lineHeight: 1.5,
  } satisfies CSSProperties,
} as const;
