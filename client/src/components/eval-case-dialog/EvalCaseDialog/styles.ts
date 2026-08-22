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

  // Two-line polarity banner (design refs 06/07): accent label on top, secondary
  // body below. `overflowWrap: anywhere` is required — long paths have no spaces
  // and otherwise pierce the border (FindingCard-seeded cases especially).
  banner: (kind: "positive" | "negative"): CSSProperties => ({
    padding: "10px 14px",
    borderRadius: 8,
    marginBottom: 16,
    border: "1px solid " + (kind === "positive" ? "var(--accent)" : "var(--warn)"),
    background: kind === "positive" ? "var(--accent-bg)" : "var(--warn-bg)",
    minWidth: 0,
    overflow: "hidden",
  }),
  bannerLabel: (kind: "positive" | "negative"): CSSProperties => ({
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.04em",
    color: kind === "positive" ? "var(--accent)" : "var(--warn)",
    marginBottom: 4,
  }),
  bannerBody: {
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,

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
    height: 180,
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

  actualOutput: {
    width: "100%",
    height: 160,
    resize: "vertical",
    overflow: "auto",
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    color: "var(--text-secondary)",
    fontSize: 12.5,
    lineHeight: 1.5,
    outline: "none",
  } satisfies CSSProperties,

  actualPlaceholder: {
    width: "100%",
    height: 160,
    resize: "none",
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

  previewNote: { fontSize: 11, color: "var(--accent-text)" } satisfies CSSProperties,

  errorText: { fontSize: 12, color: "var(--crit)", marginTop: 8 } satisfies CSSProperties,

  forbiddenLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginTop: 16,
    marginBottom: 4,
  } satisfies CSSProperties,
  forbiddenHint: {
    fontSize: 11.5,
    color: "var(--text-tertiary)",
    marginBottom: 8,
    lineHeight: 1.4,
  } satisfies CSSProperties,
  forbiddenRow: {
    fontSize: 12,
    color: "var(--text-secondary)",
    padding: "4px 0",
    overflowWrap: "anywhere",
    minWidth: 0,
  } satisfies CSSProperties,
} as const;
