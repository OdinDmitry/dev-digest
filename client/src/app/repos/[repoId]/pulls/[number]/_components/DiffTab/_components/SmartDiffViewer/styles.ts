import type { CSSProperties } from "react";

/** Co-located styles for SmartDiffViewer. */
export const s = {
  list: { display: "flex", flexDirection: "column", gap: 18 } satisfies CSSProperties,
  group: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "6px 2px",
    cursor: "pointer",
  } satisfies CSSProperties,
  groupLabel: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  groupMeta: {
    fontSize: 12,
    color: "var(--text-muted)",
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,
  groupFiles: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  fileWrap: { display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
  largeFileWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    borderLeft: "3px solid var(--warn)",
    paddingLeft: 8,
    borderRadius: 4,
  } satisfies CSSProperties,
  fileMetaRow: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  largeFileChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    fontWeight: 600,
    color: "var(--warn)",
    background: "var(--warn-bg)",
    borderRadius: 4,
    padding: "2px 6px",
  } satisfies CSSProperties,
  findingChip: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-muted)",
    background: "var(--bg-hover)",
    borderRadius: 4,
    padding: "2px 6px",
  } satisfies CSSProperties,
  pseudocodeSummary: {
    fontSize: 12,
    color: "var(--text-muted)",
    fontStyle: "italic",
  } satisfies CSSProperties,
  markerStack: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
  } satisfies CSSProperties,
  markerDot: (color: string): CSSProperties => ({
    width: 8,
    height: 8,
    borderRadius: 99,
    border: "none",
    padding: 0,
    cursor: "pointer",
    background: color,
  }),
} as const;

export function chevronFor(open: boolean): CSSProperties {
  return {
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
  };
}
