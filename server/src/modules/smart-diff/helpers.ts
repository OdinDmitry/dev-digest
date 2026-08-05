import type { SmartDiffFile, SmartDiffFindingRef } from '@devdigest/shared';
import type { FindingLocation } from '../reviews/repository.js';

/** Minimal shape `toSmartDiffFile(s)` needs — a subset of a `pr_files` row. */
export interface RawPrFile {
  path: string;
  additions: number;
  deletions: number;
}

/**
 * Builds one `SmartDiffFile` per raw `pr_files` row, attaching the
 * undismissed finding refs that land on it. Findings are matched to the file
 * by EXACT `path` equality (§2), sorted by `line` ASC then `finding_id` ASC
 * (a total order), and NOT deduplicated — two findings sharing a line
 * produce two entries. `pseudocode_summary` is always `null`: no LLM call is
 * made anywhere in this feature.
 */
export function toSmartDiffFile(file: RawPrFile, findingLocations: FindingLocation[]): SmartDiffFile {
  const findings: SmartDiffFindingRef[] = findingLocations
    .filter((f) => f.file === file.path)
    .map((f) => ({ line: f.line, finding_id: f.findingId }))
    .sort((a, b) => (a.line !== b.line ? a.line - b.line : a.finding_id.localeCompare(b.finding_id)));

  return {
    path: file.path,
    pseudocode_summary: null,
    additions: file.additions,
    deletions: file.deletions,
    findings,
  };
}

export function toSmartDiffFiles(files: RawPrFile[], findingLocations: FindingLocation[]): SmartDiffFile[] {
  return files.map((file) => toSmartDiffFile(file, findingLocations));
}
