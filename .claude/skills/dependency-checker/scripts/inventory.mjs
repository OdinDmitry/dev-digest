#!/usr/bin/env node
/**
 * Inventories external npm dependencies across DevDigest's 5 standalone
 * packages (no workspace root — each has its own package.json/lockfile).
 * Prints one JSON report to stdout: per-package deps + versions + on-disk
 * size of each *direct* dependency, which package-manager lockfile each
 * package uses, and cross-package version drift for any dependency shared
 * by 2+ packages.
 *
 * Usage: node .claude/skills/dependency-checker/scripts/inventory.mjs [repo-root]
 * Run from (or pass) the repo root — the one containing client/, server/,
 * reviewer-core/, mcp/, e2e/.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.argv[2] || process.cwd());
const PACKAGES = ['client', 'server', 'reviewer-core', 'mcp', 'e2e'];

function fmtSize(bytes) {
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(2) + ' GB';
  if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return bytes + ' B';
}

/** Size of one dependency's own installed directory (follows symlinks/junctions,
 * as pnpm uses them for node_modules/<name> -> the content-addressable store).
 * Bounded to a single dependency's tree, not the whole node_modules — that
 * keeps this fast even though full `du` on the whole install can take minutes. */
function dirSize(dir) {
  let bytes = 0;
  let files = 0;
  const stack = [dir];
  const seen = new Set();
  while (stack.length) {
    const d = stack.pop();
    let real;
    try {
      real = statSync(d);
    } catch {
      continue;
    }
    const key = `${real.dev}:${real.ino}`;
    if (seen.has(key)) continue; // guard against symlink cycles
    seen.add(key);

    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      try {
        const st = statSync(p); // statSync follows symlinks/junctions
        if (st.isDirectory()) stack.push(p);
        else if (st.isFile()) {
          bytes += st.size;
          files += 1;
        }
      } catch {
        // broken symlink or permission error — skip
      }
    }
  }
  return { bytes, files };
}

function detectLockfile(pkgDir) {
  if (existsSync(join(pkgDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(pkgDir, 'package-lock.json'))) return 'npm';
  if (existsSync(join(pkgDir, 'yarn.lock'))) return 'yarn';
  return 'none';
}

const report = { root: ROOT, packages: {}, sharedDeps: {} };

for (const pkg of PACKAGES) {
  const pkgDir = join(ROOT, pkg);
  const pkgJsonPath = join(pkgDir, 'package.json');
  if (!existsSync(pkgJsonPath)) continue;

  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  const deps = pkgJson.dependencies || {};
  const devDeps = pkgJson.devDependencies || {};
  const nodeModulesExists = existsSync(join(pkgDir, 'node_modules'));

  const dependencies = {};
  for (const [name, range] of Object.entries({ ...deps, ...devDeps })) {
    const isDev = !!devDeps[name] && !deps[name];
    let size = null;
    if (nodeModulesExists) {
      const depPath = join(pkgDir, 'node_modules', ...name.split('/'));
      if (existsSync(depPath)) {
        const { bytes, files } = dirSize(depPath);
        size = { bytes, human: fmtSize(bytes), files };
      }
    }
    dependencies[name] = { range, dev: isDev, size };

    if (!report.sharedDeps[name]) report.sharedDeps[name] = {};
    report.sharedDeps[name][pkg] = range;
  }

  report.packages[pkg] = {
    name: pkgJson.name || pkg,
    lockfile: detectLockfile(pkgDir),
    nodeModulesExists,
    depCount: Object.keys(deps).length,
    devDepCount: Object.keys(devDeps).length,
    dependencies,
  };
}

const versionDrift = [];
for (const [name, byPkg] of Object.entries(report.sharedDeps)) {
  const pkgs = Object.keys(byPkg);
  const versions = new Set(Object.values(byPkg));
  if (pkgs.length >= 2 && versions.size > 1) {
    versionDrift.push({ name, sharedBy: pkgs.length, versions: byPkg });
  }
}
report.versionDrift = versionDrift.sort((a, b) => b.sharedBy - a.sharedBy);

const lockfileKinds = new Set(Object.values(report.packages).map((p) => p.lockfile));
report.mixedPackageManagers = lockfileKinds.size > 1;

process.stdout.write(JSON.stringify(report, null, 2) + '\n');
