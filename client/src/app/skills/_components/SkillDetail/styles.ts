import type { CSSProperties } from "react";

/** Co-located styles for SkillDetail — the header + tab shell on the right. */
export const s = {
  root: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
  } satisfies CSSProperties,
  emptyWrap: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "16px 28px 0",
    flexShrink: 0,
  } satisfies CSSProperties,
  title: {
    fontSize: 18,
    fontWeight: 700,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  tabsBar: { marginTop: 14 } satisfies CSSProperties,
  body: { flex: 1, minHeight: 0, overflow: "auto", padding: 28 } satisfies CSSProperties,
} as const;
