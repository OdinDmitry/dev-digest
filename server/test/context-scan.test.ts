/**
 * T21 — modules/context/scan.ts unit tests.
 *
 * No DB, no fastify. Builds a temp dir on disk per test, runs `listMarkdown`
 * and `readDocument`, asserts the discovery filters (AC-2) and the
 * containment guard that stops an attachment path from reading a file
 * elsewhere on the machine.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, sep } from 'node:path';
import { listMarkdown, readDocument } from '../src/modules/context/scan.js';
import { DISCOVERY_LIMIT, MAX_DOCUMENT_BYTES } from '../src/modules/context/constants.js';

/** `dirname(full)` + `mkdir({ recursive: true })` — never a manual separator
 *  search on a `join()`-produced path (server/insights.md 2026-08-07: `join`
 *  normalises to `\` on win32, so a hand-rolled `lastIndexOf('/')` silently
 *  finds nothing there). */
async function writeFileAt(root: string, rel: string, contents: string | Uint8Array): Promise<void> {
  const full = join(root, rel);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, contents);
}

describe('modules/context/scan', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'context-scan-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('excludes non-markdown, excluded dirs, oversized files and escaping paths', async () => {
    await writeFileAt(root, 'good.md', '# a');
    await writeFileAt(root, 'good.markdown', '# b');
    await writeFileAt(root, 'bad.txt', 'not markdown');
    await writeFileAt(root, 'bad.ts', 'export {}');
    await writeFileAt(root, 'node_modules/pkg/README.md', '# excluded dep dir');
    await writeFileAt(root, '.git/COMMIT_EDITMSG.md', '# excluded vcs dir');
    await writeFileAt(root, 'big.md', 'x'.repeat(MAX_DOCUMENT_BYTES + 1));

    const { files } = await listMarkdown(root);
    const paths = files.map((f) => f.path);

    // Only the two genuinely-discoverable markdown files remain, ascending.
    expect(paths).toEqual(['good.markdown', 'good.md']);
    expect(paths.some((p) => p.includes('node_modules'))).toBe(false);
    expect(paths.some((p) => p.includes('.git'))).toBe(false);
    expect(paths.includes('big.md')).toBe(false);
    expect(paths.some((p) => p.endsWith('.txt') || p.endsWith('.ts'))).toBe(false);

    // readDocument: a relative path escaping the root via `..` never resolves.
    expect(await readDocument(root, '../../etc/passwd')).toBeNull();

    // readDocument: an absolute path is rejected outright, before any read.
    const absoluteOutside = join(tmpdir(), 'context-scan-absolute-probe.md');
    await writeFile(absoluteOutside, '# should never be read');
    expect(await readDocument(root, absoluteOutside)).toBeNull();
    await rm(absoluteOutside, { force: true });

    // readDocument: a symlink living inside the root but pointing outside it
    // must not let a caller read past the working copy — the containment
    // check is what stops an attachment path from reaching an arbitrary file
    // on the machine (spec Untrusted inputs / AC-2).
    const outsideDir = join(root, '..', 'context-scan-outside');
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(outsideDir, 'secret.md'), '# secret outside the working copy');
    try {
      await symlink(outsideDir, join(root, 'linked'), 'junction');
      expect(await readDocument(root, 'linked/secret.md')).toBeNull();
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('excludes a document whose bytes are not valid UTF-8 from the discoverable set', async () => {
    await writeFileAt(root, 'valid.md', '# valid');
    // 0xC3 0x28 is an invalid two-byte UTF-8 sequence (0x28 is not a valid
    // continuation byte). `listMarkdown` filters purely on extension/size —
    // it does not read content — so this file is still discovered; it is
    // `readDocument`'s strict decode (`service.ts` drops anything it returns
    // null for) that actually excludes it from what the user sees.
    await writeFileAt(root, 'invalid-utf8.md', Buffer.from([0xc3, 0x28, 0x21]));

    const { files } = await listMarkdown(root);
    expect(files.map((f) => f.path).sort()).toEqual(['invalid-utf8.md', 'valid.md']);

    expect(await readDocument(root, 'valid.md')).toBe('# valid');
    expect(await readDocument(root, 'invalid-utf8.md')).toBeNull();
  });

  it('returns repository-relative paths POSIX-separated, even on win32', async () => {
    await writeFileAt(root, 'docs/nested/guide.md', '# nested');

    const { files } = await listMarkdown(root);
    expect(files.map((f) => f.path)).toEqual(['docs/nested/guide.md']);
    expect(files[0]!.path.includes(sep) && sep !== '/').toBe(false);
  });

  it('lists ascending by path and reports the overflow past DISCOVERY_LIMIT in notListed', async () => {
    const total = DISCOVERY_LIMIT + 5;
    const writes: Promise<void>[] = [];
    for (let i = 0; i < total; i++) {
      writes.push(writeFileAt(root, `f${String(i).padStart(5, '0')}.md`, 'x'));
    }
    await Promise.all(writes);

    const { files, notListed } = await listMarkdown(root);
    expect(files.length).toBe(DISCOVERY_LIMIT);
    expect(notListed).toBe(5);
    const paths = files.map((f) => f.path);
    expect(paths).toEqual([...paths].sort());
    // The cap keeps the FIRST DISCOVERY_LIMIT paths in ascending order —
    // the last kept file is therefore the (DISCOVERY_LIMIT - 1)th name.
    expect(paths[paths.length - 1]).toBe(`f${String(DISCOVERY_LIMIT - 1).padStart(5, '0')}.md`);
  }, 20_000);
});
