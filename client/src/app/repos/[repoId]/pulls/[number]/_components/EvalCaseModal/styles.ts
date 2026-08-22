import type { CSSProperties } from "react";

/** Co-located styles for EvalCaseModal. */
export const s = {
  // `Modal` applies zero padding to its children — every caller supplies its
  // own wrapper (client/insights.md, 2026-08-04).
  body: { padding: 24 } satisfies CSSProperties,
  footer: { display: "flex", gap: 10, justifyContent: "flex-end" } satisfies CSSProperties,
  hint: {
    fontSize: 13,
    color: "var(--text-secondary)",
    marginBottom: 14,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  fileLabel: {
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  caseName: {
    fontSize: 14,
    fontWeight: 600,
    marginTop: 6,
    marginBottom: 14,
  } satisfies CSSProperties,
  // Scrollable, never truncated — the fragment can be long, and it's plain
  // text (never rendered as markup).
  fragment: {
    margin: 0,
    padding: 12,
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 12.5,
    lineHeight: 1.6,
    maxHeight: 260,
    overflow: "auto",
    whiteSpace: "pre",
  } satisfies CSSProperties,
  expectationList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    marginTop: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;
