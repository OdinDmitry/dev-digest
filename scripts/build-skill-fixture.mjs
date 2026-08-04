#!/usr/bin/env node
/**
 * Rebuild the importable skill fixtures from their source folder.
 *
 *   node scripts/build-skill-fixture.mjs
 *
 * Produces, next to `docs/skill-fixtures/<name>/`:
 *   - `<name>.zip` — the archive, for the archive import path
 *   - `<name>.md`  — the bare SKILL.md, for the plain-markdown import path
 *
 * The zip is committed so the demo is one click, and this script exists so the
 * committed binary can't silently drift from the reviewable text next to it.
 * Run it after editing anything under `docs/skill-fixtures/<name>/`.
 *
 * Uses `fflate` from the server package (the same codec the importer reads with).
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const fixturesDir = join(repoRoot, 'docs', 'skill-fixtures');

// fflate lives in server/node_modules — resolve from there rather than adding a
// root package.json just for this script.
const require = createRequire(join(repoRoot, 'server', 'package.json'));
const { zipSync } = require('fflate');

/** Every file under `dir`, as POSIX-relative paths. */
function walk(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(relative(base, full).split('\\').join('/'));
  }
  return out.sort();
}

/** Arbitrary fixed timestamp inside the zip format's 1980-2099 range. */
const FIXED_MTIME = new Date('2020-01-01T00:00:00Z');

const packages = readdirSync(fixturesDir).filter((name) =>
  statSync(join(fixturesDir, name)).isDirectory(),
);

for (const name of packages) {
  const src = join(fixturesDir, name);
  const files = walk(src);

  const entries = {};
  for (const path of files) entries[path] = new Uint8Array(readFileSync(join(src, path)));

  // mtime pinned so rebuilding an unchanged folder produces an identical zip and
  // doesn't show up as a spurious diff. (Zip timestamps only span 1980-2099, so
  // the epoch is not a legal value here — use a fixed in-range date.)
  writeFileSync(
    join(fixturesDir, `${name}.zip`),
    Buffer.from(zipSync(entries, { mtime: FIXED_MTIME })),
  );

  const core = files.find((p) => p.toLowerCase() === 'skill.md');
  if (core) writeFileSync(join(fixturesDir, `${name}.md`), readFileSync(join(src, core)));

  console.log(`✓ ${name}.zip (${files.length} file(s): ${files.join(', ')})`);
}
