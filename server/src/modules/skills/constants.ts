/** Constants for the skills module. */

/** Initial body version recorded for a newly-created skill. */
export const INITIAL_SKILL_VERSION = 1;

/** Longest skill name we derive from an upload before truncating. */
export const NAME_MAX_LEN = 80;

/**
 * Every upload gets `source: 'imported_url'`. The enum's other values are taken:
 * `manual` = typed in the studio, `extracted` = mined from this repo's own code
 * (conventions lesson), `community` = pulled from the curated catalog. An upload
 * is "arrived as an external artifact", which is what `imported_url` covers —
 * the shipped i18n already labels it generically ("Imported"), so file and zip
 * uploads share it rather than forking a shared contract for a fifth value.
 */
export const IMPORTED_SKILL_SOURCE = 'imported_url' as const;

/**
 * Imported skills are created disabled. The import preview is the vetting step —
 * it shows the full body and everything that was skipped — but a foreign skill
 * becomes literal instructions in the agent's prompt once linked, so enabling it
 * stays an explicit, separate act by the user.
 */
export const IMPORTED_SKILL_ENABLED = false;

// ---- Import limits -------------------------------------------------------
// An uploaded archive is untrusted input, so every dimension is bounded: a zip
// bomb, a 10k-entry archive and a single 50 MB "markdown" file all get refused
// rather than inflated into memory.

/** Largest single archive member we will decompress and keep. */
export const MAX_ENTRY_BYTES = 256 * 1024;

/** Total kept (decompressed) bytes across all members of one archive. */
export const MAX_TOTAL_BYTES = 512 * 1024;

/** Most archive members we will even look at. */
export const MAX_ENTRIES = 200;

/** Longest base64 payload accepted for an upload (~1 MB of raw zip). */
export const MAX_UPLOAD_BASE64_CHARS = 1_400_000;

/** Route-level body limit for the import routes; the app-wide default is 1 MiB. */
export const IMPORT_BODY_LIMIT_BYTES = 2 * 1024 * 1024;

/**
 * Extensions we refuse to read. Matched on the zip's central directory, so these
 * members are never decompressed — the product's promise is that executable
 * parts of an archive are not processed, not merely that they are not run.
 */
export const EXECUTABLE_EXTS: readonly string[] = [
  '.sh', '.bash', '.zsh', '.bat', '.cmd', '.ps1', '.py', '.rb', '.pl',
  '.js', '.mjs', '.cjs', '.ts', '.exe', '.dll', '.so', '.dylib', '.bin',
];

/** Path segments whose contents are treated as executable regardless of extension. */
export const EXECUTABLE_DIRS: readonly string[] = ['bin', 'scripts'];

/** Archive members we are willing to decompress. */
export const TEXT_EXTS: readonly string[] = ['.md', '.markdown', '.txt'];

/** Members eligible to supply the skill body. */
export const MARKDOWN_EXTS: readonly string[] = ['.md', '.markdown'];

/** Preferred body filename inside an archive (matched case-insensitively). */
export const CORE_FILENAME = 'skill.md';

/** Keyword → skill type, used when an upload declares no type of its own. */
export const TYPE_PATTERNS: ReadonlyArray<readonly [RegExp, 'security' | 'convention' | 'rubric']> =
  [
    [/\b(security|secret|injection|ssrf|xss|csrf|auth|vulnerab)/i, 'security'],
    [/\b(convention|style|naming|lint|format|prefer|avoid)/i, 'convention'],
    [/\b(rubric|checklist|score|criteria|grade|review)/i, 'rubric'],
  ];
