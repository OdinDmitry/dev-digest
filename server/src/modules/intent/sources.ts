import type { DiffHunk, UnifiedDiff } from '@devdigest/shared';
import { MAX_FILES, MAX_HUNKS_PER_FILE, MAX_PR_BODY_CHARS } from './constants.js';

/**
 * Pure classifier-input assembly (ring 2, no I/O, no `Container`). This is the
 * file that makes the "no diff bodies" guarantee unit-testable: every renderer
 * here works off `path` + hunk header numbers only, never a `+`/`-`/context
 * line, and every cap (files/hunks/refs/chars) is enforced here or in
 * `references.ts`, not left to the model to self-limit.
 */

export type RefKind = 'issue' | 'path' | 'url';

/** A reference (linked issue / doc path / URL) that was read successfully. */
export interface ResolvedRef {
  kind: RefKind;
  /** '#123', 'docs/plan.md', or the URL — both a citation label and a sources-array entry. */
  label: string;
  /** Already truncated by the resolver (issue body / doc bytes / fetch cap). */
  text: string;
}

/** A reference that was mentioned but could not be read — NEVER fabricated content. */
export interface MissingRef {
  kind: RefKind;
  label: string;
  reason: string;
}

export interface FileHeaderRender {
  path: string;
  additions: number;
  deletions: number;
  /** e.g. "@@ -10,3 +10,4 @@" — header line only, never a diff content line. */
  hunkHeaders: string[];
}

function renderHunkHeader(h: DiffHunk): string {
  return `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`;
}

/** From an already-loaded (review-path) diff. */
export function hunkHeadersFromDiff(diff: UnifiedDiff): FileHeaderRender[] {
  return diff.files.slice(0, MAX_FILES).map((f) => ({
    path: f.path,
    additions: f.additions,
    deletions: f.deletions,
    hunkHeaders: f.hunks.slice(0, MAX_HUNKS_PER_FILE).map(renderHunkHeader),
  }));
}

/** Matches a raw unified-diff hunk header line, capturing ONLY the "@@ ... @@"
 *  portion — GitHub's `pr_files.patch` sometimes appends a trailing function/
 *  context hint after the second `@@` (e.g. "@@ -10,3 +10,4 @@ function foo()"),
 *  which is code content and must be dropped. */
const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/;

export interface PatchFile {
  path: string;
  additions: number;
  deletions: number;
  patch?: string | null;
}

/** From persisted `pr_files.patch` rows (no diff loaded yet). */
export function hunkHeadersFromPatches(files: PatchFile[]): FileHeaderRender[] {
  return files.slice(0, MAX_FILES).map((f) => {
    const hunkHeaders: string[] = [];
    for (const line of (f.patch ?? '').split('\n')) {
      const m = line.match(HUNK_HEADER_RE);
      if (m) hunkHeaders.push(m[0]);
      if (hunkHeaders.length >= MAX_HUNKS_PER_FILE) break;
    }
    return { path: f.path, additions: f.additions, deletions: f.deletions, hunkHeaders };
  });
}

export function renderFileHeaders(files: FileHeaderRender[]): string {
  return files
    .map((f) => [`${f.path} (+${f.additions}/-${f.deletions})`, ...f.hunkHeaders].join('\n'))
    .join('\n\n');
}

// ---- Reference extraction (regexes only — resolution happens in references.ts) ----

/** Mirrors `OctokitGitHubClient.resolveLinkedIssue`'s regex. */
const ISSUE_RE = /\b(?:closes|fixes|resolves)?\s*#(\d+)\b/gi;
const URL_RE = /\bhttps:\/\/[^\s)\]}>"'`]+/g;
/** A bare repo-relative doc path ending in an allowlisted extension. Runs
 *  AFTER urls are stripped from the working text so a URL's own path segment
 *  (e.g. ".../docs/plan.md") is never double-extracted as a bare path. */
const DOC_PATH_RE = /\b[\w][\w./-]*\.(?:md|mdx|txt)\b/gi;

export interface ExtractedRefs {
  issueNumbers: number[];
  docPaths: string[];
  urls: string[];
}

/** Extract candidate references from a PR body. Pure regex — no resolution,
 *  no I/O, no caps beyond de-duplication (references.ts caps how many are
 *  actually resolved). */
export function extractReferences(body: string | null | undefined): ExtractedRefs {
  const text = body ?? '';

  const urls = [...new Set([...text.matchAll(URL_RE)].map((m) => m[0]))];
  // Blank out URL spans before scanning for bare doc paths / issue numbers, so
  // a URL's own path segment or a "#section" fragment is never re-extracted.
  let withoutUrls = text;
  for (const url of urls) withoutUrls = withoutUrls.split(url).join(' '.repeat(url.length));

  const issueNumbers = [
    ...new Set(
      [...withoutUrls.matchAll(ISSUE_RE)].map((m) => Number(m[1])).filter((n) => Number.isFinite(n)),
    ),
  ];
  const docPaths = [...new Set([...withoutUrls.matchAll(DOC_PATH_RE)].map((m) => m[0]))];

  return { issueNumbers, docPaths, urls };
}

export interface ClassifierInputParams {
  title: string;
  body: string | null | undefined;
  fileHeaders: FileHeaderRender[];
  resolved: ResolvedRef[];
  missing: MissingRef[];
}

export interface ClassifierInput {
  /** The user-message text sent to the classifier. */
  userMessage: string;
  /** Deterministic, code-built source labels for observability (never model-reported). */
  sources: string[];
}

/** Assemble the classifier's user message + the deterministic `sources` log array. */
export function buildClassifierInput(params: ClassifierInputParams): ClassifierInput {
  const sources: string[] = ['title'];
  const sections: string[] = [`PR title: ${params.title}`];

  const body = (params.body ?? '').trim();
  if (body.length > 0) {
    sources.push('body');
    sections.push(`PR description:\n${body.slice(0, MAX_PR_BODY_CHARS)}`);
  } else {
    sections.push('PR description: (none provided)');
  }

  for (const ref of params.resolved) {
    sources.push(
      ref.kind === 'issue' ? `issue${ref.label}` : `${ref.kind}:${ref.label}`,
    );
    sections.push(`Referenced material — ${ref.kind} ${ref.label}:\n${ref.text}`);
  }

  if (params.missing.length > 0) {
    const lines = params.missing.map((m) => `- ${m.kind} ${m.label} — ${m.reason}`);
    sections.push(
      `The following references were mentioned but could NOT be read — do not invent their contents:\n${lines.join('\n')}`,
    );
  }

  sources.push(`files:${params.fileHeaders.length}`);
  sections.push(
    `Changed files (paths + hunk headers ONLY — no diff content):\n${renderFileHeaders(params.fileHeaders)}`,
  );

  return { userMessage: sections.join('\n\n'), sources };
}
