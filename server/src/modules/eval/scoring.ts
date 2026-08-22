import type { EvalExpectation, EvalReturnedFinding } from '@devdigest/shared';
import { rangesOverlap } from './helpers.js';

/**
 * Pure scoring module — plain functions over plain data. No ORM imports, no
 * table-schema imports, no web-framework imports, and no LLM type
 * (`onion-architecture` — "Ring 2 has no technology imports"). This is what
 * makes AC-23…AC-29 hermetic unit tests, and what makes AC-29 ("zero model
 * calls on the scoring path") true by construction: nothing in this file can
 * reach an LLM.
 */

export interface ScoredCase {
  caseId: string;
  expectations: EvalExpectation[];
  /** BOTH grounded and ungrounded findings — citation accuracy needs both. */
  findings: EvalReturnedFinding[];
  completed: boolean;
}

/**
 * A finding matches an expectation when it shares the expectation's file and
 * its range overlaps — nothing else. An ungrounded finding never matches
 * anything: recall/precision only credit findings the citation gate kept.
 */
export function matchesExpectation(f: EvalReturnedFinding, e: EvalExpectation): boolean {
  if (!f.grounded) return false;
  if (f.file !== e.file) return false;
  return rangesOverlap(f.start_line, f.end_line, e.start_line, e.end_line);
}

/**
 * AC-53 — the returned finding count: findings in the case's result that
 * match ANY expectation of that case, by the same rule `matchesExpectation`
 * applies to the suite metrics. Reused (never re-derived) so this number and
 * the metrics can never disagree.
 */
export function countMatchedFindings(c: ScoredCase): number {
  return c.findings.filter((f) => c.expectations.some((e) => matchesExpectation(f, e))).length;
}

/**
 * AC-28 — a case passes when every `must_find` expectation is matched by
 * some returned finding AND no `must_not_flag` expectation is matched.
 * An incomplete case never passes.
 */
export function casePassed(c: ScoredCase): boolean {
  if (!c.completed) return false;
  const mustFind = c.expectations.filter((e) => e.kind === 'must_find');
  const mustNotFlag = c.expectations.filter((e) => e.kind === 'must_not_flag');
  const allFound = mustFind.every((e) => c.findings.some((f) => matchesExpectation(f, e)));
  const noneFlagged = mustNotFlag.every((e) => !c.findings.some((f) => matchesExpectation(f, e)));
  return allFound && noneFlagged;
}

/**
 * Suite-level metrics over `cases` (AC-21 excludes incomplete cases from
 * every metric below; `casesFailedToComplete` counts them separately).
 * Every metric is `null`, never `0`, when its denominator is zero (AC-27).
 */
export function scoreSuite(cases: ScoredCase[]): {
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  casesPassed: number;
  casesFailedToComplete: number;
} {
  const completed = cases.filter((c) => c.completed);

  let mustFindTotal = 0;
  let mustFindMatched = 0;
  // AC-25 — precision ignores findings matching no expectation, in BOTH the
  // numerator and the denominator. Only findings that land inside a labelled
  // range (must_find OR must_not_flag) are "considered".
  let precisionConsidered = 0;
  let precisionCorrect = 0;
  let findingsTotal = 0;
  let groundedTotal = 0;

  for (const c of completed) {
    const mustFind = c.expectations.filter((e) => e.kind === 'must_find');
    const mustNotFlag = c.expectations.filter((e) => e.kind === 'must_not_flag');

    mustFindTotal += mustFind.length;
    for (const e of mustFind) {
      if (c.findings.some((f) => matchesExpectation(f, e))) mustFindMatched++;
    }

    for (const f of c.findings) {
      findingsTotal++;
      if (f.grounded) groundedTotal++;

      const flagsUnwanted = mustNotFlag.some((e) => matchesExpectation(f, e));
      const findsWanted = mustFind.some((e) => matchesExpectation(f, e));
      if (flagsUnwanted) {
        precisionConsidered++;
      } else if (findsWanted) {
        precisionConsidered++;
        precisionCorrect++;
      }
      // else: matches no expectation at all — excluded from precision entirely.
    }
  }

  return {
    recall: mustFindTotal === 0 ? null : mustFindMatched / mustFindTotal,
    precision: precisionConsidered === 0 ? null : precisionCorrect / precisionConsidered,
    citationAccuracy: findingsTotal === 0 ? null : groundedTotal / findingsTotal,
    casesPassed: cases.filter((c) => casePassed(c)).length,
    casesFailedToComplete: cases.filter((c) => !c.completed).length,
  };
}

/** Null-propagating sum, mirroring `reviewer-core/src/review/run.ts:197` — a
 *  single undetermined per-case cost makes the whole suite's cost `null`. */
export function sumCost(perCase: (number | null)[]): number | null {
  let total = 0;
  for (const cost of perCase) {
    if (cost === null) return null;
    total += cost;
  }
  return total;
}
