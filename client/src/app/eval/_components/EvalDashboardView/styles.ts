import type { CSSProperties } from "react";

/** Co-located styles for EvalDashboardView. */
export const s = {
  wrap: {
    padding: "24px 28px 48px",
    display: "flex",
    flexDirection: "column",
    gap: 32,
    maxWidth: 1080,
  } satisfies CSSProperties,
  title: { fontSize: 22, fontWeight: 700 } satisfies CSSProperties,
  h2: { fontSize: 15, fontWeight: 700, marginBottom: 12 } satisfies CSSProperties,
  hint: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  agentList: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 4 } satisfies CSSProperties,
  agentRow: (selected: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 16,
    width: "100%",
    textAlign: "left",
    padding: "10px 14px",
    borderRadius: 8,
    cursor: "pointer",
    border: "1px solid " + (selected ? "var(--accent)" : "var(--border)"),
    background: selected ? "var(--accent-bg)" : "var(--bg-elevated)",
  }),
  agentInfo: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  agentName: { fontSize: 14, fontWeight: 600 } satisfies CSSProperties,
  agentMeta: { fontSize: 12, color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,
  agentMetrics: { display: "flex", gap: 18, flexShrink: 0 } satisfies CSSProperties,
  metricCell: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 } satisfies CSSProperties,
  metricLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  metricValue: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
} as const;
