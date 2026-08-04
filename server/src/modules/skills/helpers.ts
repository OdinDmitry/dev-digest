import type {
  Skill,
  SkillListStats,
  SkillSource,
  SkillType,
  SkillVersion,
  SkillVersionDetail,
} from '@devdigest/shared';
import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
import { MAX_DELTA_CELLS, NAME_MAX_LEN, TYPE_PATTERNS } from './constants.js';

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

// ---------------------------------------------------------------------------
// Version history — line deltas, DTO mapping, per-skill agent counts
// ---------------------------------------------------------------------------

export interface LineDelta {
  added: number;
  removed: number;
  /** True when the pair was too large to diff exactly; counts are the cheap
   *  whole-line-replaced fallback, not a real comparison. */
  truncated: boolean;
}

/**
 * Lines added/removed between two texts, computed via the LCS length only
 * (no backtracking — the server never renders a diff, only a summary count).
 *
 * This is DELIBERATELY duplicated with the client's `diffLines` in
 * `client/src/lib/diff-lines.ts`, and that duplication is safe: the LCS
 * LENGTH is unique even when the LCS PATH is not, so the two implementations
 * can never disagree on `added`/`removed` no matter how each ties-break.
 *
 * Memory is O(min(n, m)) — the rolling two-row DP never needs the full
 * matrix, unlike a backtracking diff. The cap below is a TIME bound, not a
 * memory one: at MAX_DELTA_CELLS (4M) the DP is still only a few MB, but a
 * multi-megabyte body pair would make it visibly slow on every list fetch.
 */
export function lineDelta(prev: string, next: string): LineDelta {
  if (prev === next) return { added: 0, removed: 0, truncated: false };

  const a = prev.length === 0 ? [] : prev.split('\n');
  const b = next.length === 0 ? [] : next.split('\n');

  // Strip the common prefix/suffix of identical lines first — a version bump
  // usually touches a handful of lines out of hundreds, so this alone
  // collapses the DP to near-nothing in the common case.
  let start = 0;
  const maxStart = Math.min(a.length, b.length);
  while (start < maxStart && a[start] === b[start]) start++;
  let end = 0;
  while (
    end < maxStart - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  ) {
    end++;
  }
  const aMid = a.slice(start, a.length - end);
  const bMid = b.slice(start, b.length - end);

  if (aMid.length * bMid.length > MAX_DELTA_CELLS) {
    return { added: b.length, removed: a.length, truncated: true };
  }

  // Rolling two-row LCS-length DP.
  let prevRow = new Array<number>(bMid.length + 1).fill(0);
  for (let i = 1; i <= aMid.length; i++) {
    const row = new Array<number>(bMid.length + 1).fill(0);
    for (let j = 1; j <= bMid.length; j++) {
      row[j] =
        aMid[i - 1] === bMid[j - 1]
          ? prevRow[j - 1]! + 1
          : Math.max(prevRow[j]!, row[j - 1]!);
    }
    prevRow = row;
  }
  const lcs = prevRow[bMid.length]!;

  return { added: bMid.length - lcs, removed: aMid.length - lcs, truncated: false };
}

/** Map a version row to the list DTO (no body). `prevBody` is `''` for v1. */
export function toSkillVersionDto(row: SkillVersionRow, prevBody: string): SkillVersion {
  const delta = lineDelta(prevBody, row.body);
  return {
    skill_id: row.skillId,
    version: row.version,
    note: row.note,
    created_at: row.createdAt.toISOString(),
    lines_added: delta.added,
    lines_removed: delta.removed,
  };
}

/** Map a version row to the detail DTO (list shape + body). */
export function toSkillVersionDetailDto(row: SkillVersionRow, prevBody: string): SkillVersionDetail {
  return { ...toSkillVersionDto(row, prevBody), body: row.body };
}

/**
 * Join the per-skill agent-link rollup onto the workspace's skills, defaulting
 * skills with no linked agent to 0. Pure so the "no links yet" case is
 * testable without a database — mirrors `mergeAgentStats` in the agents module.
 */
export function mergeSkillStats(
  skills: Pick<SkillRow, 'id'>[],
  agentCounts: { skillId: string; agentCount: number }[],
): SkillListStats[] {
  const counts = new Map(agentCounts.map((c) => [c.skillId, c.agentCount]));
  return skills.map((s) => ({ skill_id: s.id, agent_count: counts.get(s.id) ?? 0 }));
}
