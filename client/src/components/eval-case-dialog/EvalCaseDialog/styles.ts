import type { CSSProperties } from "react";

/** Co-located styles for EvalCaseDialog. `Modal` applies zero padding to its
 *  children (client/insights.md, 2026-08-04) — `body` is this dialog's own
 *  padding wrapper. */
export const s = {
  body: {
    padding: 24,
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 24,
  } satisfies CSSProperties,
  col: { display: "flex", flexDirection: "column", minWidth: 0 } satisfies CSSProperties,
  footer: { display: "flex", gap: 10, justifyContent: "flex-end" } satisfies CSSProperties,

  banner: (kind: "positive" | "negative"): CSSProperties => ({
    padding: "10px 14px",
    borderRadius: 8,
    marginBottom: 16,
    fontSize: 12.5,
    lineHeight: 1.5,
    border: "1px solid " + (kind === "positive" ? "var(--accent)" : "var(--warn)"),
    background: kind === "positive" ? "var(--accent-bg)" : "var(--warn-bg)",
    color: kind === "positive" ? "var(--accent-text)" : "var(--warn)",
  }),

  mono: { fontFamily: "var(--font-mono, monospace)" } satisfies CSSProperties,

  diffTextarea: {
    width: "100%",
    height: 300,
    resize: "vertical",
    overflow: "auto",
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
    fontSize: 12.5,
    lineHeight: 1.5,
    outline: "none",
  } satisfies CSSProperties,

  jsonEditorHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  } satisfies CSSProperties,

  jsonReadOnly: {
    width: "100%",
    height: 240,
    resize: "vertical",
    overflow: "auto",
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    color: "var(--text-muted)",
    fontSize: 12.5,
    lineHeight: 1.5,
    outline: "none",
  } satisfies CSSProperties,

  errorText: { fontSize: 12, color: "var(--crit)", marginTop: 8 } satisfies CSSProperties,

  forbiddenLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginTop: 16,
    marginBottom: 8,
  } satisfies CSSProperties,
  forbiddenRow: {
    fontSize: 12,
    color: "var(--text-secondary)",
    padding: "4px 0",
  } satisfies CSSProperties,
} as const;
