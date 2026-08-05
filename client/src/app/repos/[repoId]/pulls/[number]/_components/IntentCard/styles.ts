import type { CSSProperties } from "react";

export const s = {
  box: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
  } satisfies CSSProperties,
  quote: {
    margin: 0,
    fontSize: 14,
    color: "var(--text-secondary)",
    lineHeight: 1.55,
  } satisfies CSSProperties,
  divider: {
    border: "none",
    borderTop: "1px solid var(--border)",
    margin: "14px 0",
  } satisfies CSSProperties,
  scopeBlock: {} satisfies CSSProperties,
  scopeLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 6,
  } satisfies CSSProperties,
  scopeList: {
    margin: 0,
    paddingLeft: 18,
    fontSize: 13.5,
    color: "var(--text-secondary)",
    lineHeight: 1.6,
  } satisfies CSSProperties,
  emptyState: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: "14px 16px",
  } satisfies CSSProperties,
  emptyMessage: {
    fontSize: 13.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  derivingState: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: "14px 16px",
    fontSize: 13.5,
    color: "var(--text-muted)",
    fontStyle: "italic",
  } satisfies CSSProperties,
} as const;
