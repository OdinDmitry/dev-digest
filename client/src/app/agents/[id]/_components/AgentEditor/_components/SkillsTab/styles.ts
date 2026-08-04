import type { CSSProperties } from "react";

/** Co-located styles for SkillsTab. */
export const s = {
  wrap: { padding: "24px 28px 40px", maxWidth: 900 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 12, marginBottom: 10 } satisfies CSSProperties,
  h2: { fontSize: 17, fontWeight: 700 } satisfies CSSProperties,
  search: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    width: 190,
    marginLeft: "auto",
  } satisfies CSSProperties,
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 12.5,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  hint: { fontSize: 12.5, color: "var(--text-muted)", marginBottom: 16, lineHeight: 1.5 } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,

  row: (linked: boolean, isOver: boolean, isDragging: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 14px",
    borderRadius: 8,
    cursor: "pointer",
    // A linked row sits on the elevated surface; an unlinked one recedes.
    border: "1px solid " + (isOver ? "var(--accent)" : linked ? "var(--border-strong)" : "var(--border)"),
    background: linked ? "var(--bg-elevated)" : "transparent",
    opacity: isDragging ? 0.45 : 1,
  }),
  grip: (draggable: boolean): CSSProperties => ({
    color: draggable ? "var(--text-muted)" : "var(--border-strong)",
    cursor: draggable ? "grab" : "not-allowed",
    flexShrink: 0,
  }),
  checkbox: (on: boolean): CSSProperties => ({
    width: 16,
    height: 16,
    borderRadius: 4,
    flexShrink: 0,
    border: "1.5px solid " + (on ? "var(--accent)" : "var(--border-strong)"),
    background: on ? "var(--accent)" : "transparent",
    display: "grid",
    placeItems: "center",
  }),
  checkIcon: { color: "#fff" } satisfies CSSProperties,
  name: {
    fontSize: 13,
    fontWeight: 600,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  disabledNote: { fontSize: 11.5, color: "var(--warn)" } satisfies CSSProperties,
} as const;
