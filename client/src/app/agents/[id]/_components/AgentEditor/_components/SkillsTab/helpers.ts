import type { AgentSkillLink, Skill } from "@devdigest/shared";

export interface SkillRow {
  skill: Skill;
  /** Attached to this agent (i.e. its body reaches the prompt). */
  linked: boolean;
}

/**
 * Rows for the tab: linked skills first in `agent_skills.order` — the order
 * their blocks appear in the assembled prompt — then everything else
 * alphabetically. Pure, so ordering is testable without rendering.
 *
 * A link pointing at a skill that no longer exists is dropped rather than
 * rendered as a blank row.
 */
export function orderRows(skills: Skill[], links: AgentSkillLink[]): SkillRow[] {
  const byId = new Map(skills.map((s) => [s.id, s]));
  const ordered = [...links].sort((a, b) => a.order - b.order);

  const linked: SkillRow[] = [];
  const seen = new Set<string>();
  for (const link of ordered) {
    const skill = byId.get(link.skill_id);
    if (!skill || seen.has(skill.id)) continue;
    seen.add(skill.id);
    linked.push({ skill, linked: true });
  }

  const rest = skills
    .filter((s) => !seen.has(s.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((skill) => ({ skill, linked: false }));

  return [...linked, ...rest];
}

/** Free-text filter over name, description and type (not the body). */
export function filterRows(rows: SkillRow[], query: string): SkillRow[] {
  const q = query.trim().toLowerCase();
  if (q === "") return rows;
  return rows.filter(
    ({ skill }) =>
      skill.name.toLowerCase().includes(q) ||
      skill.description.toLowerCase().includes(q) ||
      skill.type.toLowerCase().includes(q),
  );
}

/**
 * Toggle one skill's membership, preserving the order of the rest. A newly
 * attached skill goes last, so attaching never silently reshuffles the prompt.
 */
export function toggleLink(linkedIds: string[], skillId: string): string[] {
  return linkedIds.includes(skillId)
    ? linkedIds.filter((id) => id !== skillId)
    : [...linkedIds, skillId];
}
