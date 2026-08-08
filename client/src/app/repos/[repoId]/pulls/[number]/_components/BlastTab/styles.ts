import type { CSSProperties } from "react";

/** Co-located styles for BlastTab. */
export const s = {
  banner: (kind: "info" | "warn"): CSSProperties => ({
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 16,
    padding: "12px 16px",
    borderRadius: 8,
    border: `1px solid ${kind === "warn" ? "var(--warn)" : "var(--accent)"}`,
    background: kind === "warn" ? "var(--warn-bg)" : "var(--accent-bg)",
  }),
  bannerIcon: (kind: "info" | "warn"): CSSProperties => ({
    color: kind === "warn" ? "var(--warn)" : "var(--accent)",
    flexShrink: 0,
    marginTop: 1,
  }),
  bannerTitle: (kind: "info" | "warn"): CSSProperties => ({
    fontWeight: 700,
    fontSize: 14,
    color: kind === "warn" ? "var(--warn)" : "var(--accent-text)",
  }),
  bannerBody: { fontSize: 13, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,
  statStrip: {
    display: "flex",
    gap: 20,
    marginBottom: 20,
  } satisfies CSSProperties,
  statItem: {
    display: "flex",
    alignItems: "baseline",
    gap: 6,
  } satisfies CSSProperties,
  statValue: {
    fontSize: 20,
    fontWeight: 700,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  statLabel: {
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  section: { marginTop: 24 } satisfies CSSProperties,
  symbolCard: {
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    padding: "12px 16px",
    marginBottom: 10,
  } satisfies CSSProperties,
  symbolHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  } satisfies CSSProperties,
  symbolTitle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  fileGroupHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
    marginBottom: 4,
  } satisfies CSSProperties,
  symbolRow: {
    marginTop: 10,
  } satisfies CSSProperties,
  symbolDivider: {
    marginTop: 10,
    marginBottom: 10,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  callerList: {
    marginTop: 10,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  callerRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  lineRefText: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  endpointRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
    padding: "8px 0",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  truncatedNote: {
    marginTop: 8,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
