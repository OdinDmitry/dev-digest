/** Constants for the conventions module. */

/** Top-ranked code files sampled alongside the config files (repoIntel.getConventionSamples). */
export const CODE_SAMPLE_FILE_COUNT = 12;

/** Root config filenames sampled verbatim, in addition to the ranked code files. */
export const CONFIG_SAMPLE_FILES: readonly string[] = [
  '.eslintrc.json',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.ts',
  'tsconfig.json',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.js',
  '.prettierrc.cjs',
  'prettier.config.js',
  'prettier.config.mjs',
];

/** Longest single sampled file rendered into the prompt, in lines. */
export const MAX_SAMPLE_LINES_PER_FILE = 200;

/** Longest single rendered line before truncation (very long minified/data lines). */
export const MAX_SAMPLE_LINE_CHARS = 300;

/** Cap on how many candidates the model may propose in one extraction call. */
export const MAX_CANDIDATES = 20;

/** Structured-output schema name for the extraction call. */
export const EXTRACTION_SCHEMA_NAME = 'ConventionExtraction';

export const EXTRACTION_SYSTEM_PROMPT = `You are analyzing a codebase to find its house coding conventions —
patterns the codebase actually follows consistently, not generic best
practices. You will be shown config files (eslint/tsconfig/prettier) and a
sample of source files, each rendered with a line number before every line
(format "  12: <code>").

For each convention you find, cite the EXACT file and the EXACT line range
where you observed it — copy the line numbers shown in the sample verbatim,
never estimate or invent them. A convention with evidence you cannot point to
a real line for is worthless; skip it instead of guessing.

Return between 3 and ${MAX_CANDIDATES} candidates. For each:
- category: a short label, e.g. "naming", "error-handling", "structure", "imports", "testing"
- rule: one directive sentence a code reviewer could enforce, e.g. "Always use async/await instead of .then() chains"
- evidence.file: the exact sampled file path
- evidence.start_line / evidence.end_line: the exact line numbers shown in the sample that demonstrate the rule
- evidence.snippet: the code at those lines, copied verbatim (no added commentary)
- confidence: 0..1, how consistently this pattern recurs across the sample (not how good the practice is in the abstract)

Only report conventions you can back with real evidence from the sample. Do
not report anything about files you were not shown.`;
