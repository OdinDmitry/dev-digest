import type { EvalExpectation, EvalExpectationKind, Finding } from '@devdigest/shared';

/**
 * modules/evals/scoring.ts — the mechanical, model-free eval scorer
 * (`onion-architecture` ring 2, pure). Zero runtime imports; only types cross
 * from the shared contracts package. Matching is defined over zones only: a
 * file path plus a closed line interval, taken either from an expectation or
 * a grounded finding, per spec's "Matching and scoring" contracts.
 *
 * Scoring here never calls a structured-output API or any network provider —
 * it is arithmetic over already-grounded results (AC-19).
 */

export interface Zone {
  file: string;
  start: number;
  end: number;
}

/**
 * Repository-relative, forward-slash path, with any single leading diff-side
 * prefix (`a/` or `b/`) stripped. Comparison stays case-sensitive to agree
 * with the citation-grounding gate that produced the findings being matched.
 */
export function normalizeZonePath(path: string): string {
  const posix = path.replace(/\\/g, '/');
  if (posix.startsWith('a/') || posix.startsWith('b/')) return posix.slice(2);
  return posix;
}

/** Two zones match when they name the same file and their closed line ranges
 *  overlap in at least one line (AC-12). */
export function zonesOverlap(a: Zone, b: Zone): boolean {
  if (normalizeZonePath(a.file) !== normalizeZonePath(b.file)) return false;
  const aLo = Math.min(a.start, a.end);
  const aHi = Math.max(a.start, a.end);
  const bLo = Math.min(b.start, b.end);
  const bHi = Math.max(b.start, b.end);
  return aLo <= bHi && bLo <= aHi;
}

export function expectationZone(e: EvalExpectation): Zone {
  return { file: e.file, start: e.start_line, end: e.end_line };
}

export function findingZone(f: Finding): Zone {
  return { file: f.file, start: f.start_line, end: f.end_line };
}

export function matchesAny(z: Zone, expectations: EvalExpectation[]): boolean {
  return expectations.some((e) => zonesOverlap(z, expectationZone(e)));
}

export interface CaseScore {
  passed: boolean;
  /** AC-20 "expected" — the count of the case's `must_find` expectations. */
  expectedCount: number;
  /** AC-20 "obtained" — grounded findings matching >=1 expectation, any kind. */
  matchedCount: number;
  /** AC-16 numerator contribution — grounded findings matching >=1 `must_find`
   *  expectation AND 0 `must_not_flag` expectation. A finding matching both
   *  is not a true positive: the forbidden zone wins. */
  truePositives: number;
  groundedCount: number;
  rawCount: number;
}

/**
 * Score one case's grounded result. `expectations` is generally single-kind
 * for a real persisted case (the polarity invariant, enforced at save time —
 * see `helpers.ts`), but this function makes no such assumption: it always
 * evaluates `must_find` and `must_not_flag` expectations independently, so a
 * finding that matches both kinds still fails the `must_not_flag` half.
 */
export function scoreCase(
  expectations: EvalExpectation[],
  grounded: Finding[],
  rawCount: number,
): CaseScore {
  const mustFind = expectations.filter((e) => e.kind === 'must_find');
  const mustNotFlag = expectations.filter((e) => e.kind === 'must_not_flag');

  let truePositives = 0;
  let matchedCount = 0;
  let anyMustFindMatch = false;
  let anyMustNotFlagMatch = false;

  for (const f of grounded) {
    const zone = findingZone(f);
    const matchesMustFind = matchesAny(zone, mustFind);
    const matchesMustNotFlag = matchesAny(zone, mustNotFlag);
    if (matchesMustFind) anyMustFindMatch = true;
    if (matchesMustNotFlag) anyMustNotFlagMatch = true;
    if (matchesMustFind && !matchesMustNotFlag) truePositives += 1;
    if (matchesMustFind || matchesMustNotFlag) matchedCount += 1;
  }

  // AC-13 (must_find: at least one match passes) + AC-14 (must_not_flag: no
  // match passes) combined — a must_not_flag violation always fails the case
  // (AC-14 / "the forbidden zone wins"), independent of any must_find match.
  const passed = !anyMustNotFlagMatch && (mustFind.length === 0 || anyMustFindMatch);

  return {
    passed,
    expectedCount: mustFind.length,
    matchedCount,
    truePositives,
    groundedCount: grounded.length,
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
