import type { SkillSource } from "@devdigest/shared";

/**
 * Whether a skill's body arrived from outside this workspace and hasn't been
 * read by a human here yet — the "vet before enabling" warning applies.
 *
 * `imported_url` is a raw upload (file/zip/URL), never reviewed. `community`
 * is the curated catalog, also foreign. `extracted` is NOT foreign — it's
 * mined from THIS repo's own code and the user already reviewed every
 * contributing candidate one by one (accept/reject) in the Conventions flow
 * before the skill was created, same trust level as typing it by hand.
 * `manual` is typed in the studio. Tolerates a value from an older/newer
 * contract by defaulting to "not unvetted" rather than throwing.
 */
export function isUnvettedSkillSource(source: string): boolean {
  return source === ("imported_url" satisfies SkillSource) || source === ("community" satisfies SkillSource);
}
