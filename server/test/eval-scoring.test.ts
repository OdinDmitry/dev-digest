import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { EvalExpectation, Finding } from '@devdigest/shared';
import {
  normalizeZonePath,
  zonesOverlap,
  expectationZone,
  findingZone,
  matchesAny,
  scoreCase,
  aggregate,
  type RunCaseInput,
} from '../src/modules/evals/scoring.js';

/**
 * Hermetic unit tests over `modules/evals/scoring.ts` — content-trigger
 * scorer (AC-12..AC-20). Zone helpers are tested for provenance utilities only.
 */

let findingSeq = 0;
function mkFinding(overrides: Partial<Finding> = {}): Finding {
  findingSeq += 1;
  return {
    id: `f-${findingSeq}`,
    severity: 'CRITICAL',
    category: 'security',
    title: 'A finding',
    file: 'src/x.ts',
    start_line: 10,
    end_line: 10,
    rationale: 'r',
    suggestion: null,
    confidence: 0.9,
    kind: 'finding',
    trifecta_components: null,
    evidence: null,
    ...overrides,
  };
}

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

describe('zonesOverlap (provenance helper, not pass key)', () => {
  it('matches when the ranges share exactly one line', () => {
    expect(
      zonesOverlap({ file: 'src/x.ts', start: 5, end: 10 }, { file: 'src/x.ts', start: 10, end: 15 }),
    ).toBe(true);
  });

  it('does not match adjacent-but-not-overlapping ranges', () => {
    expect(
      zonesOverlap({ file: 'src/x.ts', start: 5, end: 9 }, { file: 'src/x.ts', start: 10, end: 15 }),
    ).toBe(false);
  });

  it('does not match the same range on a different file', () => {
    expect(
      zonesOverlap({ file: 'src/x.ts', start: 5, end: 10 }, { file: 'src/y.ts', start: 5, end: 10 }),
    ).toBe(false);
  });
});

describe('normalizeZonePath', () => {
  it('resolves a/-prefixed, b/-prefixed and backslash-separated forms to the same file', () => {
    expect(normalizeZonePath('a/src/x.ts')).toBe('src/x.ts');
    expect(normalizeZonePath('b/src/x.ts')).toBe('src/x.ts');
    expect(normalizeZonePath('src\\x.ts')).toBe('src/x.ts');
  });

  it('comparison stays case-sensitive: src/X.ts does not equal src/x.ts', () => {
    expect(normalizeZonePath('src/X.ts')).not.toBe(normalizeZonePath('src/x.ts'));
  });
});

describe('expectationZone / findingZone / matchesAny', () => {
  it('project an expectation/finding into a Zone and matchesAny finds an overlapping expectation among several', () => {
    const e1 = mkExpectation({ file: 'src/a.ts', start_line: 1, end_line: 5 });
    const e2 = mkExpectation({ file: 'src/x.ts', start_line: 10, end_line: 10 });
    const f = mkFinding({ file: 'src/x.ts', start_line: 10, end_line: 10 });

    expect(expectationZone(e2)).toEqual({ file: 'src/x.ts', start: 10, end: 10 });
    expect(findingZone(f)).toEqual({ file: 'src/x.ts', start: 10, end: 10 });
    expect(matchesAny(findingZone(f), [e1, e2])).toBe(true);
    expect(matchesAny(findingZone(f), [e1])).toBe(false);
  });
});

