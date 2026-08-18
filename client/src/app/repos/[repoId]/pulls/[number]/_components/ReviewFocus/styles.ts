import type { CSSProperties } from "react";

/** Co-located styles for ReviewFocus (mockups 6-7). */
export const s = {
  box: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 16,
  } satisfies CSSProperties,
  empty: {
    fontSize: 13.5,
    color: "var(--text-muted)",
    fontStyle: "italic",
  } satisfies CSSProperties,
  list: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  item: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
  } satisfies CSSProperties,
  bullet: {
    color: "var(--text-muted)",
    fontSize: 13,
    lineHeight: 1.6,
  } satisfies CSSProperties,
  itemText: {
    fontSize: 13.5,
    color: "var(--text-secondary)",
    lineHeight: 1.6,
  } satisfies CSSProperties,
  refSep: { color: "var(--text-muted)" } satisfies CSSProperties,
  reasonSep: { color: "var(--text-muted)" } satisfies CSSProperties,
  refButton: {
    background: "none",
    border: "none",
    padding: 0,
    fontSize: 13,
    color: "var(--sugg)",
    cursor: "pointer",
  } satisfies CSSProperties,
} as const;
