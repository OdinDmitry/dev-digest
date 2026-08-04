import { describe, it, expect } from 'vitest';
import { assemblePrompt } from '../src/platform/prompt.js';
import { isBodyChange, inferType, toSkillDto } from '../src/modules/skills/helpers.js';
import { mergeAgentStats } from '../src/modules/agents/helpers.js';
import type { SkillRow } from '../src/db/rows.js';

/**
 * The two rules that decide what reaches the prompt — link order and the
 * library's enabled flag — plus the section they land in. The executor resolves
 * `linkedSkills` (already ordered by `agent_skills.order`) and filters disabled
 * ones; this pins that contract against `assemblePrompt` without a database.
 */

const row = (over: Partial<SkillRow> = {}): SkillRow =>
  ({
    id: 'sk',
    workspaceId: 'ws',
    name: 'skill',
    description: 'Use when …',
    type: 'rubric',
    source: 'manual',
    body: '## skill',
    enabled: true,
    version: 1,
    evidenceFiles: null,
    createdAt: new Date(),
    ...over,
  }) as SkillRow;

/** Mirrors ReviewRunExecutor.buildSkillBodies without its I/O. */
function resolveBodies(links: { skill: SkillRow; order: number }[]): string[] {
  return [...links]
    .sort((a, b) => a.order - b.order)
    .filter((l) => l.skill.enabled)
    .map((l) => l.skill.body);
}

describe('skill resolution → prompt', () => {
  const coverage = row({ id: 's1', name: 'test-coverage-rubric', body: '## coverage\nEnumerate branches.' });
  const edges = row({ id: 's2', name: 'edge-case-checklist', body: '## edges\nEmpty collections.' });
  const mocks = row({ id: 's3', name: 'mock-discipline', body: '## mocks\nDo not mock pure code.' });

  it('injects bodies in link order, not in the order rows arrive', () => {
    const bodies = resolveBodies([
      { skill: mocks, order: 2 },
      { skill: coverage, order: 0 },
      { skill: edges, order: 1 },
    ]);
    expect(bodies).toEqual([coverage.body, edges.body, mocks.body]);

    const { messages } = assemblePrompt({ system: 'You review tests.', skills: bodies, diff: '@@' });
    const user = messages[1]!.content;
    expect(user).toContain('## Skills / rules');
    // Reordering the tab must reorder the blocks.
    expect(user.indexOf('## coverage')).toBeLessThan(user.indexOf('## edges'));
    expect(user.indexOf('## edges')).toBeLessThan(user.indexOf('## mocks'));
  });

  it('skips a skill disabled in the library, keeping the rest in order', () => {
    const bodies = resolveBodies([
      { skill: coverage, order: 0 },
      { skill: { ...edges, enabled: false }, order: 1 },
      { skill: mocks, order: 2 },
    ]);
    expect(bodies).toEqual([coverage.body, mocks.body]);

    const { assembly } = assemblePrompt({ system: 'x', skills: bodies, diff: '@@' });
    expect(assembly.skills).toContain('## coverage');
    expect(assembly.skills).toContain('## mocks');
    // The disabled one is absent from the trace, not merely ignored by the model.
    expect(assembly.skills).not.toContain('## edges');
  });

  it('omits the section entirely when every linked skill is disabled', () => {
    const bodies = resolveBodies([{ skill: { ...coverage, enabled: false }, order: 0 }]);
    expect(bodies).toEqual([]);

    // The executor omits `skills` when the list is empty, so the prompt is
    // byte-identical to an agent that has no skills at all.
    const withNone = assemblePrompt({ system: 'x', diff: '@@' });
    expect(withNone.assembly.skills).toBeNull();
    expect(withNone.messages[1]!.content).not.toContain('## Skills / rules');
  });

  it('keeps skill bodies as instructions — they are not delimiter-wrapped', () => {
    // Deliberate: INJECTION_GUARD tells the model to ignore instructions inside
    // <untrusted> blocks, so wrapping a rubric would neutralise it. Imported
    // skills are gated in the product (preview + created disabled) instead.
    const { assembly } = assemblePrompt({ system: 'x', skills: [coverage.body], diff: '@@' });
    expect(assembly.skills).toBe(coverage.body);
    expect(assembly.skills).not.toContain('<untrusted');
  });
});

describe('skill versioning rule', () => {
  it('bumps only on a body change', () => {
    expect(isBodyChange({ body: 'a' }, { body: 'b' })).toBe(true);
    expect(isBodyChange({ body: 'a' }, { body: 'a' })).toBe(false);
    expect(isBodyChange({ body: 'a' }, {})).toBe(false);
  });
});

describe('skill helpers', () => {
  it('maps a row to the snake_case DTO with a null evidence list', () => {
    expect(toSkillDto(row({ evidenceFiles: null }))).toMatchObject({
      id: 'sk',
      type: 'rubric',
      source: 'manual',
      evidence_files: null,
    });
    expect(toSkillDto(row({ evidenceFiles: ['README.md'] })).evidence_files).toEqual(['README.md']);
  });

  it('infers a type from the wording, falling back to custom', () => {
    expect(inferType('secret-gate', 'Flag hardcoded credentials')).toBe('security');
    expect(inferType('naming', 'Prefer named exports')).toBe('convention');
    expect(inferType('quality', 'Score against this rubric')).toBe('rubric');
    expect(inferType('misc', 'Nothing in particular')).toBe('custom');
  });
});

describe('mergeAgentStats', () => {
  it('defaults agents missing from either rollup to zero / null', () => {
    const merged = mergeAgentStats(
      [{ id: 'a' }, { id: 'b' }],
      [{ agentId: 'a', runCount: 3, avgCostUsd: 0.04 }],
      [{ agentId: 'b', skillCount: 2 }],
    );
    expect(merged).toEqual([
      { agent_id: 'a', skill_count: 0, run_count: 3, avg_cost_usd: 0.04 },
      { agent_id: 'b', skill_count: 2, run_count: 0, avg_cost_usd: null },
    ]);
  });

  it('keeps avg_cost_usd null when runs exist but none recorded a cost', () => {
    const [only] = mergeAgentStats([{ id: 'a' }], [{ agentId: 'a', runCount: 2, avgCostUsd: null }], []);
    expect(only).toEqual({ agent_id: 'a', skill_count: 0, run_count: 2, avg_cost_usd: null });
  });
});
