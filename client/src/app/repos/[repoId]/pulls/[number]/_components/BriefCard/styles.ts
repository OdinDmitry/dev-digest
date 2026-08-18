import type { CSSProperties } from "react";

/** Co-located styles for BriefCard. Mirrors VerdictBanner's icon+main+score
 *  layout (../VerdictBanner/styles.ts) — deliberately similar since both
 *  present a verdict/score, but this card is not that component: it also
 *  carries the what/why prose and has no agent-name badge. */
export const s = {
  box: {
    display: "flex",
    gap: 18,
    alignItems: "flex-start",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
  } satisfies CSSProperties,
  iconBox: (bg: string, color: string): CSSProperties => ({
    width: 40,
    height: 40,
    borderRadius: 9,
    display: "grid",
    placeItems: "center",
    background: bg,
    color,
    flexShrink: 0,
  }),
  main: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    marginBottom: 8,
  } satisfies CSSProperties,
  verdictLabel: (color: string): CSSProperties => ({ fontSize: 15, fontWeight: 700, color }),
  riskLevel: (color: string): CSSProperties => ({
    display: "inline-block",
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    color,
    marginBottom: 4,
  }),
  what: {
    margin: 0,
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
    lineHeight: 1.55,
  } satisfies CSSProperties,
  why: {
    margin: "6px 0 0",
    fontSize: 13.5,
    color: "var(--text-secondary)",
    lineHeight: 1.55,
  } satisfies CSSProperties,
  stateText: {
    fontSize: 13.5,
    color: "var(--text-muted)",
    fontStyle: "italic",
  } satisfies CSSProperties,
  scoreCol: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 5,
    flexShrink: 0,
  } satisfies CSSProperties,
  scoreLabel: {
    fontSize: 12,
    color: "var(--text-muted)",
    letterSpacing: "0.04em",
  } satisfies CSSProperties,
  noScoreRing: {
    width: 52,
    height: 52,
    borderRadius: "50%",
    border: "1px dashed var(--border-strong)",
    display: "grid",
    placeItems: "center",
    color: "var(--text-muted)",
    fontSize: 12,
    flexShrink: 0,
  } satisfies CSSProperties,
} as const;
