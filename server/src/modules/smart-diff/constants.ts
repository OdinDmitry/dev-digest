import type { SmartDiffRole } from '@devdigest/shared';

/**
 * Every classification pattern and threshold for the Smart Diff module lives
 * here — `classify.ts` and `split.ts` contain no literal path fragments and
 * no magic numbers of their own; they only reference these exports.
 *
 * Matching is always against the POSIX path as stored in `pr_files.path`,
 * LOWER-CASED first (see `classify.ts`) — never against patch text.
 * Precedence: `BOILERPLATE_PATTERNS` is checked first, then
 * `WIRING_PATTERNS`; `core` is the default when neither matches.
 */

// ---- Group ordering ---------------------------------------------------

export const ROLE_ORDER: SmartDiffRole[] = ['core', 'wiring', 'boilerplate'];

// ---- Boilerplate (checked FIRST) --------------------------------------
//
// Lockfiles, build output, minified/compiled assets, generated code and
// snapshots. Acceptance criterion: lockfiles are `boilerplate`, ALWAYS —
// this must win over any wiring pattern (e.g. `dist/index.ts` must NOT
// match the wiring "bare barrel" `index.ts` rule; boilerplate wins because
// it is checked first).
export const BOILERPLATE_PATTERNS: RegExp[] = [
  // Lockfiles (every common package manager)
  /(^|\/)package-lock\.json$/,
  /(^|\/)npm-shrinkwrap\.json$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)bun\.lockb$/,
  /(^|\/)cargo\.lock$/,
  /(^|\/)poetry\.lock$/,
  /(^|\/)uv\.lock$/,
  /(^|\/)gemfile\.lock$/,
  /(^|\/)composer\.lock$/,
  /(^|\/)go\.sum$/,

  // Build output directories, at any depth
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)out\//,
  /(^|\/)\.next\//,
  /(^|\/)coverage\//,
  /(^|\/)vendor\//,
  /(^|\/)node_modules\//,

  // Minified / compiled assets
  /\.min\.js$/,
  /\.min\.css$/,
  /\.map$/,

  // Generated code / snapshots
  /(^|\/)__snapshots__\//,
  /\.snap$/,
  /\.generated\./,
  /\.gen\./,
  /_pb\./,
  /\.pb\.go$/,
  /(^|\/)generated\//,
];

// ---- Wiring (checked SECOND) -------------------------------------------
//
// Config, tooling, CI, dotfiles, bare barrels, type declarations, i18n
// bundles and documentation — plumbing a reviewer skims rather than reads
// line-by-line, but not throwaway output like `BOILERPLATE_PATTERNS`.
export const WIRING_PATTERNS: RegExp[] = [
  /(^|\/)package\.json$/,
  /(^|\/)tsconfig[^/]*\.json$/,
  /\.config\.(ts|js|mjs|cjs|json)$/,
  /(^|\/)config\.(ts|js|json)$/,
  /(^|\/)config\//,
  /(^|\/)\.github\/workflows\//,
  /(^|\/)dockerfile[^/]*$/,
  /(^|\/)docker-compose[^/]*$/,
  /(^|\/)\.env[^/]*$/,
  /(^|\/)\.eslintrc[^/]*$/,
  /(^|\/)\.prettierrc[^/]*$/,
  /(^|\/)\.gitignore$/,
  /(^|\/)\.npmrc$/,
  // Bare barrels — a file's only content is re-exports
  /(^|\/)index\.(ts|js|tsx)$/,
  /\.d\.ts$/,
  // i18n message bundles
  /(^|\/)messages\/.*\.json$/,
  // Documentation
  /\.mdx?$/,
  /(^|\/)docs\//,
];

// Deliberate: test files stay `core`, NOT `wiring`/`boilerplate` — a test
// change is often the change under review, so it must surface alongside the
// business logic it covers rather than being buried in a skimmed group.
// Their *snapshots* are still `boilerplate` (covered above by `.snap` /
// `__snapshots__/`), since a snapshot file itself carries no reviewable logic.

// ---- Split suggestion (deterministic) -----------------------------------

/** Total changed lines (additions + deletions) across a PR above which a
 *  split is suggested. = client `SIZE_MEDIUM_MAX` ("L" bucket) — this is a
 *  PER-PR threshold, not to be confused with `LARGE_FILE_LINES` (the client's
 *  PER-FILE threshold, deliberately a separate constant — see §9 of the plan). */
export const SPLIT_TOO_BIG_LINES = 400;

/** Maximum number of named split buckets before the remainder is merged. */
export const SPLIT_MAX_PROPOSALS = 4;

/** Name of the bucket that absorbs every split proposal past `SPLIT_MAX_PROPOSALS`. */
export const SPLIT_REMAINDER_NAME = 'Everything else';

/** Bucket name for files with no directory segment (root-level files). */
export const ROOT_BUCKET_NAME = '(root)';
