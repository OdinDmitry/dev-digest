import { describe, it, expect, vi } from 'vitest';
import type {
  AssembledRunContext,
  EvalExpectation,
  LLMProvider,
  UnifiedDiff,
} from '@devdigest/shared';
import type { FindingRow } from '../src/db/rows.js';
import {
  polarityOf,
  resolveExpectations,
  seedExpectationFrom,
  buildEvalReviewInput,
  contextInputFor,
} from '../src/modules/evals/helpers.js';

/**
 * Hermetic unit tests over `modules/evals/helpers.ts`
 * (`docs/plans/2026-08-22-eval-pipeline-a-foundation.md` T17, T21). Covers
 * AC-8, AC-9, AC-11, AC-49.
 */

function mkExpectation(overrides: Partial<EvalExpectation> = {}): EvalExpectation {
  return {
    kind: 'must_find',
    file: 'src/x.ts',
    start_line: 10,
    end_line: 10,
    title: null,
    severity: null,
    category: null,
    ...overrides,
  };
}

let findingSeq = 0;
function mkFindingRow(overrides: Partial<FindingRow> = {}): FindingRow {
  findingSeq += 1;
  return {
    id: `finding-${findingSeq}`,
    reviewId: 'review-1',
    file: 'src/x.ts',
    startLine: 10,
    endLine: 10,
    severity: 'CRITICAL',
    category: 'security',
    title: 'A finding',
    rationale: 'r',
    suggestion: null,
    confidence: 0.9,
    kind: 'finding',
    trifectaComponents: null,
    acceptedAt: null,
    dismissedAt: null,
    ...overrides,
  } as FindingRow;
}

describe('resolveExpectations — the decision table (AC-8, AC-9)', () => {
  it('row 1: incoming undefined, stored non-null → keeps stored', () => {
    const stored = [mkExpectation({ kind: 'must_find' })];
    expect(resolveExpectations(stored, undefined)).toBe(stored);
  });

  it('row 2 (AC-8): incoming [], stored must_not_flag → keeps stored', () => {
    const stored = [mkExpectation({ kind: 'must_not_flag' })];
    expect(resolveExpectations(stored, [])).toBe(stored);
  });

  it('row 3a (AC-9 rejection): incoming [], stored must_find → rejected', () => {
    const stored = [mkExpectation({ kind: 'must_find' })];
    expect(() => resolveExpectations(stored, [])).toThrow(/expectation/i);
  });

  it('row 3b (AC-9 rejection): incoming [], stored null (new case) → rejected', () => {
    expect(() => resolveExpectations(null, [])).toThrow(/expectation/i);
  });

  it('row 3c (AC-9 rejection): incoming undefined, stored null (new case, nothing at all) → rejected', () => {
    expect(() => resolveExpectations(null, undefined)).toThrow(/expectation/i);
  });

  it('row 4 (AC-9 rejection): non-empty incoming with mixed kinds → rejected', () => {
    const incoming = [
      mkExpectation({ kind: 'must_find' }),
      mkExpectation({ kind: 'must_not_flag' }),
    ];
    expect(() => resolveExpectations(null, incoming)).toThrow(/same kind/i);
    expect(() => resolveExpectations([mkExpectation()], incoming)).toThrow(/same kind/i);
  });

  it('row 5: non-empty incoming, single kind → replaces (regardless of stored)', () => {
    const incoming = [mkExpectation({ kind: 'must_not_flag', file: 'src/new.ts' })];
    expect(resolveExpectations(null, incoming)).toBe(incoming);
    expect(resolveExpectations([mkExpectation({ kind: 'must_find' })], incoming)).toBe(incoming);
  });
});

describe('polarityOf', () => {
  it('returns the kind shared by a non-empty expectations array', () => {
    expect(polarityOf([mkExpectation({ kind: 'must_not_flag' })])).toBe('must_not_flag');
    expect(polarityOf([mkExpectation({ kind: 'must_find' })])).toBe('must_find');
  });
});

describe('seedExpectationFrom (AC-3)', () => {
  it('an accepted finding seeds a must_find expectation at the finding location', () => {
    const finding = mkFindingRow({
      file: 'src/config.ts',
      startLine: 12,
      endLine: 12,
      acceptedAt: new Date(),
      dismissedAt: null,
    });
    const expectation = seedExpectationFrom(finding);
    expect(expectation.kind).toBe('must_find');
    expect(expectation.file).toBe('src/config.ts');
    expect(expectation.start_line).toBe(12);
    expect(expectation.end_line).toBe(12);
  });

  it('a dismissed finding seeds a must_not_flag expectation at the finding location', () => {
    const finding = mkFindingRow({
      file: 'src/config.ts',
      startLine: 12,
      endLine: 12,
      acceptedAt: null,
      dismissedAt: new Date(),
    });
    const expectation = seedExpectationFrom(finding);
    expect(expectation.kind).toBe('must_not_flag');
  });
});

describe('buildEvalReviewInput (AC-11)', () => {
  const diff: UnifiedDiff = { raw: '', files: [] };
  const llm = {} as unknown as LLMProvider;

  it('sets no callers/repoMap/prDescription/intent/task/memory, and omits skills/specs when empty', () => {
    const input = buildEvalReviewInput({
      systemPrompt: 'You review PRs.',
      model: 'gpt-4.1',
      strategy: 'single-pass',
      diff,
      llm,
      skills: [],
      specs: [],
    });

    const keys = Object.keys(input);
    for (const forbidden of ['callers', 'repoMap', 'prDescription', 'intent', 'task', 'memory']) {
      expect(keys).not.toContain(forbidden);
    }
    // Absent, not present-as-empty-array.
    expect(keys).not.toContain('skills');
    expect(keys).not.toContain('specs');
    expect(input).toMatchObject({
      systemPrompt: 'You review PRs.',
      model: 'gpt-4.1',
      strategy: 'single-pass',
      diff,
      llm,
    });
  });

  it('includes skills/specs (non-empty) and sessionId when provided', () => {
    const input = buildEvalReviewInput({
      systemPrompt: 'You review PRs.',
      model: 'gpt-4.1',
      strategy: 'single-pass',
      diff,
      llm,
      skills: ['sec-basics'],
      specs: [{ path: 'specs/a.md', text: 'x' }],
      sessionId: 'sess-1',
    });
    expect(input).toMatchObject({
      skills: ['sec-basics'],
      specs: [{ path: 'specs/a.md', text: 'x' }],
      sessionId: 'sess-1',
    });
  });
});

describe('contextInputFor (AC-49, T21)', () => {
  it('a null repo id resolves { documents: [], excluded: [] } WITHOUT calling the resolver', async () => {
    const resolve = vi.fn<(repoId: string) => Promise<AssembledRunContext>>();

    const result = await contextInputFor(null, resolve);

    expect(result).toEqual({ documents: [], excluded: [] });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('a non-null repo id delegates to the resolver with that id', async () => {
    const assembled: AssembledRunContext = {
      documents: [{ path: 'README.md', text: 'hi' }],
      excluded: [],
    };
    const resolve = vi.fn().mockResolvedValue(assembled);

    const result = await contextInputFor('repo-123', resolve);

    expect(resolve).toHaveBeenCalledWith('repo-123');
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(result).toBe(assembled);
  });
});
