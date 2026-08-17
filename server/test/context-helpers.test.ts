/**
 * T22 — modules/context/helpers.ts unit tests. Pure functions, no I/O, no DB.
 */
import { describe, it, expect } from 'vitest';
import { assembleEntries, folderOf, usageCounts } from '../src/modules/context/helpers.js';
import type { AgentSkillGroup, OwnerContextEntry } from '../src/modules/context/repository.js';

describe('modules/context/helpers', () => {
  describe('assembleEntries', () => {
    it('includes a document reachable both ways exactly once', () => {
      // 'shared.md' is attached directly to the agent AND to a skill it uses.
      const skillGroups: AgentSkillGroup[] = [
        { skillId: 's1', entries: [{ repoId: 'r1', path: 'shared.md' }] },
      ];
      const ownEntries: OwnerContextEntry[] = [
        { repoId: 'r1', path: 'shared.md' },
        { repoId: 'r1', path: 'own-only.md' },
      ];

      const result = assembleEntries(skillGroups, ownEntries);

      expect(result.filter((e) => e.path === 'shared.md')).toHaveLength(1);
      // De-duplication keeps the FIRST occurrence — the skill-inherited one.
      expect(result).toContainEqual({ repo_id: 'r1', path: 'shared.md', via: 'skill' });
      expect(result).toContainEqual({ repo_id: 'r1', path: 'own-only.md', via: 'agent' });
    });

    it("places skill-inherited documents before the agent's own, each group in its owner's order", () => {
      const skillGroups: AgentSkillGroup[] = [
        {
          skillId: 's1',
          entries: [
            { repoId: 'r1', path: 'skill1-b.md' },
            { repoId: 'r1', path: 'skill1-a.md' },
          ],
        },
        { skillId: 's2', entries: [{ repoId: 'r1', path: 'skill2-only.md' }] },
      ];
      const ownEntries: OwnerContextEntry[] = [
        { repoId: 'r1', path: 'own-b.md' },
        { repoId: 'r1', path: 'own-a.md' },
      ];

      const result = assembleEntries(skillGroups, ownEntries);

      expect(result.map((e) => e.path)).toEqual([
        'skill1-b.md',
        'skill1-a.md',
        'skill2-only.md',
        'own-b.md',
        'own-a.md',
      ]);
      expect(result.slice(0, 3).every((e) => e.via === 'skill')).toBe(true);
      expect(result.slice(3).every((e) => e.via === 'agent')).toBe(true);
    });

    it('returns an empty list when the agent has no skills and no own attachments', () => {
      expect(assembleEntries([], [])).toEqual([]);
    });
  });

  describe('usageCounts', () => {
    it('counts an agent once per document even when it appears in more than one input set', () => {
      const counts = usageCounts([
        [
          { path: 'a.md', agentId: 'agent-1' },
          { path: 'a.md', agentId: 'agent-2' },
        ],
        // agent-1 reaches a.md a second way (e.g. via a skill) — must not
        // double-count.
        [{ path: 'a.md', agentId: 'agent-1' }],
      ]);

      expect(counts.get('a.md')).toBe(2);
    });

    it('reports zero implicitly for a path present in no input set', () => {
      const counts = usageCounts([[{ path: 'a.md', agentId: 'agent-1' }]]);
      expect(counts.get('unattached.md')).toBeUndefined();
      expect(counts.get('unattached.md') ?? 0).toBe(0);
    });
  });

  describe('folderOf', () => {
    it('returns the containing folder, and the empty string at repo root', () => {
      expect(folderOf('README.md')).toBe('');
      expect(folderOf('docs/api/guide.md')).toBe('docs/api');
      expect(folderOf('docs/guide.md')).toBe('docs');
    });
  });
});
