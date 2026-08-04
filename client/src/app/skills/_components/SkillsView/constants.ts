import type { SkillType } from "@devdigest/shared";

/** Selectable skill types, in the order the editor offers them. */
export const SKILL_TYPE_VALUES: readonly SkillType[] = [
  "rubric",
  "convention",
  "security",
  "custom",
];

/** Card grid: as many ~260px columns as fit, so the preview pane can take the rest. */
export const CARD_GRID_COLS = "repeat(auto-fill, minmax(240px, 1fr))";

/** Width of the preview pane when a skill is selected. */
export const PREVIEW_WIDTH = 460;
