import type { CSSProperties } from "react";

/** Co-located styles for ResultsHeader. */
export const s = {
  headerRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  } satisfies CSSProperties,
  title: { fontSize: 20, fontWeight: 700 } satisfies CSSProperties,
  meta: { fontSize: 13, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,
  modeGroup: {
    display: "flex",
    border: "1px solid var(--border-strong)",
    borderRadius: 8,
    overflow: "hidden",
  } satisfies CSSProperties,
  modeButton: (active: boolean): CSSProperties => ({
    padding: "7px 14px",
    border: "none",
    background: active ? "var(--accent)" : "var(--bg-elevated)",
    color: active ? "#fff" : "var(--text-secondary)",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    minHeight: 32,
  }),
  tabStrip: {
    display: "flex",
    gap: 2,
    marginTop: 16,
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  tab: (active: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    padding: "10px 14px",
    border: "none",
    background: "transparent",
    borderBottom: "2px solid " + (active ? "var(--accent)" : "transparent"),
    marginBottom: -1,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: active ? 600 : 500,
    color: active ? "var(--text-primary)" : "var(--text-secondary)",
  }),
  tabScore: {
    marginLeft: 8,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
};
