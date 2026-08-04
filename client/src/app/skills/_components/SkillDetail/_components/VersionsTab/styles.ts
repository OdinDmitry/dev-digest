import type { CSSProperties } from "react";

/** Co-located styles for VersionsTab. */
export const s = {
  wrap: { maxWidth: 760 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 10, marginBottom: 4 } satisfies CSSProperties,
  h2: { fontSize: 17, fontWeight: 700 } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-secondary)", margin: "4px 0 16px", lineHeight: 1.5 } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 14px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  rowText: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  rowTitle: {
    fontSize: 13,
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  rowDate: { fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,
  rowActions: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 } satisfies CSSProperties,
} as const;
