/**
 * T26 — hermetic unit tests for the pure scoring module
 * (`modules/eval/scoring.ts`). One test per scoring rule (AC-21, AC-23…AC-28),
 * each written against plain `ScoredCase` fixtures this file builds itself —
 * no repository, no LLM, no Fastify.
 */
import { describe, it, expect } from 'vitest';
import {
  casePassed,
  countMatchedFindings,
  matchesExpectation,
  scoreSuite,
  sumCost,
  type ScoredCase,
} from '../src/modules/eval/scoring.js';
import type { EvalExpectation, EvalReturnedFinding } from '@devdigest/shared';

function expectation(overrides: Partial<EvalExpectation> = {}): EvalExpectation {
  return { id: 'e1', kind: 'must_find', file: 'a.ts', start_line: 10, end_line: 20, ...overrides };
}

function finding(overrides: Partial<EvalReturnedFinding> = {}): EvalReturnedFinding {
  return { file: 'a.ts', start_line: 12, end_line: 12, grounded: true, ...overrides };
}

function scoredCase(overrides: Partial<ScoredCase> = {}): ScoredCase {
  return { caseId: 'c1', expectations: [], findings: [], completed: true, ...overrides };
}

describe('eval_scoring_matches_on_file_and_overlap', () => {
  it('eval_scoring_matches_on_file_and_overlap', () => {
    const e = expectation({ file: 'a.ts', start_line: 10, end_line: 20 });

    // Same file, overlapping range → match, regardless of title/severity.
    expect(matchesExpectation(finding({ file: 'a.ts', start_line: 15, end_line: 15 }), e)).toBe(true);
    expect(
      matchesExpectation(
        finding({ file: 'a.ts', start_line: 15, end_line: 15, title: 'Different title', severity: 'CRITICAL' }),
        e,
      ),
    ).toBe(true);

    // Different file, same numeric range → no match.
    expect(matchesExpectation(finding({ file: 'b.ts', start_line: 15, end_line: 15 }), e)).toBe(false);

    // Same file, non-overlapping range → no match.
    expect(matchesExpectation(finding({ file: 'a.ts', start_line: 30, end_line: 35 }), e)).toBe(false);

    // Ungrounded finding never matches anything, even with a perfect
    // file+range hit — the grounding gate runs first (flowchart: B before E).
    expect(matchesExpectation(finding({ file: 'a.ts', start_line: 15, end_line: 15, grounded: false }), e)).toBe(
      false,
    );
  });
});

describe('eval_scoring_recall_over_must_find', () => {
  it('eval_scoring_recall_over_must_find', () => {
    const matchedExp = expectation({ id: 'mf1', file: 'a.ts', start_line: 10, end_line: 12 });
    const unmatchedExp = expectation({ id: 'mf2', file: 'b.ts', start_line: 10, end_line: 12 });

    const cases: ScoredCase[] = [
      scoredCase({
        caseId: 'c1',
        expectations: [matchedExp],
        findings: [finding({ file: 'a.ts', start_line: 11, end_line: 11 })],
      }),
      scoredCase({
        caseId: 'c2',
        expectations: [unmatchedExp],
        findings: [], // nothing returned for c2 — unmatchedExp stays unmatched
      }),
    ];

    const metrics = scoreSuite(cases);
    expect(metrics.recall).toBe(0.5);
  });
});

describe('eval_scoring_precision_ignores_unlabelled', () => {
  it('eval_scoring_precision_ignores_unlabelled', () => {
    const mustFind = expectation({ id: 'mf', kind: 'must_find', file: 'a.ts', start_line: 10, end_line: 12 });
    const mustNotFlag = expectation({
      id: 'mnf',
      kind: 'must_not_flag',
      file: 'a.ts',
      start_line: 30,
      end_line: 32,
    });

    const correctHit = finding({ file: 'a.ts', start_line: 11, end_line: 11 }); // matches must_find
    const falsePositive = finding({ file: 'a.ts', start_line: 31, end_line: 31 }); // matches must_not_flag
    const unlabelled = finding({ file: 'a.ts', start_line: 60, end_line: 60 }); // matches neither

    const cases: ScoredCase[] = [
      scoredCase({
        caseId: 'c1',
        expectations: [mustFind, mustNotFlag],
        findings: [correctHit, falsePositive, unlabelled],
      }),
    ];

    const metrics = scoreSuite(cases);
    // Considered set is {correctHit, falsePositive} — `unlabelled` is in
    // NEITHER the numerator nor the denominator.
    expect(metrics.precision).toBe(0.5);
  });
});

