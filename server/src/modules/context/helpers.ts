import type { AssembledContextEntry, ContextOwnerKind } from '@devdigest/shared';
import type { AgentSkillGroup, OwnerContextEntry } from './repository.js';

/**
 * modules/context/helpers.ts — pure transforms, no I/O, no DB.
 */

/** Containing folder of a repository-relative POSIX path; '' at repo root.
 *  `path` is already POSIX-normalized by scan.ts, so a plain `lastIndexOf`
 *  is safe here (unlike an OS-joined path — see server/insights.md 2026-08-07). */
export function folderOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

export interface OwnerAgentPair {
  path: string;
  agentId: string;
}

/**
 * Distinct agent ids per path, across every input set. This is what makes
 * "reaches a document directly, through a skill, or both" count once: the
 * same (path, agentId) pair appearing in more than one set collapses to one
 * membership in the underlying Set.
 */
export function usageCounts(pairs: OwnerAgentPair[][]): Map<string, number> {
  const byPath = new Map<string, Set<string>>();
  for (const set of pairs) {
    for (const { path, agentId } of set) {
      let agents = byPath.get(path);
      if (!agents) {
        agents = new Set();
        byPath.set(path, agents);
      }
      agents.add(agentId);
    }
  }
  const counts = new Map<string, number>();
  for (const [path, agents] of byPath) counts.set(path, agents.size);
  return counts;
}

/**
 * Assemble one agent's project context: every skill group (in skill-link
 * order, each group in its own stored order), then the agent's own entries
 * in their stored order, de-duplicated on `repo_id + path` keeping the FIRST
 * occurrence — so a document reachable both ways lands in the
 * skill-inherited position (AC-12, AC-13).
 */
export function assembleEntries(
  skillGroups: AgentSkillGroup[],
  ownEntries: OwnerContextEntry[],
): AssembledContextEntry[] {
  const seen = new Set<string>();
  const result: AssembledContextEntry[] = [];

  const pushAll = (entries: OwnerContextEntry[], via: ContextOwnerKind) => {
    for (const entry of entries) {
      const key = `${entry.repoId}:${entry.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ repo_id: entry.repoId, path: entry.path, via });
    }
  };

  for (const group of skillGroups) pushAll(group.entries, 'skill');
  pushAll(ownEntries, 'agent');

  return result;
}
