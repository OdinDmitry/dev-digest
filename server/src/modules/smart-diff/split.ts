import type { ProposedSplit } from '@devdigest/shared';
import {
  ROOT_BUCKET_NAME,
  SPLIT_MAX_PROPOSALS,
  SPLIT_REMAINDER_NAME,
  SPLIT_TOO_BIG_LINES,
} from './constants.js';

/** Minimal shape `buildSplitSuggestion` needs — a subset of `pr_files`. */
export interface SplitInputFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface SplitSuggestion {
  too_big: boolean;
  total_lines: number;
  proposed_splits: ProposedSplit[];
}

function firstPathSegment(path: string): string {
  const idx = path.indexOf('/');
  return idx === -1 ? ROOT_BUCKET_NAME : path.slice(0, idx);
}

/**
 * Deterministic split suggestion (§3 of the plan). Every changed file
 * appears in exactly one split when `too_big` — nothing is silently dropped.
 */
export function buildSplitSuggestion(files: SplitInputFile[]): SplitSuggestion {
  const total_lines = files.reduce((sum, f) => sum + f.additions + f.deletions, 0);
  const too_big = total_lines > SPLIT_TOO_BIG_LINES;
  if (!too_big) return { too_big, total_lines, proposed_splits: [] };

  const buckets = new Map<string, { lines: number; paths: string[] }>();
  for (const f of files) {
    const name = firstPathSegment(f.path);
    const bucket = buckets.get(name);
    if (bucket) {
      bucket.lines += f.additions + f.deletions;
      bucket.paths.push(f.path);
    } else {
      buckets.set(name, { lines: f.additions + f.deletions, paths: [f.path] });
    }
  }

  const sortedNames = [...buckets.keys()].sort((a, b) => {
    const linesA = buckets.get(a)!.lines;
    const linesB = buckets.get(b)!.lines;
    if (linesB !== linesA) return linesB - linesA;
    return a.localeCompare(b);
  });

  const kept = sortedNames.slice(0, SPLIT_MAX_PROPOSALS);
  const overflow = sortedNames.slice(SPLIT_MAX_PROPOSALS);

  const proposed_splits: ProposedSplit[] = kept.map((name) => ({
    name,
    files: [...buckets.get(name)!.paths].sort((a, b) => a.localeCompare(b)),
  }));

  if (overflow.length > 0) {
    const remainderFiles = overflow
      .flatMap((name) => buckets.get(name)!.paths)
      .sort((a, b) => a.localeCompare(b));
    proposed_splits.push({ name: SPLIT_REMAINDER_NAME, files: remainderFiles });
  }

  return { too_big, total_lines, proposed_splits };
}
