import type { CSSProperties } from "react";
import { EDITOR_HEIGHT } from "./constants";

/**
 * Font-metric parity is the load-bearing detail here: the gutter and the
 * textarea MUST share this exact object, or their line boxes drift apart as
 * the body scrolls. `lineHeight` is a PIXEL value on purpose — a unitless
 * multiplier (e.g. 1.55) rounds independently for a block's line boxes vs. a
 * textarea's internal ones, matching for the first few lines and visibly
 * diverging by around line 40. 20px also matches `lineRowFor` in the diff
 * viewer, so this editor and the version-diff modal line up too.
 */
export const EDITOR_TEXT = {
  fontSize: 13,
  lineHeight: "20px",
  paddingTop: 10,
} satisfies CSSProperties;

export const s = {
  panel: {
    border: "1px solid var(--border-strong)",
    borderRadius: 7,
    overflow: "hidden",
  } satisfies CSSProperties,
  strip: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  filename: { fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  tokenCount: { marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  editorRow: {
    display: "flex",
    height: EDITOR_HEIGHT,
    minHeight: 0,
  } satisfies CSSProperties,
  gutter: {
    ...EDITOR_TEXT,
    overflow: "hidden",
    textAlign: "right",
    padding: `${EDITOR_TEXT.paddingTop}px 8px 10px 12px`,
    color: "var(--text-muted)",
    userSelect: "none",
    background: "var(--bg-primary)",
    borderRight: "1px solid var(--border)",
    minWidth: 44,
    flexShrink: 0,
  } satisfies CSSProperties,
  textarea: {
    ...EDITOR_TEXT,
    flex: 1,
    minWidth: 0,
    resize: "none",
    border: 0,
    outline: "none",
    padding: `${EDITOR_TEXT.paddingTop}px 12px 10px`,
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
    // wrap="off" + pre: one logical line = one visual row, always — the
    // gutter's line numbers are correct by construction, never by measurement.
    whiteSpace: "pre",
    overflowX: "auto",
    overflowY: "auto",
  } satisfies CSSProperties,
} as const;
