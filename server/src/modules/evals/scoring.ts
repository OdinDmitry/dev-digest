import type { EvalExpectation, EvalExpectationKind, Finding } from '@devdigest/shared';
import type { Zone } from '../_shared/zones.js';

/**
 * modules/evals/scoring.ts — the mechanical, model-free eval scorer
 * (`onion-architecture` ring 2, pure). Zero runtime imports; only types cross
 * from the shared contracts package.
 *
 * Content-trigger (SPEC-03 AC-12..14): pass/fail depends on polarity and
 * grounded finding *count* only. Expectation file/line fields are provenance
 * for the UI, not a match key. Zone helpers below remain for optional
 * display/normalization callers; `scoreCase` does not use them.
 *
 * Scoring here never calls a structured-output API or any network provider —
 * it is arithmetic over already-grounded results (AC-19).
 *
 * `Zone`/`normalizeZonePath`/`zonesOverlap` moved to `../_shared/zones.js`
 * (also used by multi-agent conflict clustering) and are re-exported here
 * unchanged so existing importers of this module keep working.
 */

export type { Zone };
export { normalizeZonePath, zonesOverlap } from '../_shared/zones.js';

export function expectationZone(e: EvalExpectation): Zone {
  return { file: e.file, start: e.start_line, end: e.end_line };
}

export function findingZone(f: Finding): Zone {
  return { file: f.file, start: f.start_line, end: f.end_line };
}

/**
 * `matchesAny` needs `zonesOverlap` as a runtime value, but this module keeps
 * a type-only import surface (AC-19's purity test). `overlapsLocally` is a
 * private, unexported duplicate of `../_shared/zones.js`'s `zonesOverlap`
 * body — the canonical, exported copy other modules import lives there;
 * this one exists only so this file never needs a runtime import of its own.
 */
function overlapsLocally(a: Zone, b: Zone): boolean {
  const normalize = (path: string): string => {
    const posix = path.replace(/\\/g, '/');
    return posix.startsWith('a/') || posix.startsWith('b/') ? posix.slice(2) : posix;
  };
  if (normalize(a.file) !== normalize(b.file)) return false;
  const aLo = Math.min(a.start, a.end);
  const aHi = Math.max(a.start, a.end);
  const bLo = Math.min(b.start, b.end);
  const bHi = Math.max(b.start, b.end);
  return aLo <= bHi && bLo <= aHi;
}

export function matchesAny(z: Zone, expectations: EvalExpectation[]): boolean {
  return expectations.some((e) => overlapsLocally(z, expectationZone(e)));
}

export interface CaseScore {
  passed: boolean;
  /** AC-20 "expected" — 1 for must_find, 0 for must_not_flag. */
  expectedCount: number;
  /** AC-20 "obtained" — all grounded findings on this case. */
  matchedCount: number;
  /** AC-16 numerator contribution — all grounded findings when the case is
   *  must_find polarity; 0 on must_not_flag cases. */
  truePositives: number;
  groundedCount: number;
  rawCount: number;
}

/**
 * Score one case's grounded result (AC-13 / AC-14). Any `must_not_flag`
 * expectation makes the case negative (0 grounded required); otherwise it is
 * positive (≥1 grounded required). Mixed kinds are treated as negative so a
 * forbidden polarity cannot silently pass.
 */
export function scoreCase(
  expectations: EvalExpectation[],
  grounded: Finding[],
  rawCount: number,
): CaseScore {
  const mustNotFlag = expectations.some((e) => e.kind === 'must_not_flag');
  const groundedCount = grounded.length;
  const passed = mustNotFlag ? groundedCount === 0 : groundedCount >= 1;
  const expectedCount = mustNotFlag ? 0 : 1;
  const truePositives = mustNotFlag ? 0 : groundedCount;

  return {
    passed,
    expectedCount,
    matchedCount: groundedCount,
    truePositives,
    groundedCount,
    rawCount,
  };
}

export interface RunCaseInput {
  polarity: EvalExpectationKind;
  errored: boolean;
  /** null when the case errored — contributes no findings to precision or
   *  citation accuracy, and is never recorded passed (AC-28). */
  score: CaseScore | null;
}

export interface RunMetrics {
  recall: number;
  precision: number;
  citation_accuracy: number;
  passed: number;
  total: number;
}

/**
 * Aggregate a run's case results into its metrics (AC-15..AC-18). Every sum
 * here is over case RESULTS the run actually produced — an errored case
 * still counts toward `total` and toward recall's denominator when it is a
 * `must_find` case, but contributes nothing else (Edge cases, "A case whose
 * evaluation errors").
 */
export function aggregate(cases: RunCaseInput[]): RunMetrics {
  const mustFindCases = cases.filter((c) => c.polarity === 'must_find');
  const mustFindPassed = mustFindCases.filter(
    (c) => !c.errored && c.score?.passed === true,
  ).length;
  const recall = mustFindCases.length === 0 ? 1 : mustFindPassed / mustFindCases.length;

  let truePositivesSum = 0;
  let groundedSum = 0;
  let rawSum = 0;
  for (const c of cases) {
    if (c.errored || !c.score) continue;
    truePositivesSum += c.score.truePositives;
    groundedSum += c.score.groundedCount;
    rawSum += c.score.rawCount;
  }
  const precision = groundedSum === 0 ? 1 : truePositivesSum / groundedSum;
  const citation_accuracy = rawSum === 0 ? 1 : groundedSum / rawSum;

  const passed = cases.filter((c) => !c.errored && c.score?.passed === true).length;

  return { recall, precision, citation_accuracy, passed, total: cases.length };
}
