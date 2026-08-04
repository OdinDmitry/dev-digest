import type { SkillType } from "@devdigest/shared";

/** Selectable skill types, in the order the editor offers them. */
export const SKILL_TYPE_VALUES: readonly SkillType[] = [
  "rubric",
  "convention",
  "security",
  "custom",
];

/** Width of the fixed left rail (matches the agent editor's list rail). */
export const RAIL_WIDTH = 280;

/** Detail-pane tabs, validated against `?tab=`. */
export const VALID_TABS = ["config", "preview", "versions"] as const;
export type DetailTabKey = (typeof VALID_TABS)[number];
