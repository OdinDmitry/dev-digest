import type { CSSProperties } from "react";

/** Co-located styles for SkillListItem — a rail row, not a grid card. */
export const s = {
  row: (active: boolean, enabled: boolean): CSSProperties => ({
    padding: 12,
    borderRadius: 7,
    cursor: "pointer",
    textAlign: "left",
    width: "100%",
    border: "1px solid " + (active ? "var(--border-strong)" : "transparent"),
    background: active ? "var(--bg-hover)" : "transparent",
    // A disabled skill is dimmed the same way a disabled agent card is — it
    // still exists in the library, it just never reaches a prompt.
    opacity: enabled ? 1 : 0.6,
    marginBottom: 6,
  }),
  headerRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  iconBox: {
    width: 26,
    height: 26,
    borderRadius: 7,
    background: "var(--accent-bg)",
    color: "var(--accent)",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  } satisfies CSSProperties,
  name: {
    fontSize: 13,
    fontWeight: 600,
    flex: 1,
    minWidth: 0,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  description: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    margin: "6px 0",
    lineHeight: 1.4,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  } satisfies CSSProperties,
  metaRow: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" } satisfies CSSProperties,
  statsRow: { fontSize: 11.5, color: "var(--text-muted)", marginTop: 6 } satisfies CSSProperties,
} as const;
