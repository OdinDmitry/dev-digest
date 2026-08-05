import type { SmartDiffFile, SmartDiffGroup, SmartDiffRole } from '@devdigest/shared';
import { BOILERPLATE_PATTERNS, WIRING_PATTERNS, ROLE_ORDER } from './constants.js';

/**
 * Pure, table-driven classification. No I/O, no Drizzle, no `Container` — see
 * `constants.ts` for every pattern/threshold this file references.
 */

/** Precedence: boilerplate → wiring → core (default), first match wins. */
export function classifyPath(path: string): SmartDiffRole {
  const p = path.toLowerCase();
  if (BOILERPLATE_PATTERNS.some((re) => re.test(p))) return 'boilerplate';
  if (WIRING_PATTERNS.some((re) => re.test(p))) return 'wiring';
  return 'core';
}

/**
 * Groups already-built `SmartDiffFile` entries by role, in `ROLE_ORDER`,
 * omitting empty groups. Within a group, files sort by finding count DESC,
 * then changed lines (additions + deletions) DESC, then path ASC — a total,
 * stable order (constraint 6).
 */
export function groupFiles(files: SmartDiffFile[]): SmartDiffGroup[] {
  const byRole = new Map<SmartDiffRole, SmartDiffFile[]>();
  for (const file of files) {
    const role = classifyPath(file.path);
    const bucket = byRole.get(role);
    if (bucket) bucket.push(file);
    else byRole.set(role, [file]);
  }

  const groups: SmartDiffGroup[] = [];
  for (const role of ROLE_ORDER) {
    const bucket = byRole.get(role);
    if (!bucket || bucket.length === 0) continue;
    const sorted = [...bucket].sort((a, b) => {
      if (b.findings.length !== a.findings.length) return b.findings.length - a.findings.length;
      const linesA = a.additions + a.deletions;
      const linesB = b.additions + b.deletions;
      if (linesB !== linesA) return linesB - linesA;
      return a.path.localeCompare(b.path);
    });
    groups.push({ role, files: sorted });
  }
  return groups;
}
