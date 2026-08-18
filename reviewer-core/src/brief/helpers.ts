/**
 * Pure helpers for the brief module — no I/O.
 *
 * `fallback` (`BriefInput.fallbackWhat`) is built deterministically server-side
 * (`modules/brief/input.ts`, T13) from the PR's change statistics, so it does
 * not depend on the model's output and — in every realistic case — differs
 * from an arbitrary PR title.
 */

/** Case/whitespace-insensitive normalization used to detect a `what` (or a
 *  fallback) that is really just the PR title restated. */
function normalizeForTitleCompare(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * AC-2 post-condition: the returned `what` can never equal the PR title
 * (case/whitespace-insensitive), with NO second model call. If the model's
 * `what` restates the title, substitute the deterministic `fallback`. In the
 * pathological case where `fallback` *also* normalises equal to the title,
 * append a fixed, title-independent marker so the returned value is
 * guaranteed to differ — this file has no access to file/path data (the
 * frozen 3-arg signature), so the marker cannot itself be a changed-file
 * path; that data, if wanted, belongs in how `fallback` itself is built
 * upstream (`modules/brief/input.ts`), not here.
 */
export function enforceNotTitle(what: string, title: string, fallback: string): string {
  const normTitle = normalizeForTitleCompare(title);
  if (normalizeForTitleCompare(what) !== normTitle) return what;
  if (normalizeForTitleCompare(fallback) !== normTitle) return fallback;
  return `${fallback} (summary distinct from the PR title)`;
}
