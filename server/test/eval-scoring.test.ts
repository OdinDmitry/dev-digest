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
 * Hermetic unit tests over `modules/evals/scoring.ts` — the pure, model-free
 * scorer (`docs/plans/2026-08-22-eval-pipeline-a-foundation.md` T16). Covers
 * AC-12..AC-20.
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

describe('zonesOverlap (AC-12)', () => {
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

describe('normalizeZonePath (AC-12)', () => {
  it('resolves a/-prefixed, b/-prefixed and backslash-separated forms to the same file', () => {
    expect(normalizeZonePath('a/src/x.ts')).toBe('src/x.ts');
    expect(normalizeZonePath('b/src/x.ts')).toBe('src/x.ts');
    expect(normalizeZonePath('src\\x.ts')).toBe('src/x.ts');
    // All three overlap each other once normalized.
    expect(
      zonesOverlap({ file: 'a/src/x.ts', start: 10, end: 10 }, { file: 'b/src/x.ts', start: 10, end: 10 }),
    ).toBe(true);
    expect(
      zonesOverlap({ file: 'src\\x.ts', start: 10, end: 10 }, { file: 'src/x.ts', start: 10, end: 10 }),
    ).toBe(true);
  });

  it('comparison stays case-sensitive: src/X.ts does not equal src/x.ts', () => {
    expect(normalizeZonePath('src/X.ts')).not.toBe(normalizeZonePath('src/x.ts'));
    expect(
      zonesOverlap({ file: 'src/X.ts', start: 10, end: 10 }, { file: 'src/x.ts', start: 10, end: 10 }),
    ).toBe(false);
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
  it('passes when a grounded finding overlaps the must_find expectation, and reports expected/obtained', () => {
    const expectations = [mkExpectation({ kind: 'must_find', file: 'src/x.ts', start_line: 10, end_line: 10 })];
    const grounded = [mkFinding({ file: 'src/x.ts', start_line: 10, end_line: 10 })];

    const score = scoreCase(expectations, grounded, 1);
    expect(score.passed).toBe(true);
    expect(score.expectedCount).toBe(1); // AC-20 "expected"
    expect(score.matchedCount).toBe(1); // AC-20 "obtained"
    expect(score.truePositives).toBe(1);
    expect(score.groundedCount).toBe(1);
    expect(score.rawCount).toBe(1);
  });

  it('fails when no grounded finding overlaps the must_find expectation', () => {
    const expectations = [mkExpectation({ kind: 'must_find', file: 'src/x.ts', start_line: 10, end_line: 10 })];
    const grounded = [mkFinding({ file: 'src/y.ts', start_line: 1, end_line: 1 })];

    const score = scoreCase(expectations, grounded, 1);
    expect(score.passed).toBe(false);
    expect(score.expectedCount).toBe(1);
    expect(score.matchedCount).toBe(0); // AC-20 "obtained" — nothing matched
    expect(score.truePositives).toBe(0);
  });
});

describe('scoreCase — negative case (must_not_flag), AC-14/AC-20', () => {
  it('passes when no grounded finding overlaps the forbidden zone', () => {
    const expectations = [mkExpectation({ kind: 'must_not_flag', file: 'src/x.ts', start_line: 10, end_line: 10 })];
    const grounded = [mkFinding({ file: 'src/y.ts', start_line: 1, end_line: 1 })];

    const score = scoreCase(expectations, grounded, 1);
    expect(score.passed).toBe(true);
    expect(score.expectedCount).toBe(0); // no must_find expectations in this case
    expect(score.matchedCount).toBe(0);
  });

  it('fails when a grounded finding overlaps the forbidden zone, and still reports it in "obtained"', () => {
    const expectations = [mkExpectation({ kind: 'must_not_flag', file: 'src/x.ts', start_line: 10, end_line: 10 })];
    const grounded = [mkFinding({ file: 'src/x.ts', start_line: 10, end_line: 10 })];

    const score = scoreCase(expectations, grounded, 1);
    expect(score.passed).toBe(false);
    expect(score.matchedCount).toBe(1); // AC-20 "obtained" counts any-kind matches
    expect(score.truePositives).toBe(0); // a must_not_flag match is never a true positive
  });

  it('a finding matching BOTH a must_find and a must_not_flag expectation is not a true positive and fails the negative case', () => {
    const expectations = [
      mkExpectation({ kind: 'must_find', file: 'src/x.ts', start_line: 10, end_line: 10 }),
      mkExpectation({ kind: 'must_not_flag', file: 'src/x.ts', start_line: 10, end_line: 10 }),
    ];
    const grounded = [mkFinding({ file: 'src/x.ts', start_line: 10, end_line: 10 })];

    const score = scoreCase(expectations, grounded, 1);
    // The forbidden zone wins — this is not a passing case, and the finding
    // does not count as a true positive despite also satisfying must_find.
    expect(score.passed).toBe(false);
    expect(score.truePositives).toBe(0);
    expect(score.matchedCount).toBe(1); // matched at least one expectation, of any kind
  });
});

describe('scoreCase — duplicate overlapping expectations', () => {
  it('a single finding overlapping two must_find expectations at the same zone is counted once as a true positive but each expectation independently seeing the match does not double-count matchedCount', () => {
    const expectations = [
      mkExpectation({ kind: 'must_find', file: 'src/x.ts', start_line: 10, end_line: 10 }),
      mkExpectation({ kind: 'must_find', file: 'src/x.ts', start_line: 10, end_line: 12 }),
    ];
    const grounded = [mkFinding({ file: 'src/x.ts', start_line: 10, end_line: 10 })];

    const score = scoreCase(expectations, grounded, 1);
    expect(score.expectedCount).toBe(2); // both duplicate expectations are counted
    expect(score.passed).toBe(true);
    expect(score.matchedCount).toBe(1); // one grounded finding, matched once
    expect(score.truePositives).toBe(1);
  });

  it('two distinct grounded findings each overlapping the same duplicated expectations both count', () => {
    const expectations = [
      mkExpectation({ kind: 'must_find', file: 'src/x.ts', start_line: 10, end_line: 10 }),
      mkExpectation({ kind: 'must_find', file: 'src/x.ts', start_line: 10, end_line: 10 }),
    ];
    const grounded = [
      mkFinding({ file: 'src/x.ts', start_line: 10, end_line: 10 }),
      mkFinding({ file: 'src/x.ts', start_line: 10, end_line: 10 }),
    ];

    const score = scoreCase(expectations, grounded, 2);
    expect(score.expectedCount).toBe(2);
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
        score: scoreCase(
          [mkExpectation({ kind: 'must_not_flag' })],
          [],
          0,
        ),
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

  it('computes recall/precision/citation_accuracy and passed/total over a mixed run', () => {
    // Case A: must_find, passes (1 grounded, 1 raw, true positive).
    const a: RunCaseInput = {
      polarity: 'must_find',
      errored: false,
      score: scoreCase(
        [mkExpectation({ kind: 'must_find', file: 'src/a.ts', start_line: 1, end_line: 1 })],
        [mkFinding({ file: 'src/a.ts', start_line: 1, end_line: 1 })],
        1,
      ),
    };
    // Case B: must_find, fails (nothing grounded matches; 1 grounded finding
    // is an off-target false positive, plus 1 dropped raw finding).
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
    // recall: must_find cases are A and B; A passes, B fails => 1/2
    expect(metrics.recall).toBeCloseTo(0.5);
    // precision: true positives (1 from A) / grounded (1 from A + 1 from B) = 1/2
    expect(metrics.precision).toBeCloseTo(0.5);
    // citation accuracy: grounded (2) / raw (1 + 2 + 0 = 3)
    expect(metrics.citation_accuracy).toBeCloseTo(2 / 3);
    expect(metrics.passed).toBe(2); // A and C
    expect(metrics.total).toBe(3);
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
    // recall denominator includes the errored must_find case (2), numerator
    // is only the one that actually passed (1).
    expect(metrics.recall).toBeCloseTo(0.5);
    // precision/citation_accuracy: errored case contributes nothing, so this
    // is exactly the surviving case's own numbers (1/1, 1/1).
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

    expect(importLines.length).toBeGreaterThan(0); // sanity: the file does import something
    for (const line of importLines) {
      expect(line).toMatch(/^import type /);
    }
  });
});
