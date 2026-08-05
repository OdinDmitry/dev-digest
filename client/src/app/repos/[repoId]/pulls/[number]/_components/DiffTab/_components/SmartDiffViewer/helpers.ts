/** Pure helpers for SmartDiffViewer — no React, no fetch/router. */
import type { PrFile, SmartDiff, SmartDiffFile, SmartDiffFindingRef, SmartDiffRole } from "@devdigest/shared";
import { LARGE_FILE_LINES } from "./constants";

export interface GroupEntry {
  smartDiffFile: SmartDiffFile;
  prFile: PrFile;
}

export interface ResolvedGroup {
  role: SmartDiffRole;
  entries: GroupEntry[];
  totalAdditions: number;
  totalDeletions: number;
  totalFindings: number;
}

function aggregate(entries: GroupEntry[]) {
  return {
    totalAdditions: entries.reduce((sum, e) => sum + e.smartDiffFile.additions, 0),
    totalDeletions: entries.reduce((sum, e) => sum + e.smartDiffFile.deletions, 0),
    totalFindings: entries.reduce((sum, e) => sum + e.smartDiffFile.findings.length, 0),
  };
}

/** A synthesized `PrFile` for a smart-diff file with no matching `pr_files`
 *  row — `patch: null` renders no lines (a real imported PR always has one). */
function toSyntheticPrFile(file: SmartDiffFile): PrFile {
  return { path: file.path, additions: file.additions, deletions: file.deletions, patch: null };
}

function toOrphanedEntry(prFile: PrFile): GroupEntry {
  return {
    smartDiffFile: {
      path: prFile.path,
      pseudocode_summary: null,
      additions: prFile.additions,
      deletions: prFile.deletions,
      findings: [],
    },
    prFile,
  };
}

/**
 * Joins the smart-diff groups with the loaded `PrFile[]` (needed for
 * `patch`). Defensive both ways (plan §11): a group file with no matching
 * `PrFile` renders with a synthesized one; a `PrFile` present in `files` but
 * in no group is appended to the end of the FIRST group, so no changed file
 * is ever hidden from the reviewer. Role order and file order within each
 * group are exactly as the server returned them — never re-sorted here.
 */
export function resolveGroups(smartDiff: SmartDiff, files: PrFile[]): ResolvedGroup[] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const seenPaths = new Set(smartDiff.groups.flatMap((g) => g.files.map((f) => f.path)));
  const orphanedEntries = files.filter((f) => !seenPaths.has(f.path)).map(toOrphanedEntry);

  if (smartDiff.groups.length === 0) {
    return orphanedEntries.length > 0
      ? [{ role: "core", entries: orphanedEntries, ...aggregate(orphanedEntries) }]
      : [];
  }

  return smartDiff.groups.map((group, i) => {
    const entries: GroupEntry[] = group.files.map((smartDiffFile) => ({
      smartDiffFile,
      prFile: byPath.get(smartDiffFile.path) ?? toSyntheticPrFile(smartDiffFile),
    }));
    const allEntries = i === 0 ? [...entries, ...orphanedEntries] : entries;
    return { role: group.role, entries: allEntries, ...aggregate(allEntries) };
  });
}

/** Every file's finding refs, keyed by path — built once per render. */
export function findingRefsByPath(smartDiff: SmartDiff): Map<string, SmartDiffFindingRef[]> {
  const map = new Map<string, SmartDiffFindingRef[]>();
  for (const group of smartDiff.groups) {
    for (const file of group.files) {
      if (file.findings.length > 0) map.set(file.path, file.findings);
    }
  }
  return map;
}

export function findingRefsForLine(
  refsByPath: Map<string, SmartDiffFindingRef[]>,
  path: string,
  line: number,
): SmartDiffFindingRef[] {
  const refs = refsByPath.get(path);
  if (!refs) return [];
  return refs.filter((r) => r.line === line);
}

/** A file whose `additions + deletions` exceeds `LARGE_FILE_LINES` — Smart
 *  mode only (§9). */
export function isLargeFile(file: { additions: number; deletions: number }): boolean {
  return file.additions + file.deletions > LARGE_FILE_LINES;
}
