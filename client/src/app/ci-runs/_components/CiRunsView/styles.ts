import type { CSSProperties } from "react";

/** Co-located styles for CiRunsView. */
export const s = {
  wrap: { padding: 28, maxWidth: 1100, margin: "0 auto" } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 16, marginBottom: 8 } satisfies CSSProperties,
  h1: { fontSize: 20, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  subtitle: { fontSize: 12.5, color: "var(--text-muted)", marginBottom: 20 } satisfies CSSProperties,

  rejections: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: 12,
    borderRadius: 8,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    color: "var(--warn)",
    fontSize: 12.5,
    marginBottom: 16,
  } satisfies CSSProperties,
  rejectionsHeading: { fontWeight: 700, marginBottom: 2 } satisfies CSSProperties,

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

  wordChip: (tone: "neutral" | "ok" | "warn" | "crit"): CSSProperties => ({
    display: "inline-block",
    fontSize: 11,
    fontWeight: 700,
    padding: "2px 8px",
    borderRadius: 5,
    color:
      tone === "ok" ? "var(--ok)" : tone === "warn" ? "var(--warn)" : tone === "crit" ? "var(--crit)" : "var(--text-secondary)",
    background:
      tone === "ok" ? "var(--ok-bg)" : tone === "warn" ? "var(--warn-bg)" : tone === "crit" ? "var(--crit-bg)" : "var(--bg-hover)",
  }),

  unavailableReason: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  forkNote: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
