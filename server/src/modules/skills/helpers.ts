import type { Skill, SkillSource, SkillType } from '@devdigest/shared';
import type { SkillRow } from '../../db/rows.js';
import { NAME_MAX_LEN, TYPE_PATTERNS } from './constants.js';

/**
 * Pure helpers for the skills module — DB row ⇄ DTO mapping, the version-bump
 * rule, and the text heuristics the importer uses when an upload declares
 * nothing about itself. No I/O.
 */

/** Map a persisted skill row to the public `Skill` DTO. */
export function toSkillDto(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as SkillType,
    source: row.source as SkillSource,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
  };
}

/**
 * True when a patch changes the skill's body relative to the existing row.
 *
 * Deliberately narrower than the agents module's `isConfigChange`: `agent_versions`
 * snapshots a whole config object, so any config field can meaningfully version it,
 * whereas `skill_versions` stores only `body` — versioning a rename would produce
 * two indistinguishable snapshots.
 */
export function isBodyChange(
  existing: Pick<SkillRow, 'body'>,
  patch: { body?: string },
): boolean {
  return patch.body !== undefined && patch.body !== existing.body;
}

/** First non-empty line of a text block, trimmed; '' when there is none. */
export function firstLine(text: string): string {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return '';
}

/** Guess a skill type from its name + body when the upload declares none. */
export function inferType(name: string, body: string): SkillType {
  const haystack = `${name}\n${body.slice(0, 2000)}`;
  for (const [pattern, type] of TYPE_PATTERNS) {
    if (pattern.test(haystack)) return type;
  }
  return 'custom';
}

/** Trim + collapse whitespace and cap a derived name at NAME_MAX_LEN. */
export function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX_LEN);
}
