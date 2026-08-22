import type { CSSProperties } from "react";

/** Co-located styles for RunHistoryTable. */
export const s = {
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 } satisfies CSSProperties,
  th: {
    textAlign: "left",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    padding: "8px 10px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  row: { borderBottom: "1px solid var(--border)" } satisfies CSSProperties,
  td: { padding: "10px 10px", verticalAlign: "middle", color: "var(--text-primary)" } satisfies CSSProperties,
  tdMuted: { padding: "10px 10px", color: "var(--text-muted)" } satisfies CSSProperties,
  // NFR: the selection control must be at least 24x24 CSS px.
  selectBtn: (checked: boolean): CSSProperties => ({
    width: 24,
    height: 24,
    borderRadius: 5,
    border: "1.5px solid " + (checked ? "var(--accent)" : "var(--border-strong)"),
    background: checked ? "var(--accent)" : "transparent",
    display: "grid",
    placeItems: "center",
    padding: 0,
    cursor: "pointer",
    color: "#fff",
  }),
  metricValue: { fontWeight: 600 } satisfies CSSProperties,
  deltaRow: { display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,
  deltaUp: { color: "var(--ok)" } satisfies CSSProperties,
  deltaDown: { color: "var(--crit)" } satisfies CSSProperties,
  failedCell: { padding: "10px 10px", color: "var(--crit)" } satisfies CSSProperties,
} as const;
