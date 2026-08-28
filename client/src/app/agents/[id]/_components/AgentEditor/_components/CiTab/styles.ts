import type { CSSProperties } from "react";

/** Co-located styles for CiTab. */
export const s = {
  wrap: { maxWidth: 980, display: "flex", flexDirection: "column", gap: 24 } satisfies CSSProperties,

  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700 } satisfies CSSProperties,
  subtitle: { fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,
  h3: { fontSize: 13, fontWeight: 700, marginBottom: 10 } satisfies CSSProperties,
  hint: { fontSize: 12, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 } satisfies CSSProperties,

  addCol: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 } satisfies CSSProperties,

  list: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  rowMain: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  rowTitle: { fontSize: 13.5, fontWeight: 600 } satisfies CSSProperties,
  rowMeta: { fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,

  currencyWord: (current: boolean): CSSProperties => ({
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.03em",
    padding: "3px 9px",
    borderRadius: 5,
    flexShrink: 0,
    color: current ? "var(--ok)" : "var(--warn)",
    background: current ? "var(--ok-bg)" : "var(--warn-bg)",
  }),

  runRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    fontSize: 12.5,
  } satisfies CSSProperties,
  runMeta: { flex: 1, minWidth: 0, color: "var(--text-secondary)" } satisfies CSSProperties,
  wordChip: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-secondary)",
    border: "1px solid var(--border-strong)",
    borderRadius: 5,
    padding: "2px 7px",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
} as const;
