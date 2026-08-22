import type { CSSProperties } from "react";

/** Co-located styles for AgentEvalRow. */
export const s = {
  row: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: 14,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    cursor: "pointer",
    marginBottom: 10,
  } satisfies CSSProperties,
  left: { display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: "1 1 260px" } satisfies CSSProperties,
  iconBox: {
    width: 30,
    height: 30,
    borderRadius: 8,
    background: "var(--accent-bg)",
    color: "var(--accent)",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  } satisfies CSSProperties,
  nameRow: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 } satisfies CSSProperties,
  name: {
    fontSize: 14,
    fontWeight: 600,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  modelChip: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-secondary)",
    background: "var(--bg-hover)",
    padding: "1px 7px",
    borderRadius: 4,
    flexShrink: 0,
  } satisfies CSSProperties,
  subtitle: { fontSize: 12, color: "var(--text-muted)", marginTop: 3 } satisfies CSSProperties,
  metrics: { display: "flex", alignItems: "center", gap: 24, flex: "2 1 420px" } satisfies CSSProperties,
  metric: { flex: 1, minWidth: 110 } satisfies CSSProperties,
  chevron: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
} as const;
