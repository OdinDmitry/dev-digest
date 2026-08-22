import type { CSSProperties } from "react";

/** Co-located styles for RunHistoryTable. Column widths are shared between
 *  the header and every data row via `gridTemplate()` so they stay aligned —
 *  the leading checkbox column only exists when the list is scoped to one
 *  agent and selection/compare are offered (D20, AC-30). */
const GRID_TEMPLATE_WITH_CHECKBOX = "28px minmax(140px, 1.4fr) 56px 64px 64px 64px 72px 84px 72px";
const GRID_TEMPLATE_NO_CHECKBOX = "minmax(140px, 1.4fr) 56px 64px 64px 64px 72px 84px 72px";

export function gridTemplate(comparable: boolean): string {
  return comparable ? GRID_TEMPLATE_WITH_CHECKBOX : GRID_TEMPLATE_NO_CHECKBOX;
}

export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  toolbar: { display: "flex", justifyContent: "flex-end" } satisfies CSSProperties,
  headerRow: (comparable: boolean): CSSProperties => ({
    display: "grid",
    gridTemplateColumns: gridTemplate(comparable),
    gap: 8,
    padding: "0 12px",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  }),
  row: (comparable: boolean): CSSProperties => ({
    display: "grid",
    gridTemplateColumns: gridTemplate(comparable),
    gap: 8,
    alignItems: "center",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  }),
  cell: { fontSize: 13, color: "var(--text-primary)" } satisfies CSSProperties,
  cellMuted: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  checkboxCell: {
    width: 24,
    height: 24,
    display: "grid",
    placeItems: "center",
  } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-secondary)", padding: "12px 0" } satisfies CSSProperties,
} as const;
