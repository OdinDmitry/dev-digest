import type { CSSProperties } from "react";

/** Co-located styles for DisagreementBlock. */
export const s = {
  section: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    padding: 16,
  } satisfies CSSProperties,
  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  } satisfies CSSProperties,
  title: { fontSize: 15, fontWeight: 700 } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  rows: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  row: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 12,
  } satisfies CSSProperties,
  location: {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 13,
    fontWeight: 700,
    marginBottom: 8,
  } satisfies CSSProperties,
  takes: {
    display: "grid",
    // `auto-fit`, not `auto-fill`: auto-fill keeps the empty trailing tracks it
    // could fit, so three takes in a wide row sat in the first three of ~six
    // tracks and looked left-packed. auto-fit collapses the empty tracks, so
    // the takes divide the row evenly — while still wrapping once there are
    // enough agents that 180px each no longer fits on one line.
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 8,
  } satisfies CSSProperties,
  take: {
    borderLeft: "3px solid var(--border-strong)",
    paddingLeft: 8,
  } satisfies CSSProperties,
  takeBorder: (color: string): CSSProperties => ({ borderLeftColor: color }),
  agentName: { fontSize: 12.5, fontWeight: 600 } satisfies CSSProperties,
  severity: (color: string): CSSProperties => ({
    fontSize: 11.5,
    fontWeight: 600,
    color,
    marginTop: 2,
  }),
  note: { fontSize: 12.5, color: "var(--text-secondary)", marginTop: 2, lineHeight: 1.4 } satisfies CSSProperties,
  ignored: { fontSize: 12.5, color: "var(--text-muted)", marginTop: 2, fontStyle: "italic" } satisfies CSSProperties,
} as const;