describe('scoreCase — positive case (must_find), AC-13/AC-20', () => {
  it('passes when any grounded finding exists, even on different lines than the seed', () => {
    const expectations = [mkExpectation({ kind: 'must_find', file: 'src/x.ts', start_line: 10, end_line: 10 })];
    const grounded = [mkFinding({ file: 'src/x.ts', start_line: 194, end_line: 194 })];

    const score = scoreCase(expectations, grounded, 1);
    expect(score.passed).toBe(true);
    expect(score.expectedCount).toBe(1);
    expect(score.matchedCount).toBe(1);
    expect(score.truePositives).toBe(1);
    expect(score.groundedCount).toBe(1);
  });

  it('passes when a grounded finding cites a different file than the seed expectation', () => {
    const expectations = [mkExpectation({ kind: 'must_find', file: 'src/x.ts', start_line: 10, end_line: 10 })];
    const grounded = [mkFinding({ file: 'src/y.ts', start_line: 1, end_line: 1 })];

    const score = scoreCase(expectations, grounded, 1);
    expect(score.passed).toBe(true);
    expect(score.matchedCount).toBe(1);
    expect(score.truePositives).toBe(1);
  });

  it('fails when no grounded finding was produced', () => {
    const expectations = [mkExpectation({ kind: 'must_find' })];
    const score = scoreCase(expectations, [], 0);
    expect(score.passed).toBe(false);
    expect(score.expectedCount).toBe(1);
    expect(score.matchedCount).toBe(0);
    expect(score.truePositives).toBe(0);
  });
});

describe('scoreCase — negative case (must_not_flag), AC-14/AC-20', () => {
  it('passes when no grounded finding was produced', () => {
    const expectations = [mkExpectation({ kind: 'must_not_flag', file: 'src/x.ts', start_line: 10, end_line: 10 })];
    const score = scoreCase(expectations, [], 0);
    expect(score.passed).toBe(true);
    expect(score.expectedCount).toBe(0);
    expect(score.matchedCount).toBe(0);
    expect(score.truePositives).toBe(0);
  });

  it('fails when any grounded finding exists, even outside the seed zone', () => {
    const expectations = [mkExpectation({ kind: 'must_not_flag', file: 'src/x.ts', start_line: 10, end_line: 10 })];
    const grounded = [mkFinding({ file: 'src/y.ts', start_line: 1, end_line: 1 })];

    const score = scoreCase(expectations, grounded, 1);
    expect(score.passed).toBe(false);
    expect(score.matchedCount).toBe(1);
    expect(score.truePositives).toBe(0);
  });

  it('mixed must_find + must_not_flag is treated as negative: any grounded finding fails', () => {
    const expectations = [
      mkExpectation({ kind: 'must_find', file: 'src/x.ts', start_line: 10, end_line: 10 }),
      mkExpectation({ kind: 'must_not_flag', file: 'src/x.ts', start_line: 10, end_line: 10 }),
    ];
    const grounded = [mkFinding({ file: 'src/x.ts', start_line: 10, end_line: 10 })];

    const score = scoreCase(expectations, grounded, 1);
    expect(score.passed).toBe(false);
    expect(score.truePositives).toBe(0);
    expect(score.expectedCount).toBe(0);
  });
});

describe('scoreCase — multiple grounded findings', () => {
  it('counts every grounded finding as obtained and as true positives on a positive case', () => {
    const expectations = [mkExpectation({ kind: 'must_find' })];
    const grounded = [
      mkFinding({ file: 'src/x.ts', start_line: 10, end_line: 10 }),
      mkFinding({ file: 'src/x.ts', start_line: 20, end_line: 20 }),
    ];

    const score = scoreCase(expectations, grounded, 2);
    expect(score.passed).toBe(true);
    expect(score.expectedCount).toBe(1);
    expect(score.matchedCount).toBe(2);
    expect(score.truePositives).toBe(2);
  });
});

