/**
 * modules/context constants — Project Context (browse/preview/attach).
 * See docs/specs/cross/SPEC-01-project-context.md, Non-functional requirements.
 */

/** Discoverable document extensions (lower-cased). */
export const MARKDOWN_EXT = ['.md', '.markdown'] as const;

/** Maximum document size (spec NFR). Larger files are excluded outright. */
export const MAX_DOCUMENT_BYTES = 256 * 1024;

/** Discovery limit per repository (spec NFR). */
export const DISCOVERY_LIMIT = 2000;

/** Project-context token budget per run (spec NFR). */
export const PROJECT_CONTEXT_TOKEN_BUDGET = 20_000;

/** Bounded concurrency for reading + counting discovered documents. */
export const READ_CONCURRENCY = 16;

/** Cap on the in-memory token-count cache in ContextService (evict oldest on overflow). */
export const TOKEN_CACHE_MAX = 20_000;

/**
 * Directories never walked. This is `modules/context`'s OWN copy of the same
 * list in `modules/repo-intel/constants.ts` — not shared, deliberately: the
 * two scans have independent lifecycles (repo-intel's code walk vs this
 * markdown walk) and could diverge in extensions/exclusions over time without
 * either one having to consider the other.
 */
export const EXCLUDED_DIRS = [
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  'out',
  'vendor',
  '.git',
] as const;
