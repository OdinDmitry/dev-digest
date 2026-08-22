import type { CSSProperties } from "react";

/** Co-located styles for RunCompareDialog. */
export const s = {
  // `Modal` applies zero padding to its children (client/insights.md, 2026-08-04).
  body: { padding: 24 } satisfies CSSProperties,
  metricGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: 12,
    marginBottom: 20,
  } satisfies CSSProperties,
  metricCard: {
    padding: 14,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  metricLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.04em",
    color: "var(--text-muted)",
    marginBottom: 8,
  } satisfies CSSProperties,
  metricValues: { display: "flex", alignItems: "baseline", gap: 6, fontSize: 15 } satisfies CSSProperties,
  metricArrow: { color: "var(--text-muted)", fontSize: 13 } satisfies CSSProperties,
  metricNew: { fontWeight: 700 } satisfies CSSProperties,
  metricDelta: { fontSize: 12, marginLeft: 4, color: "var(--text-secondary)" } satisfies CSSProperties,
  sectionHeading: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 10,
  } satisfies CSSProperties,
  statement: {
    fontSize: 13,
    color: "var(--text-secondary)",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    marginBottom: 14,
  } satisfies CSSProperties,
  diffBody: {
    fontSize: 12.5,
    lineHeight: 1.6,
    maxHeight: 320,
    overflow: "auto",
    borderRadius: 8,
    border: "1px solid var(--border)",
  } satisfies CSSProperties,
  diffEmpty: { fontSize: 13, color: "var(--text-secondary)", padding: 12 } satisfies CSSProperties,
  lineNo: { display: "inline-block", width: 44, textAlign: "right", marginRight: 8 } satisfies CSSProperties,
  lineText: { whiteSpace: "pre-wrap" } satisfies CSSProperties,
  footer: { display: "flex", justifyContent: "flex-end" } satisfies CSSProperties,
} as const;
