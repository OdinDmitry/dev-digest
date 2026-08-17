/**
 * modules/context/scan.ts — the ONLY file in this module that imports
 * `node:fs`. Reads markdown documents from an imported repository's working
 * copy on disk; no DB, no fastify.
 *
 * Modelled on `modules/repo-intel/pipeline/walk.ts` (recursive walk, symlinks
 * skipped, POSIX-relative output paths) but scoped to markdown discovery
 * instead of the code index (see constants.ts for why the exclusion list is
 * NOT shared between the two).
 */
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DISCOVERY_LIMIT, EXCLUDED_DIRS, MARKDOWN_EXT, MAX_DOCUMENT_BYTES } from './constants.js';

const EXCLUDED_SET: ReadonlySet<string> = new Set(EXCLUDED_DIRS);
const MARKDOWN_SET: ReadonlySet<string> = new Set(MARKDOWN_EXT);

export interface MarkdownFile {
  /** Repository-relative, POSIX-separated. */
  path: string;
  sizeBytes: number;
  mtimeMs: number;
}

export interface ListMarkdownResult {
  files: MarkdownFile[];
  /** Count of files past DISCOVERY_LIMIT, not included in `files`. */
  notListed: number;
}

/**
 * Recursively walk `root`, returning every markdown file that passes the
 * discovery filters, ascending by path, capped at DISCOVERY_LIMIT.
 */
export async function listMarkdown(root: string): Promise<ListMarkdownResult> {
  const out: MarkdownFile[] = [];
  await walkDir(root, root, out);

  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  let notListed = 0;
  if (out.length > DISCOVERY_LIMIT) {
    notListed = out.length - DISCOVERY_LIMIT;
    out.length = DISCOVERY_LIMIT;
  }

  return { files: out, notListed };
}

async function walkDir(root: string, dir: string, out: MarkdownFile[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch {
    // Unreadable directory — skip cleanly, keep discovering the rest.
    return;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue; // never follow symlinks
    const name = entry.name;

    if (entry.isDirectory()) {
      if (EXCLUDED_SET.has(name)) continue;
      await walkDir(root, join(dir, name), out);
      continue;
    }

    if (!entry.isFile()) continue;

    const ext = extname(name).toLowerCase();
    if (!MARKDOWN_SET.has(ext)) continue;

    const full = join(dir, name);
    let st: { size: number; mtimeMs: number };
    try {
      st = await stat(full);
    } catch {
      continue;
    }
    if (st.size > MAX_DOCUMENT_BYTES) continue;

    const rel = relative(root, full).split(sep).join('/');
    out.push({ path: rel, sizeBytes: st.size, mtimeMs: st.mtimeMs });
  }
}

/**
 * Read one document's text by repository-relative path, never throwing.
 * Returns `null` when the document is absent, oversized, not strictly valid
 * UTF-8, or when `relPath` resolves outside `root` — the guard that stops an
 * attachment path from reading a file elsewhere on the machine. Absolute
 * inputs and `..` segments are rejected outright, before any `readFile`.
 *
 * The string-prefix check below is only a cheap fast path (rejects `..`
 * escapes and absolute inputs before touching the filesystem); it does NOT
 * catch a symlink — or, on win32, a junction (creatable without elevation) —
 * that sits INSIDE `root` but points OUTSIDE it, because `target`'s literal
 * string is still under `root` even though the real file it follows to is
 * not. `realpath()` resolves every symlink/junction along the path, so the
 * containment check is re-run against the fully-resolved real paths before
 * any `stat`/`readFile` of the (possibly-linked) target.
 */
export async function readDocument(root: string, relPath: string): Promise<string | null> {
  if (isAbsolute(relPath)) return null;
  const segments = relPath.split(/[/\\]/);
  if (segments.includes('..')) return null;

  const rootResolved = resolve(root);
  const target = resolve(rootResolved, relPath);
  if (target !== rootResolved && !target.startsWith(rootResolved + sep)) return null;

  let realRoot: string;
  let realTarget: string;
  try {
    [realRoot, realTarget] = await Promise.all([realpath(rootResolved), realpath(target)]);
  } catch {
    return null;
  }
  if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) return null;

  // Read the RESOLVED path, not `target`: `realTarget` is the one containment
  // was just checked against, so validating one path and reading another would
  // leave a window where a link swapped in between is read after a check that
  // no longer describes it.
  let st: { size: number };
  try {
    st = await stat(realTarget);
  } catch {
    return null;
  }
  if (st.size > MAX_DOCUMENT_BYTES) return null;

  let buf: Buffer;
  try {
    buf = await readFile(realTarget);
  } catch {
    return null;
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return null;
  }
}