describe('eval_scoring_citation_accuracy_over_all_returned', () => {
  it('eval_scoring_citation_accuracy_over_all_returned', () => {
    const grounded1 = finding({ file: 'a.ts', start_line: 11, end_line: 11, grounded: true });
    const grounded2 = finding({ file: 'a.ts', start_line: 60, end_line: 60, grounded: true }); // matches nothing
    const ungrounded = finding({ file: 'a.ts', start_line: 999, end_line: 999, grounded: false });

    const cases: ScoredCase[] = [
      scoredCase({
        caseId: 'c1',
        expectations: [expectation({ file: 'a.ts', start_line: 10, end_line: 12 })],
        findings: [grounded1, grounded2, ungrounded],
      }),
    ];

    const metrics = scoreSuite(cases);
    // 2 of 3 returned findings passed the grounding gate — matched or not.
    expect(metrics.citationAccuracy).toBeCloseTo(2 / 3);
  });
});

describe('eval_scoring_absent_metric_is_null_not_zero', () => {
  it('eval_scoring_absent_metric_is_null_not_zero', () => {
    // No must_find expectation anywhere scored → recall absent.
    const allMustNotFlag: ScoredCase[] = [
      scoredCase({
        caseId: 'c1',
        expectations: [expectation({ kind: 'must_not_flag', file: 'a.ts', start_line: 10, end_line: 12 })],
        findings: [],
      }),
    ];
    expect(scoreSuite(allMustNotFlag).recall).toBeNull();

    // No returned finding matches any expectation → precision absent.
    const noMatches: ScoredCase[] = [
      scoredCase({
        caseId: 'c1',
        expectations: [expectation({ file: 'a.ts', start_line: 10, end_line: 12 })],
        findings: [finding({ file: 'a.ts', start_line: 99, end_line: 99 })],
      }),
    ];
    expect(scoreSuite(noMatches).precision).toBeNull();

    // No finding returned at all → citation accuracy absent.
    const nothingReturned: ScoredCase[] = [
      scoredCase({ caseId: 'c1', expectations: [expectation()], findings: [] }),
    ];
    expect(scoreSuite(nothingReturned).citationAccuracy).toBeNull();
  });
});

describe('eval_scoring_case_pass_rule', () => {
  it('eval_scoring_case_pass_rule', () => {
    const mustFind = expectation({ id: 'mf', kind: 'must_find', file: 'a.ts', start_line: 10, end_line: 12 });
    const mustNotFlag = expectation({
      id: 'mnf',
      kind: 'must_not_flag',
      file: 'a.ts',
      start_line: 30,
      end_line: 32,
    });

    // Passes: must_find matched, must_not_flag not matched.
    expect(
      casePassed(
        scoredCase({
          expectations: [mustFind, mustNotFlag],
          findings: [finding({ file: 'a.ts', start_line: 11, end_line: 11 })],
        }),
      ),
    ).toBe(true);

    // Fails: must_find left unmatched.
    expect(
      casePassed(scoredCase({ expectations: [mustFind, mustNotFlag], findings: [] })),
    ).toBe(false);

    // Fails: a must_not_flag range was hit, even though must_find was too.
    expect(
      casePassed(
        scoredCase({
          expectations: [mustFind, mustNotFlag],
          findings: [
            finding({ file: 'a.ts', start_line: 11, end_line: 11 }),
            finding({ file: 'a.ts', start_line: 31, end_line: 31 }),
          ],
        }),
      ),
    ).toBe(false);

    // An incomplete case never passes, even with a findings set that would
    // otherwise satisfy every expectation.
    expect(
      casePassed(
        scoredCase({
          expectations: [mustFind],
          findings: [finding({ file: 'a.ts', start_line: 11, end_line: 11 })],
          completed: false,
        }),
      ),
    ).toBe(false);
  });
});

