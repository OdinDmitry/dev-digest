import type { CSSProperties } from "react";

/** Co-located styles for ConfigTab. */
export const s = {
  wrap: { maxWidth: 760 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", marginBottom: 20 } satisfies CSSProperties,
  h2: { fontSize: 17, fontWeight: 700, marginRight: 10 } satisfies CSSProperties,
  enabledLabel: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  notice: {
    display: "flex",
    gap: 10,
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--warn)",
    background: "var(--warn-bg)",
    border: "1px solid var(--warn)",
    borderRadius: 7,
    padding: "10px 12px",
    marginBottom: 20,
  } satisfies CSSProperties,
  evidence: { fontSize: 12, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.6 } satisfies CSSProperties,
  actions: { display: "flex", alignItems: "center", gap: 10, marginTop: 20 } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
} as const;
