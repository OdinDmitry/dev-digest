import type { SkillType } from "@devdigest/shared";

/**
 * Colour per skill type, shared by the Skills library grid and the agent
 * editor's Skills tab. Lives in `lib/` rather than either route's `_components/`
 * because both routes need it and neither owns the other.
 *
 * Rendered as a chip with a 10%-alpha background (`color + "1a"`), matching the
 * model chip on AgentCard.
 */
export const SKILL_TYPE_COLOR: Record<SkillType, string> = {
  rubric: "#3b82f6",
  convention: "#10b981",
  security: "#ef4444",
  custom: "#999999",
};

const FALLBACK = "#999999";

/** Colour for a skill type, tolerating a value from an older/newer contract. */
export function skillTypeColor(type: string): string {
  return SKILL_TYPE_COLOR[type as SkillType] ?? FALLBACK;
}

/** Chip style used for a type badge — same treatment in both places. */
export function skillTypeChip(type: string) {
  const color = skillTypeColor(type);
  return {
    fontSize: 12,
    fontWeight: 600,
    color,
    background: color + "1a",
    padding: "1px 8px",
    borderRadius: 4,
  } as const;
}
