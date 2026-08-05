import { resolve as resolvePath, sep, extname } from 'node:path';
import { realpath, readFile } from 'node:fs/promises';
import type { GitHubClient, RepoRef, WebFetchClient } from '@devdigest/shared';
import type { ExtractedRefs, MissingRef, ResolvedRef } from './sources.js';
import {
  DOC_EXTENSIONS,
  MAX_DOC_BYTES,
  MAX_ISSUE_BODY_CHARS,
  MAX_REFS_PER_KIND,
} from './constants.js';

/**
 * Resolves the refs `sources.ts` extracted, through INJECTED collaborators
 * only — never a throw, every failure becomes a `MissingRef` (risk 5: no
 * silent fabrication). Two guarded resolution paths live here:
 *   - risk 4 (path traversal): a from-scratch guarded reader — deliberately
 *     NEVER calls `GitClient.readFile` (`adapters/git/simple-git.ts:129-131`),
 *     which does a bare `join(clonePath, path)` with no guard at all.
 *   - risk 3 (SSRF): delegated entirely to the injected `WebFetchClient` —
 *     this file does no network I/O of its own.
 */

export interface ReferenceResolverDeps {
  github: Pick<GitHubClient, 'getIssue'>;
  webfetch: WebFetchClient;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Reject a repo-file reference outright before ever touching the filesystem. */
function rejectedUpFront(relPath: string): string | null {
  if (relPath.startsWith('/') || relPath.startsWith('\\') || /^[a-zA-Z]:[\\/]/.test(relPath)) {
    return 'absolute path rejected';
  }
  if (relPath.split(/[\\/]/).some((seg) => seg === '..')) {
    return 'path traversal segment rejected';
  }
  const ext = extname(relPath).toLowerCase();
  if (!(DOC_EXTENSIONS as readonly string[]).includes(ext)) {
    return `extension "${ext || '(none)'}" not allowed`;
  }
  return null;
}

/** Truncate by WHOLE LINES (never mid-line) once the byte cap is reached. */
function truncateLinesByBytes(content: string, maxBytes: number): { text: string; truncated: boolean } {
  const lines = content.split('\n');
  let bytes = 0;
  const kept: string[] = [];
  for (const line of lines) {
    bytes += Buffer.byteLength(line, 'utf8') + 1;
    if (bytes > maxBytes) return { text: kept.join('\n'), truncated: true };
    kept.push(line);
  }
  return { text: kept.join('\n'), truncated: false };
}

/**
 * Guarded repo-file reader (risk 4). Rejects up front (absolute / `..`
 * segment / extension), THEN resolves symlinks on both the clone root and the
 * target and requires the target to stay inside the resolved clone root.
 * Returns a reason string on any rejection — never throws.
 */
async function readGuardedDoc(
  clonePath: string,
  relPath: string,
): Promise<{ text: string; truncated: boolean } | { error: string }> {
  const upFront = rejectedUpFront(relPath);
  if (upFront) return { error: upFront };

  let realClone: string;
  let target: string;
  try {
    realClone = await realpath(clonePath);
    const resolved = resolvePath(realClone, relPath);
    target = await realpath(resolved);
  } catch {
    return { error: 'path could not be resolved in the repo clone' };
  }
  if (target !== realClone && !target.startsWith(realClone + sep)) {
    return { error: 'resolved path escapes the repo clone' };
  }

  let content: string;
  try {
    content = await readFile(target, 'utf8');
  } catch {
    return { error: 'file not found in the repo clone' };
  }
  return truncateLinesByBytes(content, MAX_DOC_BYTES);
}

export async function resolveReferences(
  repo: RepoRef,
  extracted: ExtractedRefs,
  clonePath: string | null,
  deps: ReferenceResolverDeps,
): Promise<{ resolved: ResolvedRef[]; missing: MissingRef[] }> {
  const resolved: ResolvedRef[] = [];
  const missing: MissingRef[] = [];

  // ---- same-repo GitHub issue URL → routed to github.getIssue, not webfetch ----
  const sameRepoIssueUrlRe = new RegExp(
    `^https://github\\.com/${escapeRegExp(repo.owner)}/${escapeRegExp(repo.name)}/issues/(\\d+)/?$`,
    'i',
  );
  const urls: string[] = [];
  const urlIssueNumbers: number[] = [];
  for (const url of extracted.urls) {
    const m = url.match(sameRepoIssueUrlRe);
    if (m?.[1]) urlIssueNumbers.push(Number(m[1]));
    else urls.push(url);
  }

  // ---- linked issue (at most one — mirrors OctokitGitHubClient.resolveLinkedIssue) ----
  const issueNumber = extracted.issueNumbers[0] ?? urlIssueNumbers[0];
  if (issueNumber != null) {
    const label = `#${issueNumber}`;
    try {
      const issue = await deps.github.getIssue(repo, issueNumber);
      const body = (issue.body ?? '').slice(0, MAX_ISSUE_BODY_CHARS);
      resolved.push({ kind: 'issue', label, text: `${issue.title}\n${body}` });
    } catch (err) {
      missing.push({ kind: 'issue', label, reason: `could not be fetched — ${(err as Error).message}` });
    }
  }

  // ---- repo-relative doc paths (risk 4) ----
  for (const path of extracted.docPaths.slice(0, MAX_REFS_PER_KIND)) {
    if (!clonePath) {
      missing.push({ kind: 'path', label: path, reason: 'repo is not cloned yet' });
      continue;
    }
    const result = await readGuardedDoc(clonePath, path);
    if ('error' in result) missing.push({ kind: 'path', label: path, reason: result.error });
    else resolved.push({ kind: 'path', label: path, text: result.text });
  }

  // ---- anonymous HTTPS URLs (risk 3 — delegated to WebFetchClient) ----
  for (const url of urls.slice(0, MAX_REFS_PER_KIND)) {
    const fetched = await deps.webfetch.fetchText(url).catch(() => null);
    if (!fetched) missing.push({ kind: 'url', label: url, reason: 'could not be fetched (blocked, timed out, or not text)' });
    else resolved.push({ kind: 'url', label: url, text: fetched.text });
  }

  return { resolved, missing };
}