describe('aggregate (AC-15..AC-18)', () => {
  it('recall is 1 when the run has no must_find case', () => {
    const cases: RunCaseInput[] = [
      {
        polarity: 'must_not_flag',
        errored: false,
        score: scoreCase([mkExpectation({ kind: 'must_not_flag' })], [], 0),
      },
    ];
    expect(aggregate(cases).recall).toBe(1);
  });

  it('precision is 1 when zero findings were grounded across the run', () => {
    const cases: RunCaseInput[] = [
      {
        polarity: 'must_find',
        errored: false,
        score: scoreCase([mkExpectation({ kind: 'must_find' })], [], 0),
      },
    ];
    expect(aggregate(cases).precision).toBe(1);
  });

  it('citation accuracy is 1 when zero raw findings were produced across the run', () => {
    const cases: RunCaseInput[] = [
      {
        polarity: 'must_not_flag',
        errored: false,
        score: scoreCase([mkExpectation({ kind: 'must_not_flag' })], [], 0),
      },
    ];
    expect(aggregate(cases).citation_accuracy).toBe(1);
  });

  it('computes recall/precision/citation_accuracy under content-trigger rules', () => {
    // Case A: must_find, passes (1 grounded = TP).
    const a: RunCaseInput = {
      polarity: 'must_find',
      errored: false,
      score: scoreCase(
        [mkExpectation({ kind: 'must_find', file: 'src/a.ts', start_line: 1, end_line: 1 })],
        [mkFinding({ file: 'src/a.ts', start_line: 1, end_line: 1 })],
        1,
      ),
    };
    // Case B: must_find, passes even though finding is off the seed zone (1 TP).
    const b: RunCaseInput = {
      polarity: 'must_find',
      errored: false,
      score: scoreCase(
        [mkExpectation({ kind: 'must_find', file: 'src/b.ts', start_line: 1, end_line: 1 })],
        [mkFinding({ file: 'src/other.ts', start_line: 9, end_line: 9 })],
        2,
      ),
    };
    // Case C: must_not_flag, passes (nothing grounded).
    const c: RunCaseInput = {
      polarity: 'must_not_flag',
      errored: false,
      score: scoreCase(
        [mkExpectation({ kind: 'must_not_flag', file: 'src/c.ts', start_line: 1, end_line: 1 })],
        [],
        0,
      ),
    };

    const metrics = aggregate([a, b, c]);
    expect(metrics.recall).toBe(1);
    expect(metrics.precision).toBe(1); // 2 TP / 2 grounded
    expect(metrics.citation_accuracy).toBeCloseTo(2 / 3);
    expect(metrics.passed).toBe(3);
    expect(metrics.total).toBe(3);
  });

  it('precision is grounded_on_must_find / all_grounded (2/5 when negative contributes 3)', () => {
    const positive: RunCaseInput = {
      polarity: 'must_find',
      errored: false,
      score: scoreCase(
        [mkExpectation({ kind: 'must_find' })],
        [mkFinding(), mkFinding({ start_line: 11, end_line: 11 })],
        2,
      ),
    };
    const negative: RunCaseInput = {
      polarity: 'must_not_flag',
      errored: false,
      score: scoreCase(
        [mkExpectation({ kind: 'must_not_flag' })],
        [mkFinding(), mkFinding({ start_line: 12 }), mkFinding({ start_line: 13 })],
        3,
      ),
    };
    const metrics = aggregate([positive, negative]);
    expect(metrics.precision).toBeCloseTo(2 / 5);
    expect(metrics.recall).toBe(1);
    expect(metrics.passed).toBe(1); // only positive
  });

  it('an errored case counts toward total but never toward passed, and contributes no findings to precision/citation_accuracy', () => {
    const cases: RunCaseInput[] = [
      { polarity: 'must_find', errored: true, score: null },
      {
        polarity: 'must_find',
        errored: false,
        score: scoreCase(
          [mkExpectation({ kind: 'must_find', file: 'src/a.ts', start_line: 1, end_line: 1 })],
          [mkFinding({ file: 'src/a.ts', start_line: 1, end_line: 1 })],
          1,
        ),
      },
    ];
    const metrics = aggregate(cases);
    expect(metrics.total).toBe(2);
    expect(metrics.passed).toBe(1);
    expect(metrics.recall).toBeCloseTo(0.5);
    expect(metrics.precision).toBe(1);
    expect(metrics.citation_accuracy).toBe(1);
  });
});

describe('module purity (AC-19)', () => {
  it('scoring.ts declares no runtime import — every import is type-only', () => {
    const path = fileURLToPath(new URL('../src/modules/evals/scoring.ts', import.meta.url));
    const source = readFileSync(path, 'utf8');
    const importLines = source
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('import '));

    expect(importLines.length).toBeGreaterThan(0);
    for (const line of importLines) {
      expect(line).toMatch(/^import type /);
    }
  });
});
