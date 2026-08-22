import { describe, it, expect } from 'vitest';
import type { EvalExpectation } from '@devdigest/shared';
import type { EvalCaseResultRow, EvalSuiteRunRow } from '../src/modules/evals/repository/index.js';
import { diffPromptLines, buildComparison, mergeCapturedContext } from '../src/modules/evals/helpers.js';

/**
 * Hermetic unit tests over `modules/evals/helpers.ts`'s comparison surface
 * (`docs/plans/2026-08-22-eval-pipeline-b-suite-runs.md` T16). Covers AC-40,
 * AC-41, AC-42, AC-53, AC-54.
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
    systemPrompt: 'line 1\nline 2\nline 3',
    provider: 'openai',
    model: 'gpt-4.1',
    strategy: 'single-pass',
    skills: [],
    capturedContext: { documents: [], excluded: [] },
    casesTotal: 1,
    casesDone: 1,
    passedCount: 1,
    erroredCount: 0,
    recall: 0.5,
    precision: 0.5,
    citationAccuracy: 0.5,
    costUsd: 0.1,
    durationMs: 5000,
    ...overrides,
  } as EvalSuiteRunRow;
}

describe('diffPromptLines (AC-41)', () => {
  it('identical prompts produce only `same` lines', () => {
    const out = diffPromptLines('a\nb\nc', 'a\nb\nc');
    expect(out).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'same', text: 'b' },
      { kind: 'same', text: 'c' },
    ]);
  });

  it('one added line', () => {
    const out = diffPromptLines('a\nb', 'a\nb\nc');
    expect(out).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'same', text: 'b' },
      { kind: 'added', text: 'c' },
    ]);
  });

  it('one removed line', () => {
    const out = diffPromptLines('a\nb\nc', 'a\nc');
    expect(out).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'same', text: 'c' },
    ]);
  });

  it('one replaced line (a removed run immediately followed by an added run)', () => {
    const out = diffPromptLines('a\nb\nc', 'a\nB\nc');
    expect(out).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'B' },
      { kind: 'same', text: 'c' },
    ]);
  });
});

describe('buildComparison (AC-40, AC-42, AC-54)', () => {
  it('reorders its inputs earlier-first by started_at regardless of the ARGUMENT order', () => {
    const older = mkRunRow({ startedAt: new Date('2026-08-01T00:00:00.000Z'), recall: 0.4 });
    const newer = mkRunRow({ startedAt: new Date('2026-08-10T00:00:00.000Z'), recall: 0.9 });
    const oldResults = [mkResultRow({ caseId: 'case-a' })];
    const newResults = [mkResultRow({ caseId: 'case-a' })];

    // Called (newer, older) — the OPPOSITE of their chronological order.
    const cmp = buildComparison(newer, older, newResults, oldResults);

    expect(cmp.earlier.id).toBe(older.id);
    expect(cmp.later.id).toBe(newer.id);
    // Same comparison called the other way round produces an identical result.
    const cmp2 = buildComparison(older, newer, oldResults, newResults);
    expect(cmp2).toEqual(cmp);
  });

  it('carries all four metric pairs, each with earlier/later/delta', () => {
    const earlier = mkRunRow({
      startedAt: new Date('2026-08-01T00:00:00.000Z'),
      recall: 0.25,
      precision: 0.5,
      citationAccuracy: 0.75,
      costUsd: 0.1,
    });
    const later = mkRunRow({
      startedAt: new Date('2026-08-10T00:00:00.000Z'),
      recall: 0.75,
      precision: 0.5,
      citationAccuracy: 0.25,
      costUsd: 0.2,
    });
    const cmp = buildComparison(earlier, later, [], []);

    const byKey = new Map(cmp.metrics.map((m) => [m.key, m]));
    expect(byKey.get('recall')).toEqual({ key: 'recall', earlier: 0.25, later: 0.75, delta: 0.5 });
    expect(byKey.get('precision')).toEqual({ key: 'precision', earlier: 0.5, later: 0.5, delta: 0 });
    expect(byKey.get('citation_accuracy')).toEqual({
      key: 'citation_accuracy',
      earlier: 0.75,
      later: 0.25,
      delta: -0.5,
    });
    expect(byKey.get('cost_usd')).toEqual({ key: 'cost_usd', earlier: 0.1, later: 0.2, delta: 0.1 });
  });

  it('case_sets_differ is false for identical case sets, true when they differ, and both counts are present', () => {
    const earlierRun = mkRunRow({ startedAt: new Date('2026-08-01T00:00:00.000Z') });
    const laterRun = mkRunRow({ startedAt: new Date('2026-08-10T00:00:00.000Z') });

    const sameA = [mkResultRow({ caseId: 'case-a' }), mkResultRow({ caseId: 'case-b' })];
    const sameB = [mkResultRow({ caseId: 'case-a' }), mkResultRow({ caseId: 'case-b' })];
    const identical = buildComparison(earlierRun, laterRun, sameA, sameB);
    expect(identical.case_sets_differ).toBe(false);
    expect(identical.earlier_case_count).toBe(2);
    expect(identical.later_case_count).toBe(2);

    const differentB = [mkResultRow({ caseId: 'case-a' }), mkResultRow({ caseId: 'case-c' })];
    const differing = buildComparison(earlierRun, laterRun, sameA, differentB);
    expect(differing.case_sets_differ).toBe(true);
    expect(differing.earlier_case_count).toBe(2);
    expect(differing.later_case_count).toBe(2);
  });

  it('context_differs is false for identical captures, true when a path is added, and true when a shared path\'s text changes', () => {
    const earlierRun = mkRunRow({
      startedAt: new Date('2026-08-01T00:00:00.000Z'),
      capturedContext: {
        documents: [{ repo_id: 'repo-1', path: 'README.md', text: 'hello' }],
        excluded: [],
      },
    });

    const sameContextLaterRun = mkRunRow({
      startedAt: new Date('2026-08-10T00:00:00.000Z'),
      capturedContext: {
        documents: [{ repo_id: 'repo-1', path: 'README.md', text: 'hello' }],
        excluded: [],
      },
    });
    expect(buildComparison(earlierRun, sameContextLaterRun, [], []).context_differs).toBe(false);

    const addedPathLaterRun = mkRunRow({
      startedAt: new Date('2026-08-10T00:00:00.000Z'),
      capturedContext: {
        documents: [
          { repo_id: 'repo-1', path: 'README.md', text: 'hello' },
          { repo_id: 'repo-1', path: 'docs/new.md', text: 'new doc' },
        ],
        excluded: [],
      },
    });
    expect(buildComparison(earlierRun, addedPathLaterRun, [], []).context_differs).toBe(true);

    const changedTextLaterRun = mkRunRow({
      startedAt: new Date('2026-08-10T00:00:00.000Z'),
      capturedContext: {
        documents: [{ repo_id: 'repo-1', path: 'README.md', text: 'hello, edited' }],
        excluded: [],
      },
    });
    expect(buildComparison(earlierRun, changedTextLaterRun, [], []).context_differs).toBe(true);
  });
});

describe('mergeCapturedContext (AC-53)', () => {
  it('dedups documents by contextKey (repo_id:path), keeping the FIRST occurrence\'s text', () => {
    const prev = { documents: [{ repo_id: 'repo-1', path: 'a.md', text: 'first' }], excluded: [] };
    const merged = mergeCapturedContext(prev, {
      documents: [
        { repo_id: 'repo-1', path: 'a.md', text: 'SECOND — must be discarded' },
        { repo_id: 'repo-1', path: 'b.md', text: 'new doc' },
      ],
      excluded: [],
    });
    expect(merged.documents).toEqual([
      { repo_id: 'repo-1', path: 'a.md', text: 'first' },
      { repo_id: 'repo-1', path: 'b.md', text: 'new doc' },
    ]);
  });

  it('the same path in two different repos is NOT deduped (repo-scoped key)', () => {
    const prev = { documents: [{ repo_id: 'repo-1', path: 'a.md', text: 'repo-1 text' }], excluded: [] };
    const merged = mergeCapturedContext(prev, {
      documents: [{ repo_id: 'repo-2', path: 'a.md', text: 'repo-2 text' }],
      excluded: [],
    });
    expect(merged.documents).toHaveLength(2);
  });

  it('dedups excluded entries by path+reason, also keeping first occurrence', () => {
    const prev = { documents: [], excluded: [{ path: 'x.md', reason: 'absent' }] };
    const merged = mergeCapturedContext(prev, {
      documents: [],
      excluded: [
        { path: 'x.md', reason: 'absent' }, // exact duplicate — dropped
        { path: 'x.md', reason: 'over_budget' }, // same path, different reason — kept
      ],
    });
    expect(merged.excluded).toEqual([
      { path: 'x.md', reason: 'absent' },
      { path: 'x.md', reason: 'over_budget' },
    ]);
  });
});
