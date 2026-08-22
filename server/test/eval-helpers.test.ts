/**
 * T25 / D25 — hermetic unit tests for the pure ring-2 helpers in
 * `modules/eval/helpers.ts`: `cutFragment` (AC-5) and `expectationKindFor`
 * (AC-41, renamed from `defaultExpectationKind` — "default" describes a
 * pre-selection the user may override, which is exactly what AC-40 forbids).
 *
 * SPEC-04 delta: `findOverlap` (AC-11's overlap rejection) is retired with
 * nothing replacing it — a case now carries exactly one expectation, so two
 * of differing type can never coexist. `eval_find_overlap_reports_the_two_ranges`
 * is deleted, not rewritten (D23; plan's Retirement traceability table,
 * retired SPEC-03 AC-11) — its `expectation()` fixture helper went with it,
 * since nothing else in this file used it.
 */
import { describe, it, expect } from 'vitest';
import { cutFragment, expectationKindFor, normalizeRange } from '../src/modules/eval/helpers.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';

const PATH = 'src/config.ts';

/**
 * Two independent hunks on the same file (the `pr_files.patch` shape: no
 * `diff --git`/`---`/`+++` headers, just `@@ … @@` + body, mirroring
 * `db/seed.ts`'s CONFIG_TS_PATCH/USERS_TS_PATCH fixtures).
 *
 * Hunk 1: `@@ -8,4 +8,6 @@` → new-side range [8, 13].
 * Hunk 2: `@@ -40,3 +42,5 @@` → new-side range [42, 46].
 */
const TWO_HUNK_PATCH = [
  '@@ -8,4 +8,6 @@',
  ' function configure() {',
  '   const x = 1;',
  '+  const y = 2;',
  '+  const z = 3;',
  '   return x;',
  ' }',
  '@@ -40,3 +42,5 @@',
  ' function teardown() {',
  '-  cleanupOld();',
  '+  cleanupNew();',
  '+  logCleanup();',
  '   return true;',
  ' }',
].join('\n');

describe('eval_cut_fragment_keeps_whole_intersecting_hunks', () => {
  it('eval_cut_fragment_keeps_whole_intersecting_hunks', () => {
    // Range intersecting ONLY hunk 1 keeps hunk 1 whole (with its context
    // lines) and drops hunk 2 entirely.
    const onlyHunk1 = cutFragment(PATH, TWO_HUNK_PATCH, 9, 10);
    expect(onlyHunk1).not.toBeNull();
    expect(onlyHunk1).toContain('const y = 2;');
    expect(onlyHunk1).toContain('const x = 1;'); // context line, kept whole
    expect(onlyHunk1).not.toContain('cleanupNew');

    // The three header lines diffFromPrFiles prepends, so the fragment
    // re-parses through parseUnifiedDiff.
    expect(onlyHunk1).toContain(`diff --git a/${PATH} b/${PATH}`);
    expect(onlyHunk1).toContain(`--- a/${PATH}`);
    expect(onlyHunk1).toContain(`+++ b/${PATH}`);

    const reparsed = parseUnifiedDiff(onlyHunk1!);
    expect(reparsed.files).toHaveLength(1);
    expect(reparsed.files[0]!.path).toBe(PATH);
    expect(reparsed.files[0]!.hunks).toHaveLength(1);
    // The WHOLE hunk's new-side lines are present, not just the requested
    // sub-range — proves hunks are kept whole, never re-sliced line-by-line.
    expect(reparsed.files[0]!.hunks[0]!.newLineNumbers).toEqual([8, 9, 10, 11, 12, 13]);

    // Range intersecting ONLY hunk 2 keeps hunk 2 and drops hunk 1.
    const onlyHunk2 = cutFragment(PATH, TWO_HUNK_PATCH, 44, 45);
    expect(onlyHunk2).not.toBeNull();
    expect(onlyHunk2).toContain('cleanupNew');
    expect(onlyHunk2).not.toContain('const y = 2;');

    // A range spanning both hunks' new-side ranges keeps BOTH, whole.
    const spansBoth = cutFragment(PATH, TWO_HUNK_PATCH, 12, 43);
    expect(spansBoth).not.toBeNull();
    expect(spansBoth).toContain('const y = 2;');
    expect(spansBoth).toContain('cleanupNew');
    const reparsedBoth = parseUnifiedDiff(spansBoth!);
    expect(reparsedBoth.files[0]!.hunks).toHaveLength(2);

    // A range outside every hunk → null.
    expect(cutFragment(PATH, TWO_HUNK_PATCH, 100, 101)).toBeNull();

    // An empty/whitespace-only patch → null.
    expect(cutFragment(PATH, '', 1, 10)).toBeNull();
    expect(cutFragment(PATH, '   \n  ', 1, 10)).toBeNull();
  });
});

describe('eval_normalize_range_orders_inverted_bounds', () => {
  it('eval_normalize_range_orders_inverted_bounds', () => {
    // The reproducing shape from a real finding (server/insights.md
    // 2026-08-21): start_line=130, end_line=123 — normalize must swap them.
    expect(normalizeRange(130, 123)).toEqual({ start: 123, end: 130 });
    // An already-ordered pair passes through unchanged.
    expect(normalizeRange(5, 10)).toEqual({ start: 5, end: 10 });
    // Equal bounds are their own normalized form.
    expect(normalizeRange(7, 7)).toEqual({ start: 7, end: 7 });
  });
});

describe('eval_cut_fragment_normalizes_an_inverted_range', () => {
  it('eval_cut_fragment_normalizes_an_inverted_range', () => {
    // One hunk on the new side covering [125, 140] — strictly inside the
    // real (normalized) requested range [123, 130] is NOT true here; rather
    // the hunk only overlaps the LOWER end of the true range. Passing the
    // start/end through un-normalized would compute the overlap check
    // against the reversed pair (130, 123) — `125 <= 123` is false, so the
    // hunk would be wrongly dropped and `cutFragment` would return `null`.
    const invertedHunkPatch = [
      '@@ -119,20 +125,16 @@',
      ' function reviewCandidate() {',
      "+  const marker = 'inverted-range-hunk';",
      '   return true;',
      ' }',
    ].join('\n');

    // Called with start=130, end=123 — the exact inverted shape a finding
    // can carry (AC: start_line=130, end_line=123 reproduction).
    const fragment = cutFragment(PATH, invertedHunkPatch, 130, 123);
    expect(fragment).not.toBeNull();
    expect(fragment).toContain('inverted-range-hunk');

    const reparsed = parseUnifiedDiff(fragment!);
    expect(reparsed.files[0]!.hunks).toHaveLength(1);
    expect(reparsed.files[0]!.hunks[0]!.newLineNumbers[0]).toBe(125);
  });
});

describe('eval_expectation_kind_is_derived_from_the_decision', () => {
  it('eval_expectation_kind_is_derived_from_the_decision', () => {
    expect(expectationKindFor({ acceptedAt: new Date(), dismissedAt: null })).toBe('must_find');
    expect(expectationKindFor({ acceptedAt: null, dismissedAt: new Date() })).toBe(
      'must_not_flag',
    );
    expect(expectationKindFor({ acceptedAt: null, dismissedAt: null })).toBeNull();
  });
});
