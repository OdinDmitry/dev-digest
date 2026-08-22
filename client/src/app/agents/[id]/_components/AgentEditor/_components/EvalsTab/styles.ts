import type { CSSProperties } from "react";

/** Co-located styles for EvalsTab. */
export const s = {
  wrap: { maxWidth: 980 } satisfies CSSProperties,

  metricsHeader: {
    marginBottom: 28,
    padding: 20,
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  metricsTitleRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 16,
  } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700 } satisfies CSSProperties,
  subtitle: { fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,
  viewDashboardLink: {
    fontSize: 12.5,
    color: "var(--accent-text)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  progressRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 12.5,
    color: "var(--text-secondary)",
    marginBottom: 14,
  } satisfies CSSProperties,
  spinner: { color: "var(--accent)" } satisfies CSSProperties,
  stepDots: { display: "flex", gap: 3 } satisfies CSSProperties,
  stepDot: (filled: boolean): CSSProperties => ({
    width: 6,
    height: 6,
    borderRadius: 2,
    background: filled ? "var(--accent)" : "var(--border-strong)",
  }),

  metricCards: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 16,
  } satisfies CSSProperties,
  metricCard: {
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  tracesLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-muted)",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    marginBottom: 8,
  } satisfies CSSProperties,
  tracesValue: { fontSize: 20, fontWeight: 700 } satisfies CSSProperties,

  header: { display: "flex", alignItems: "center", gap: 12, marginBottom: 14 } satisfies CSSProperties,
  hint: { fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 } satisfies CSSProperties,

  list: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  row: { display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-elevated)" } satisfies CSSProperties,
  statusIcon: (color: string): CSSProperties => ({ color, flexShrink: 0 }),
  rowMain: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  nameRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  name: { fontSize: 13.5, fontWeight: 600 } satisfies CSSProperties,
  statusText: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  subtextRow: { fontSize: 12, color: "var(--text-secondary)", marginTop: 2 } satisfies CSSProperties,
  previewNote: { fontSize: 11, color: "var(--accent-text)", marginLeft: 6 } satisfies CSSProperties,

  // Same accent/warn tokens as EvalCaseDialog's polarity banner.
  polarityChip: (kind: "positive" | "negative"): CSSProperties => ({
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.04em",
    padding: "2px 7px",
    borderRadius: 5,
    whiteSpace: "nowrap",
    border: "1px solid " + (kind === "positive" ? "var(--accent)" : "var(--warn)"),
    background: kind === "positive" ? "var(--accent-bg)" : "var(--warn-bg)",
    color: kind === "positive" ? "var(--accent)" : "var(--warn)",
  }),

  // Design 05: severity·category chip sits mid-right of the row (between
  // name/subtext and the action icons), vertically centered — not beside the title.
  chip: {
    fontSize: 10.5,
    fontWeight: 600,
    color: "var(--text-secondary)",
    border: "1px solid var(--border-strong)",
    borderRadius: 5,
    padding: "2px 7px",
    whiteSpace: "nowrap",
    flexShrink: 0,
  } satisfies CSSProperties,

  actions: { display: "flex", alignItems: "center", gap: 4, flexShrink: 0 } satisfies CSSProperties,
  iconButton: (disabled: boolean): CSSProperties => ({
    width: 28,
    height: 28,
    display: "inline-grid",
    placeItems: "center",
    borderRadius: 6,
    border: "1px solid transparent",
    background: "transparent",
    color: disabled ? "var(--border-strong)" : "var(--text-secondary)",
    cursor: disabled ? "not-allowed" : "pointer",
  }),

  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    border: 0,
  } satisfies CSSProperties,
} as const;
