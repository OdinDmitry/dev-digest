import type { CSSProperties } from "react";
import { RAIL_WIDTH } from "./constants";

/** Co-located styles for SkillsView — a fixed rail + a flexible detail pane,
 *  mirroring `client/src/app/agents/[id]/page.tsx`. */
export const s = {
  layout: { display: "flex", height: "calc(100vh - 52px)", minWidth: 0 } satisfies CSSProperties,
  rail: {
    width: RAIL_WIDTH,
    flexShrink: 0,
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  railHeader: { padding: "16px 16px 12px" } satisfies CSSProperties,
  railTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  } satisfies CSSProperties,
  h1: { fontSize: 18, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  search: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  searchIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  railList: { flex: 1, overflow: "auto", padding: "0 12px 12px" } satisfies CSSProperties,
  railEmpty: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    padding: "8px 4px",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  detail: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 } satisfies CSSProperties,
  detailLoading: {
    flex: 1,
    padding: 28,
    display: "flex",
    flexDirection: "column",
    gap: 16,
  } satisfies CSSProperties,
} as const;
