import type { EvalExpectationKind } from '@devdigest/shared';
import { HUNK_HEADER_RE } from './constants.js';

/**
 * Pure ring-2 helpers for the eval module: cutting a stored diff fragment
 * from a `pr_files.patch`, and deriving the expectation kind from a finding's
 * decision. No DB, LLM, or Fastify imports (`onion-architecture` — "Ring 2 has
 * no technology imports").
 *
 * SPEC-04 retires AC-11's overlap rejection with nothing replacing it — a
 * case now carries exactly one expectation, so two of differing type can
 * never coexist in one case. The overlap-pair finder this module used to
 * export is gone; `rangesOverlap` stays — it's still the range-intersection
 * primitive `matchesExpectation` uses.
 */

interface PatchHunk {
  newStart: number;
  newLines: number;
  lines: string[];
}

/**
 * Normalise a finding-derived line range so the lower bound is always
 * `min(start, end)` and the upper is always `max(start, end)`. A finding's
 * own `start_line`/`end_line` is a model artefact and is occasionally
 * inverted (observed: `eval_case_expectations_end_line_check` violations —
 * roughly 1 in 20 findings in this workspace). Every caller that persists or
 * searches a range derived from a finding must normalise through this first.
 */
export function normalizeRange(start: number, end: number): { start: number; end: number } {
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

/**
 * Cut the fragment of `patch` covering `[startLine, endLine]` on the new
 * side, keeping every intersecting hunk WHOLE (with its own context lines —
 * never re-sliced line-by-line). Prepends the same three `diff --git`/
 * `---`/`+++` header lines `diffFromPrFiles` prepends
 * (`modules/reviews/diff-loader.ts:38-41`) so the result re-parses through
 * `parseUnifiedDiff`. Returns `null` when the patch is empty/absent or no
 * hunk intersects the requested range. `startLine`/`endLine` are normalised
 * internally so an inverted range (a finding artefact) still searches
 * correctly.
 */
export function cutFragment(
  path: string,
  patch: string,
  startLine: number,
  endLine: number,
): string | null {
  if (!patch || patch.trim().length === 0) return null;
  const range = normalizeRange(startLine, endLine);
  startLine = range.start;
  endLine = range.end;

  const lines = patch.split('\n');
  const hunks: PatchHunk[] = [];
  let current: PatchHunk | null = null;

  for (const line of lines) {
    const m = line.match(HUNK_HEADER_RE);
    if (m) {
      current = {
        newStart: Number(m[3]),
        newLines: m[4] !== undefined ? Number(m[4]) : 1,
        lines: [line],
      };
      hunks.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }

  const kept = hunks.filter((h) => {
    const hunkEnd = h.newStart + Math.max(h.newLines, 1) - 1;
    return rangesOverlap(h.newStart, hunkEnd, startLine, endLine);
  });
  if (kept.length === 0) return null;

  const header = [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`];
  return [...header, ...kept.flatMap((h) => h.lines)].join('\n');
}

/**
 * The expectation kind a new eval case is derived to, from the finding's own
 * decision (AC-40, AC-41). `null` when the finding has neither been accepted
 * nor dismissed — the caller refuses the create in that case, since there is
 * no defensible type to give it. Accepted takes precedence over dismissed in
 * the (should-not-happen) case both are set.
 *
 * Renamed from `defaultExpectationKind`: "default" describes a pre-selection
 * the user may override, which is exactly what AC-40 forbids — the type is
 * derived, never offered as a default to change.
 */
export function expectationKindFor(f: {
  acceptedAt: Date | null;
  dismissedAt: Date | null;
}): EvalExpectationKind | null {
  if (f.acceptedAt) return 'must_find';
  if (f.dismissedAt) return 'must_not_flag';
  return null;
}

/** Inclusive-range overlap check — the primitive `matchesExpectation` uses. */
export function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}
