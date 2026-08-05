/** Constants for the intent module. */

// ---- Classifier input caps (sources.ts / references.ts) ----
/** Changed-files cap for the "hunk headers only" render. */
export const MAX_FILES = 200;
/** Hunk-header lines rendered per file. */
export const MAX_HUNKS_PER_FILE = 20;
/** At most this many doc-path refs AND this many URL refs resolved per PR. */
export const MAX_REFS_PER_KIND = 2;
/** Repo-file reference cap (risk 4). */
export const MAX_DOC_BYTES = 16 * 1024;
/** Linked-issue title+body cap fed to the classifier. */
export const MAX_ISSUE_BODY_CHARS = 2000;
/** PR description cap fed to the classifier (mirrors reviewer-core's PR-description cap). */
export const MAX_PR_BODY_CHARS = 4000;
/** Extension allowlist for repo-relative doc-path references (risk 4). */
export const DOC_EXTENSIONS = ['.md', '.mdx', '.txt'] as const;

// ---- Classifier schema ----
export const CLASSIFIER_SCHEMA_NAME = 'RawIntent';

export const CLASSIFIER_SYSTEM_PROMPT = `You are classifying the INTENT and SCOPE of a pull request, before it is reviewed for defects — this is NOT a code review.

You will be given: the PR title; its description (may be empty); any linked issue; any linked plan/spec document that could be read; a list of references that were mentioned but could NOT be read; and the list of changed files with their hunk headers ONLY (no diff content, no added/removed lines).

Derive the PR's intent and scope STRICTLY from the material you are given. Never invent, assume, or guess the contents of a reference listed as unreadable — treat it as if it were never mentioned. If the description is empty or the material is otherwise thin, say so plainly in the intent sentence rather than fabricating detail.

Return, and return ONLY:
- intent: one or two sentences, in your own words, stating what this PR is trying to accomplish and why.
- in_scope: short noun phrases (not full sentences) naming the areas/behaviors this PR is meant to touch.
- out_of_scope: short noun phrases naming adjacent areas the material indicates this PR explicitly does NOT touch (empty array if no boundary is evident — do not invent one).

Do not comment on code quality, correctness, or security — that is a separate step performed by a different reviewer. Do not return anything outside the requested schema.`;

// ---- Deterministic caveat prefixes (composed by the SERVER, never model-reported) ----
export const LOW_CONFIDENCE_PREFIX =
  'Low confidence — no PR description; inferred from the title, changed file paths and hunk headers only.';

export function missingRefCaveat(label: string): string {
  return `Referenced ${label} could not be read — its contents are NOT included.`;
}
