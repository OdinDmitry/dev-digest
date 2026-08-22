import { describe, it, expect } from 'vitest';
import type { EvalExpectation, Finding } from '@devdigest/shared';
import type { EvalCaseResultRow, EvalSuiteRunRow } from '../src/modules/evals/repository/index.js';
import type { EvalCaseRow } from '../src/modules/evals/repository/case.repo.js';
import { runMetricsFrom, metricDelta, caseRowToDto } from '../src/modules/evals/helpers.js';

/**
 * Hermetic unit tests over `modules/evals/helpers.ts`'s metrics/delta
 * surface (`docs/plans/2026-08-22-eval-pipeline-b-suite-runs.md` T15).
 * Covers AC-29, AC-38, AC-50.
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
    ...overrides,
  };
}

let resultSeq = 0;
function mkResultRow(overrides: Partial<EvalCaseResultRow> = {}): EvalCaseResultRow {
  resultSeq += 1;
  return {
    id: `result-${resultSeq}`,
    runId: 'run-1',
    caseId: `case-${resultSeq}`,
    ordinal: resultSeq,
    caseName: `Case ${resultSeq}`,
    caseRepoId: null,
    caseInputDiff: 'diff --git a/src/x.ts b/src/x.ts',
    caseExpectations: [mkExpectation()],
    status: 'passed',
    error: null,
    findings: [],
    rawFindingsCount: 0,
    expectedCount: 1,
    matchedCount: 0,
    costUsd: 0.001,
    durationMs: 100,
    createdAt: new Date('2026-08-22T00:00:00.000Z'),
    ...overrides,
  } as EvalCaseResultRow;
}

let runSeq = 0;
function mkRunRow(overrides: Partial<EvalSuiteRunRow> = {}): EvalSuiteRunRow {
  runSeq += 1;
  return {
    id: `run-${runSeq}`,
    workspaceId: 'ws-1',
    agentId: 'agent-1',
    state: 'completed',
    startedAt: new Date(`2026-08-2${runSeq}T00:00:00.000Z`),
    finishedAt: new Date(`2026-08-2${runSeq}T00:05:00.000Z`),
    systemPrompt: 'You review PRs.',
    provider: 'openai',
    model: 'gpt-4.1',
    strategy: 'single-pass',
    skills: [],
    capturedContext: { documents: [], excluded: [] },
    casesTotal: 2,
    casesDone: 2,
    passedCount: 2,
    erroredCount: 0,
    recall: 0.8,
    precision: 0.9,
    citationAccuracy: 0.95,
    costUsd: 0.1,
    durationMs: 5000,
    ...overrides,
  } as EvalSuiteRunRow;
}

let caseSeq = 0;
function mkCaseRow(overrides: Partial<EvalCaseRow> = {}): EvalCaseRow {
  caseSeq += 1;
  return {
    id: `case-${caseSeq}`,
    workspaceId: 'ws-1',
    ownerKind: 'agent',
    ownerId: 'agent-1',
    name: `Case ${caseSeq}`,
    inputDiff: 'diff --git a/src/x.ts b/src/x.ts',
    expectedOutput: [mkExpectation()],
    notes: null,
    repoId: null,
    originFindingId: null,
    originPrId: null,
    originFindingTitle: null,
    originPrNumber: null,
    createdAt: new Date('2026-08-22T00:00:00.000Z'),
    updatedAt: new Date('2026-08-22T00:00:00.000Z'),
    ...overrides,
  };
}

describe('runMetricsFrom (AC-15..AC-18, AC-29)', () => {
  it('an all-passing mixed set (must_find + must_not_flag) scores recall/precision/citation at 1', () => {
    const mustFindA = mkResultRow({
      status: 'passed',
      caseExpectations: [mkExpectation({ kind: 'must_find', file: 'a.ts', start_line: 10, end_line: 10 })],
      findings: [mkFinding({ file: 'a.ts', start_line: 10, end_line: 10 })],
      rawFindingsCount: 1,
    });
    const mustFindB = mkResultRow({
      status: 'passed',
      caseExpectations: [mkExpectation({ kind: 'must_find', file: 'b.ts', start_line: 5, end_line: 5 })],
      findings: [mkFinding({ file: 'b.ts', start_line: 5, end_line: 5 })],
      rawFindingsCount: 1,
    });
    const mustNotFlagC = mkResultRow({
      status: 'passed',
      caseExpectations: [mkExpectation({ kind: 'must_not_flag', file: 'c.ts', start_line: 1, end_line: 1 })],
      findings: [],
      rawFindingsCount: 0,
    });

    const metrics = runMetricsFrom([mustFindA, mustFindB, mustNotFlagC]);
    expect(metrics).toEqual({ recall: 1, precision: 1, citation_accuracy: 1, passed: 3, total: 3 });
  });

  it('a run with no must_find case reports recall 1 (the "no must_find cases" convention, not a false positive)', () => {
    const onlyMustNotFlag = mkResultRow({
      status: 'passed',
      caseExpectations: [mkExpectation({ kind: 'must_not_flag' })],
      findings: [],
      rawFindingsCount: 0,
    });
    const metrics = runMetricsFrom([onlyMustNotFlag]);
    expect(metrics).not.toBeNull();
    expect(metrics!.recall).toBe(1);
  });

  it('a run with zero grounded findings reports precision 1, citation 1, and recall 0 (unmet must_find, not "perfect")', () => {
    const missedMustFind = mkResultRow({
      status: 'failed',
      caseExpectations: [mkExpectation({ kind: 'must_find', file: 'a.ts', start_line: 10, end_line: 10 })],
      findings: [],
      rawFindingsCount: 0,
    });
    const metrics = runMetricsFrom([missedMustFind]);
    expect(metrics).toEqual({ recall: 0, precision: 1, citation_accuracy: 1, passed: 0, total: 1 });
  });

  it('a run where one must_find case errored keeps it in the recall denominator, never passed, and contributes no findings to precision/citation', () => {
    const errored = mkResultRow({
      status: 'errored',
      caseExpectations: [mkExpectation({ kind: 'must_find', file: 'a.ts', start_line: 10, end_line: 10 })],
      // Deliberately non-empty — runMetricsFrom must not read `findings` for an
      // errored row at all (it branches on `status === 'errored'` before ever
      // looking at grounded output).
      findings: [mkFinding({ file: 'a.ts', start_line: 10, end_line: 10 })],
      rawFindingsCount: 1,
    });
    const passed = mkResultRow({
      status: 'passed',
      caseExpectations: [mkExpectation({ kind: 'must_find', file: 'b.ts', start_line: 5, end_line: 5 })],
      findings: [mkFinding({ file: 'b.ts', start_line: 5, end_line: 5 })],
      rawFindingsCount: 1,
    });

    const metrics = runMetricsFrom([errored, passed]);
    expect(metrics).not.toBeNull();
    // Denominator unchanged: both must_find cases count, only the non-errored
    // one can be a numerator hit.
    expect(metrics!.recall).toBe(0.5);
    expect(metrics!.passed).toBe(1);
    expect(metrics!.total).toBe(2);
    // The errored row's findings/rawFindingsCount never entered the sums —
    // precision/citation are both 1 (denominator 1, numerator 1) from the
    // PASSED case alone, not diluted or inflated by the errored one.
    expect(metrics!.precision).toBe(1);
    expect(metrics!.citation_accuracy).toBe(1);
  });

  it('a run where every case errored returns null — a run with NO metrics, not all-zero metrics', () => {
    const a = mkResultRow({ status: 'errored' });
    const b = mkResultRow({ status: 'errored' });
    expect(runMetricsFrom([a, b])).toBeNull();
  });

  it('an empty result set also returns null', () => {
    expect(runMetricsFrom([])).toBeNull();
  });
});

describe('metricDelta (AC-38)', () => {
  it('the earliest completed run has no predecessor: returns null, not an all-zero delta object', () => {
    const later = mkRunRow({ recall: 0.5, precision: 0.5, citationAccuracy: 0.5, costUsd: 1 });
    expect(metricDelta(later, null)).toBeNull();
  });

  it('a later run against an earlier one: per-metric numeric difference, null where either side is null', () => {
    // Every value below is an exact power-of-two fraction (0.25/0.5/0.75) so
    // the subtraction is exact in IEEE 754 — no float-rounding noise to mask.
    const earlier = mkRunRow({ recall: 0.25, precision: 0.75, citationAccuracy: 0.5, costUsd: 0.25 });
    const later = mkRunRow({ recall: 0.75, precision: 0.25, citationAccuracy: 0.5, costUsd: null });

    const delta = metricDelta(later, earlier);
    expect(delta).toEqual({
      recall: 0.5, // 0.75 - 0.25
      precision: -0.5, // 0.25 - 0.75
      citation_accuracy: 0, // 0.5 - 0.5
      // later.costUsd is null → the whole metric is null, not `0 - 0.25`.
      cost_usd: null,
    });
  });
});

describe('caseRowToDto — resolves_context (AC-50)', () => {
  it('is always false — content-only evals never resolve project context', () => {
    expect(caseRowToDto(mkCaseRow({ repoId: 'repo-1' }), 'acme/payments-api', null).resolves_context).toBe(
      false,
    );
    expect(caseRowToDto(mkCaseRow({ repoId: null }), null, null).resolves_context).toBe(false);
  });
});
