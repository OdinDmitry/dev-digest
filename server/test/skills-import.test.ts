import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import { parseSkillUpload } from '../src/modules/skills/import.js';
import { AppError } from '../src/platform/errors.js';

/**
 * The importer is the security surface of the skills feature: it turns an
 * untrusted upload into text that later becomes instructions in an agent's
 * prompt. Tests build their archives in memory so they stay deterministic; the
 * committed fixture is exercised separately at the bottom.
 */

const md = (s: string) => new Uint8Array(strToU8(s));
const zip = (entries: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)])));

describe('parseSkillUpload — markdown', () => {
  it('takes name/description/type from frontmatter and strips the block', () => {
    const preview = parseSkillUpload({
      filename: 'whatever.md',
      bytes: md(
        '---\nname: flake-radar\ndescription: "Use when tests touch time."\ntype: rubric\n---\n\n# Heading\n\nBody text.',
      ),
    });

    expect(preview.name).toBe('flake-radar');
    expect(preview.description).toBe('Use when tests touch time.');
    expect(preview.type).toBe('rubric');
    expect(preview.body).not.toContain('---');
    expect(preview.body).toContain('Body text.');
    expect(preview.entry_path).toBeNull();
    expect(preview.source).toBe('imported_url');
  });

  it('falls back to the first heading and paragraph, and infers the type', () => {
    const preview = parseSkillUpload({
      filename: 'notes.md',
      bytes: md('# secret-gate\n\nFlag any hardcoded credential or injection sink.\n'),
    });

    expect(preview.name).toBe('secret-gate');
    expect(preview.description).toBe('Flag any hardcoded credential or injection sink.');
    expect(preview.type).toBe('security'); // inferred from the wording
  });

  it('falls back to the filename when the body has no heading', () => {
    const preview = parseSkillUpload({
      filename: 'my-rules.markdown',
      bytes: md('Prefer named exports over default exports.\n'),
    });
    expect(preview.name).toBe('my-rules');
  });

  it('rejects an empty upload, a binary payload and an unsupported extension', () => {
    expect(() => parseSkillUpload({ filename: 'a.md', bytes: new Uint8Array() })).toThrow(AppError);
    expect(() =>
      parseSkillUpload({ filename: 'a.md', bytes: new Uint8Array([0x41, 0x00, 0x42]) }),
    ).toThrow(/not text/);
    expect(() => parseSkillUpload({ filename: 'skill.pdf', bytes: md('# hi\n\nthere') })).toThrow(
      /Unsupported file type/,
    );
  });
});

describe('parseSkillUpload — archive', () => {
  const EXECUTABLE_BODY = 'echo "this must never reach a prompt"';

  const archive = () =>
    zip({
      'flake-radar/SKILL.md': '# flake-radar\n\nReport non-deterministic tests.\n',
      'flake-radar/README.md': 'How this package is laid out.\n',
      'flake-radar/scripts/collect.sh': EXECUTABLE_BODY,
      'flake-radar/bin/tool': EXECUTABLE_BODY,
      'flake-radar/run.py': EXECUTABLE_BODY,
    });

  it('reads SKILL.md, keeps other markdown as evidence, and skips executables', () => {
    const preview = parseSkillUpload({ filename: 'flake-radar.zip', bytes: archive() });

    expect(preview.entry_path).toBe('flake-radar/SKILL.md');
    expect(preview.name).toBe('flake-radar');
    expect(preview.evidence_files).toEqual(['flake-radar/README.md']);
    expect(preview.skipped.map((s) => s.path).sort()).toEqual([
      'flake-radar/bin/tool',
      'flake-radar/run.py',
      'flake-radar/scripts/collect.sh',
    ]);
    expect(preview.skipped.every((s) => s.reason === 'executable')).toBe(true);
  });

  it('never lets an executable member reach the imported body', () => {
    // The security invariant, asserted directly: not "it was labelled skipped",
    // but "none of its bytes are in anything we would put in a prompt".
    const preview = parseSkillUpload({ filename: 'flake-radar.zip', bytes: archive() });
    expect(preview.body).not.toContain(EXECUTABLE_BODY);
    expect(preview.body).not.toContain('echo');
    expect(preview.description).not.toContain('echo');
  });

  it('prefers the shallowest SKILL.md over a deeper or alphabetically earlier one', () => {
    const preview = parseSkillUpload({
      filename: 'pkg.zip',
      bytes: zip({
        'aaa.md': '# aaa\n\nnot the core',
        'nested/deep/SKILL.md': '# deep\n\nnot the core either',
        'SKILL.md': '# core\n\nthe real body',
      }),
    });
    expect(preview.entry_path).toBe('SKILL.md');
    expect(preview.body).toContain('the real body');
  });

  it('names the skill after the archive when the core file is the generic SKILL.md', () => {
    const preview = parseSkillUpload({
      filename: 'flake-radar.zip',
      bytes: zip({ 'SKILL.md': 'Report non-deterministic tests.\n' }),
    });
    expect(preview.name).toBe('flake-radar');
  });

  it('skips an oversized member instead of throwing', () => {
    const preview = parseSkillUpload({
      filename: 'pkg.zip',
      bytes: zip({
        'SKILL.md': '# ok\n\nsmall enough',
        'huge.md': 'x'.repeat(300 * 1024),
      }),
    });
    expect(preview.body).toContain('small enough');
    expect(preview.skipped).toEqual([{ path: 'huge.md', reason: 'too_large' }]);
  });

  it('refuses an archive with no markdown at all', () => {
    expect(() =>
      parseSkillUpload({ filename: 'pkg.zip', bytes: zip({ 'scripts/go.sh': EXECUTABLE_BODY }) }),
    ).toThrow(/No markdown file/);
  });

  it('reports a corrupt archive as a validation error, not a crash', () => {
    // A valid zip signature followed by garbage — the reader must fail cleanly.
    const corrupt = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(40).fill(0x41)]);
    expect(() => parseSkillUpload({ filename: 'broken.zip', bytes: corrupt })).toThrow(AppError);
  });
});

describe('the committed demo fixture', () => {
  const fixture = (name: string) =>
    new Uint8Array(
      readFileSync(fileURLToPath(new URL(`../../docs/skill-fixtures/${name}`, import.meta.url))),
    );

  it('imports flake-radar.zip with its shell script skipped', () => {
    const preview = parseSkillUpload({
      filename: 'flake-radar.zip',
      bytes: fixture('flake-radar.zip'),
    });

    expect(preview.name).toBe('flake-radar');
    expect(preview.type).toBe('rubric');
    expect(preview.description).toMatch(/^Use when/);
    expect(preview.evidence_files).toEqual(['README.md']);
    expect(preview.skipped).toEqual([{ path: 'scripts/collect.sh', reason: 'executable' }]);
    expect(preview.body).not.toContain('regressed');
  });

  it('imports flake-radar.md to the same skill', () => {
    const preview = parseSkillUpload({
      filename: 'flake-radar.md',
      bytes: fixture('flake-radar.md'),
    });
    expect(preview.name).toBe('flake-radar');
    expect(preview.type).toBe('rubric');
    expect(preview.entry_path).toBeNull();
  });
});