describe('eval_scoring_counts_findings_matching_the_case_expectation', () => {
  it('eval_scoring_counts_findings_matching_the_case_expectation', () => {
    const mustFind = expectation({ id: 'mf', kind: 'must_find', file: 'a.ts', start_line: 10, end_line: 20 });

    // Hit once.
    expect(
      countMatchedFindings(
        scoredCase({
          expectations: [mustFind],
          findings: [finding({ file: 'a.ts', start_line: 12, end_line: 12 })],
        }),
      ),
    ).toBe(1);

    // Hit twice — two returned findings both land inside the range.
    expect(
      countMatchedFindings(
        scoredCase({
          expectations: [mustFind],
          findings: [
            finding({ file: 'a.ts', start_line: 12, end_line: 12 }),
            finding({ file: 'a.ts', start_line: 15, end_line: 15 }),
          ],
        }),
      ),
    ).toBe(2);

    // Not at all — nothing returned.
    expect(countMatchedFindings(scoredCase({ expectations: [mustFind], findings: [] }))).toBe(0);

    const mustNotFlag = expectation({
      id: 'mnf',
      kind: 'must_not_flag',
      file: 'a.ts',
      start_line: 30,
      end_line: 32,
    });

    // must_not_flag: a finding INSIDE its range counts too — the returned
    // count is "matched ANY expectation", not "matched a must_find only".
    expect(
      countMatchedFindings(
        scoredCase({
          expectations: [mustNotFlag],
          findings: [finding({ file: 'a.ts', start_line: 31, end_line: 31 })],
        }),
      ),
    ).toBe(1);

    // The load-bearing rule: a finding OUTSIDE every labelled range counts
    // as 0, even though it was returned by the agent.
    expect(
      countMatchedFindings(
        scoredCase({
          expectations: [mustNotFlag],
          findings: [finding({ file: 'a.ts', start_line: 60, end_line: 60 })],
        }),
      ),
    ).toBe(0);

    // An ungrounded finding inside the range never counts — matchesExpectation
    // rejects it before the range check ever runs.
    expect(
      countMatchedFindings(
        scoredCase({
          expectations: [mustFind],
          findings: [finding({ file: 'a.ts', start_line: 12, end_line: 12, grounded: false })],
        }),
      ),
    ).toBe(0);
  });
});

describe('eval_scoring_excludes_incomplete_cases', () => {
  it('eval_scoring_excludes_incomplete_cases', () => {
    const completedCase = scoredCase({
      caseId: 'c1',
      expectations: [expectation({ file: 'a.ts', start_line: 10, end_line: 12 })],
      findings: [finding({ file: 'a.ts', start_line: 11, end_line: 11 })],
      completed: true,
    });
    // An incomplete case whose findings/expectations WOULD move every metric
    // if counted — it must not.
    const incompleteCase = scoredCase({
      caseId: 'c2',
      expectations: [expectation({ file: 'z.ts', start_line: 1, end_line: 2 })],
      findings: [finding({ file: 'z.ts', start_line: 1, end_line: 1, grounded: false })],
      completed: false,
    });

    const metrics = scoreSuite([completedCase, incompleteCase]);
    expect(metrics.recall).toBe(1); // only completedCase's must_find counted, and it matched
    expect(metrics.precision).toBe(1);
    expect(metrics.citationAccuracy).toBe(1); // incompleteCase's ungrounded finding excluded
    expect(metrics.casesFailedToComplete).toBe(1);
    expect(metrics.casesPassed).toBe(1); // only the completed, passing case counts
  });
});

describe('sumCost — null-propagating sum', () => {
  it('propagates null when any per-case cost is undetermined, and sums otherwise', () => {
    expect(sumCost([0.01, 0.02, null])).toBeNull();
    expect(sumCost([0.01, 0.02])).toBeCloseTo(0.03);
    expect(sumCost([])).toBe(0);
  });
});
