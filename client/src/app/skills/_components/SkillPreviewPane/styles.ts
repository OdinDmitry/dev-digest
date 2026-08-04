import type { CSSProperties } from "react";

/** Co-located styles for SkillPreviewPane. */
export const s = {
  pane: {
    borderLeft: "1px solid var(--border)",
    background: "var(--bg-surface)",
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "16px 20px",
    borderBottom: "1px solid var(--border)",
    flexWrap: "wrap",
  } satisfies CSSProperties,
  title: {
    fontSize: 15,
    fontWeight: 700,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  body: { flex: 1, overflow: "auto", padding: 20, minWidth: 0 } satisfies CSSProperties,
  descriptionBlock: {
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    marginBottom: 16,
  } satisfies CSSProperties,
  descriptionLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 6,
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
    marginBottom: 16,
  } satisfies CSSProperties,
  // Markdown renders on the surface background; a body under edit swaps to the
  // textarea in place, so both keep the same footprint.
  markdown: { fontSize: 13.5, lineHeight: 1.6, minWidth: 0, overflowX: "auto" } satisfies CSSProperties,
  actions: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "14px 20px",
    borderTop: "1px solid var(--border)",
    background: "var(--bg-primary)",
  } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
  meta: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  evidence: { fontSize: 12, color: "var(--text-muted)", marginTop: 16, lineHeight: 1.6 } satisfies CSSProperties,
} as const;
