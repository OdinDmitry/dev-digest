import { describe, it, expect } from 'vitest';
import { lineDelta, mergeSkillStats } from '../src/modules/skills/helpers.js';
import { MAX_DELTA_CELLS } from '../src/modules/skills/constants.js';

describe('lineDelta', () => {
  it('is zero for identical text', () => {
    expect(lineDelta('a\nb\nc', 'a\nb\nc')).toEqual({ added: 0, removed: 0, truncated: false });
  });

  it('counts a pure append', () => {
    expect(lineDelta('a\nb', 'a\nb\nc\nd')).toEqual({ added: 2, removed: 0, truncated: false });
  });

  it('counts a pure delete', () => {
    expect(lineDelta('a\nb\nc\nd', 'a\nb')).toEqual({ added: 0, removed: 2, truncated: false });
  });

  it('counts a single replaced line in the middle as one add + one remove', () => {
    expect(lineDelta('a\nb\nc', 'a\nX\nc')).toEqual({ added: 1, removed: 1, truncated: false });
  });

  it('treats an empty predecessor as everything added (the v1 case)', () => {
    const body = 'a\nb\nc';
    expect(lineDelta('', body)).toEqual({ added: 3, removed: 0, truncated: false });
  });

  it('treats an empty next as everything removed', () => {
    expect(lineDelta('a\nb\nc', '')).toEqual({ added: 0, removed: 3, truncated: false });
  });

  it('falls back to whole-line-replaced counts above the cell cap, without throwing', () => {
    // n * m must exceed MAX_DELTA_CELLS after common-prefix/suffix stripping.
    const side = Math.ceil(Math.sqrt(MAX_DELTA_CELLS)) + 100;
    const a = Array.from({ length: side }, (_, i) => `a-line-${i}`).join('\n');
    const b = Array.from({ length: side }, (_, i) => `b-line-${i}`).join('\n');
    const delta = lineDelta(a, b);
    expect(delta.truncated).toBe(true);
    expect(delta.added).toBe(side);
    expect(delta.removed).toBe(side);
  });
});

describe('mergeSkillStats', () => {
  it('defaults a skill with no linked agent to 0, not dropped', () => {
    const merged = mergeSkillStats(
      [{ id: 's1' }, { id: 's2' }],
      [{ skillId: 's1', agentCount: 3 }],
    );
    expect(merged).toEqual([
      { skill_id: 's1', agent_count: 3 },
      { skill_id: 's2', agent_count: 0 },
    ]);
  });

  it('returns an empty array for a workspace with no skills', () => {
    expect(mergeSkillStats([], [])).toEqual([]);
  });
});
