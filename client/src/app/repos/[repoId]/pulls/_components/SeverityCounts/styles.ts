import type { CSSProperties } from "react";

/** Co-located styles for SeverityCounts. */
export const s = {
  root: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
  } satisfies CSSProperties,
  badges: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,
  empty: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  badgeBtn: (clickable: boolean, dimmed: boolean): CSSProperties => ({
    background: "none",
    border: "none",
    padding: 0,
    cursor: clickable ? "pointer" : "default",
    opacity: dimmed ? 0.4 : 1,
    transition: "opacity .1s",
  }),
  // Base popup look — position/top/left are set inline by the component
  // (portaled to <body>, positioned from the trigger's getBoundingClientRect()
  // so it escapes any ancestor `overflow: hidden`, e.g. the PR-list table card).
  popup: {
    zIndex: 30,
    minWidth: 280,
    maxWidth: 360,
    maxHeight: 320,
    overflowY: "auto",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
  } satisfies CSSProperties,
  popupHeader: {
    padding: "10px 12px",
    borderBottom: "1px solid var(--border)",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.04em",
    color: "var(--text-muted)",
    textTransform: "uppercase",
  } satisfies CSSProperties,
  popupMuted: {
    padding: 12,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  popupList: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 10,
  } satisfies CSSProperties,
  popupItem: (isLast: boolean): CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    gap: 3,
    paddingBottom: isLast ? 0 : 8,
    borderBottom: isLast ? "none" : "1px solid var(--border)",
  }),
  popupItemHead: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,
  popupTitle: {
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  popupMeta: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 11,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  popupRationale: {
    fontSize: 11.5,
    color: "var(--text-secondary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
  } satisfies CSSProperties,
} as const;
