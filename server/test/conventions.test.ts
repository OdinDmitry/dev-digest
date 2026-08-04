import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyEvidence } from '../src/modules/conventions/grounding.js';
import { renderSample } from '../src/modules/conventions/samples.js';
import {
  buildMergeBody,
  defaultMergeName,
  defaultMergeDescription,
} from '../src/modules/conventions/helpers.js';
import type { ConventionRow } from '../src/db/rows.js';

/**
 * Pure/fs-only pieces of the conventions module: the code-based evidence
 * check (no model trust), the line-numbered sample renderer, and the
 * merge-preview markdown builder. No DB.
 */

describe('verifyEvidence', () => {
  let clonePath: string;

  beforeAll(async () => {
    clonePath = await mkdtemp(join(tmpdir(), 'ddg-conventions-'));
    await writeFile(join(clonePath, 'sample.ts'), 'line 1\nline 2\nline 3\n');
  });
  afterAll(async () => {
    await rm(clonePath, { recursive: true, force: true });
  });

  it('keeps evidence whose file exists and whose line range is real', async () => {
    const ok = await verifyEvidence(clonePath, {
      file: 'sample.ts',
      start_line: 1,
      end_line: 2,
    });
    expect(ok).toBe(true);
  });

  it('drops evidence citing a file that does not exist', async () => {
    const ok = await verifyEvidence(clonePath, {
      file: 'nope.ts',
      start_line: 1,
      end_line: 1,
    });
    expect(ok).toBe(false);
  });

  it('drops evidence whose end_line is past the real file length', async () => {
    const ok = await verifyEvidence(clonePath, {
      file: 'sample.ts',
      start_line: 1,
      end_line: 999,
    });
    expect(ok).toBe(false);
  });

  it('drops an inverted or non-positive range', async () => {
    expect(await verifyEvidence(clonePath, { file: 'sample.ts', start_line: 2, end_line: 1 })).toBe(
      false,
    );
    expect(await verifyEvidence(clonePath, { file: 'sample.ts', start_line: 0, end_line: 1 })).toBe(
      false,
    );
  });

  it('does not overcount by one for a trailing newline (the common case for real source files)', async () => {
    // sample.ts is 'line 1\nline 2\nline 3\n' — 3 real lines. A naive
    // content.split('\n').length would report 4 (the trailing '\n' produces
    // a phantom 4th empty element), letting evidence one line past the real
    // content through the grounding gate.
    expect(await verifyEvidence(clonePath, { file: 'sample.ts', start_line: 3, end_line: 3 })).toBe(
      true,
    );
    expect(await verifyEvidence(clonePath, { file: 'sample.ts', start_line: 4, end_line: 4 })).toBe(
      false,
    );
  });

  it('counts correctly for a file with no trailing newline', async () => {
    const noTrailingNewline = await mkdtemp(join(tmpdir(), 'ddg-conventions-no-nl-'));
    await writeFile(join(noTrailingNewline, 'sample.ts'), 'line 1\nline 2');
    expect(
      await verifyEvidence(noTrailingNewline, { file: 'sample.ts', start_line: 2, end_line: 2 }),
    ).toBe(true);
    expect(
      await verifyEvidence(noTrailingNewline, { file: 'sample.ts', start_line: 3, end_line: 3 }),
    ).toBe(false);
    await rm(noTrailingNewline, { recursive: true, force: true });
  });

  it('drops evidence against an empty file', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), 'ddg-conventions-empty-'));
    await writeFile(join(emptyDir, 'empty.ts'), '');
    expect(await verifyEvidence(emptyDir, { file: 'empty.ts', start_line: 1, end_line: 1 })).toBe(
      false,
    );
    await rm(emptyDir, { recursive: true, force: true });
  });
});

describe('renderSample', () => {
  it('prefixes every line with its real 1-based line number', () => {
    const out = renderSample('src/foo.ts', 'const a = 1;\nconst b = 2;');
    expect(out).toContain('### src/foo.ts');
    expect(out).toContain('   1: const a = 1;');
    expect(out).toContain('   2: const b = 2;');
  });

  it('truncates by whole lines, never mid-line, past the cap', () => {
    const lines = Array.from({ length: 250 }, (_, i) => `line ${i + 1}`);
    const out = renderSample('big.ts', lines.join('\n'));
    expect(out).toContain(' 200: line 200');
    expect(out).not.toContain('line 201');
  });
});

describe('buildMergeBody / defaultMergeName / defaultMergeDescription', () => {
  const row = (over: Partial<ConventionRow> = {}): ConventionRow =>
    ({
      id: 'c1',
      workspaceId: 'w1',
      repoId: 'r1',
      category: 'naming',
      rule: 'Use camelCase for variables',
      evidencePath: 'src/foo.ts',
      evidenceStartLine: 10,
      evidenceEndLine: 12,
      evidenceSnippet: 'const fooBar = 1;',
      confidence: 0.9,
      status: 'accepted',
      scannedSha: 'abc123',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      ...over,
    }) as ConventionRow;

  it('groups by category and cites file:start-end evidence', () => {
    const body = buildMergeBody([row()]);
    expect(body).toContain('## naming');
    expect(body).toContain('### Use camelCase for variables');
    expect(body).toContain('Detected in `src/foo.ts:10-12`');
    expect(body).toContain('const fooBar = 1;');
  });

  it('falls back to "General" for an uncategorized row and a single line has no range', () => {
    const body = buildMergeBody([row({ category: null, evidenceEndLine: 10 })]);
    expect(body).toContain('## General');
    expect(body).toContain('Detected in `src/foo.ts:10`');
  });

  it('omits the evidence line when there is no evidence path', () => {
    const body = buildMergeBody([row({ evidencePath: null, evidenceSnippet: null })]);
    expect(body).not.toContain('Detected in');
  });

  it('derives a default name and a pluralized description', () => {
    expect(defaultMergeName('payments-api')).toBe('payments-api-conventions');
    expect(defaultMergeDescription(1, 'acme/payments-api')).toBe(
      '1 house convention extracted from acme/payments-api.',
    );
    expect(defaultMergeDescription(3, 'acme/payments-api')).toBe(
      '3 house conventions extracted from acme/payments-api.',
    );
  });
});
