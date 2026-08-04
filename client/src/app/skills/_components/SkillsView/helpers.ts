import type { Skill } from "@devdigest/shared";

/**
 * Filter the library by free text over the fields a user would search on: the
 * name, the description (the skill's interface) and its type. The body is
 * deliberately excluded — matching on body text makes almost every query match
 * almost every skill.
 */
export function filterSkills(skills: Skill[], query: string): Skill[] {
  const q = query.trim().toLowerCase();
  if (q === "") return skills;
  return skills.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.type.toLowerCase().includes(q),
  );
}
