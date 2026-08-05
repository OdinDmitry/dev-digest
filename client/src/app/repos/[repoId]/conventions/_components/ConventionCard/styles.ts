import type { CSSProperties } from "react";

/** Co-located styles for ConventionCard. */
export const s = {
  card: (status: "pending" | "accepted" | "rejected"): CSSProperties => ({
    borderRadius: 8,
    borderStyle: "solid",
    borderColor: status === "accepted" ? "var(--ok)" : "var(--border)",
    borderWidth: 1,
    borderLeftWidth: 3,
    borderLeftColor:
      status === "accepted" ? "var(--ok)" : status === "rejected" ? "var(--text-muted)" : "var(--accent)",
    background: "var(--bg-elevated)",
    padding: "14px 16px",
    opacity: status === "rejected" ? 0.6 : 1,
    transition: "opacity .2s, border-color .12s",
  }),
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  } satisfies CSSProperties,
  title: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
    lineHeight: 1.4,
  } satisfies CSSProperties,
  categoryTag: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginBottom: 4,
  } satisfies CSSProperties,
  actions: {
    display: "flex",
    gap: 8,
    flexShrink: 0,
  } satisfies CSSProperties,
  evidence: {
    marginTop: 10,
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    overflow: "hidden",
  } satisfies CSSProperties,
  evidenceHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 10px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  snippet: {
    margin: 0,
    padding: "10px 12px",
    fontSize: 12.5,
    lineHeight: 1.6,
    overflowX: "auto",
    color: "var(--text-secondary)",
    whiteSpace: "pre",
  } satisfies CSSProperties,
  footer: {
    marginTop: 12,
    maxWidth: 280,
  } satisfies CSSProperties,
} as const;
