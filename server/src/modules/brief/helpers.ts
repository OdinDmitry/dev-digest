import type { BriefEnvelope, BriefRecord, PrBlastRadius } from '@devdigest/shared';
import { CHANGE_STATS_FILE_LIMIT } from './constants.js';

/**
 * Pure transforms for the brief module — no I/O, no Drizzle, no `Container`.
 * Nothing here reads a hunk body: the input type is `path`/`additions`/
 * `deletions` only (the same projection `prFileSummaries` already returns).
 */

export interface PrFileSummary {
  path: string;
  additions: number;
  deletions: number;
}

export interface ChangeStats {
  /** Sorted (churn desc, path asc), capped at `CHANGE_STATS_FILE_LIMIT` — the
   *  files actually shown to the model. This is also the file grounding set:
   *  a path beyond the cap was never shown, so it can never ground a ref. */
  shown: PrFileSummary[];
  /** Count of files beyond the cap, never truncated mid-file. */
  notListed: number;
}

/** Sort by churn (additions + deletions) descending, ties by path ascending;
 *  take the first `CHANGE_STATS_FILE_LIMIT` and report `not_listed` for the
 *  rest. */
export function changeStats(files: PrFileSummary[]): ChangeStats {
  const sorted = [...files].sort((a, b) => {
    const churnA = a.additions + a.deletions;
    const churnB = b.additions + b.deletions;
    if (churnB !== churnA) return churnB - churnA;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
  const shown = sorted.slice(0, CHANGE_STATS_FILE_LIMIT);
  const notListed = Math.max(0, sorted.length - CHANGE_STATS_FILE_LIMIT);
  return { shown, notListed };
}

/** Render `changeStats`'s `shown` list as the text block fed to the model —
 *  paths + additions/deletions counts only, never a hunk body. */
export function renderChangeStats(stats: ChangeStats): string {
  const lines = stats.shown.map((f) => `${f.path} (+${f.additions}/-${f.deletions})`);
  if (stats.notListed > 0) {
    lines.push(`…and ${stats.notListed} more file(s) not listed.`);
  }
  return lines.join('\n');
}

/** One deterministic sentence summarizing the blast radius — never a model
 *  call, never a recomputation of the blast radius itself (Constraint 4). */
export function blastSummaryLine(blast: PrBlastRadius): string {
  const symbolCount = blast.changed_symbols.length;
  const callerCount = blast.callers_total;
  const endpointCount = blast.impacted_endpoints.length;
  const base =
    `This change touches ${symbolCount} symbol(s), reached by ${callerCount} caller(s) across ` +
    `the codebase, and impacts ${endpointCount} API endpoint(s).`;
  if (blast.state === 'partial') {
    return `${base} Blast-radius analysis is partial — some results may be incomplete.`;
  }
  if (blast.state === 'degraded') {
    return `${base} Blast-radius analysis is degraded — results may be incomplete.`;
  }
  return base;
}

/** The endpoint grounding set — endpoints the model was actually shown via
 *  the blast summary line. */
export function endpointSet(blast: PrBlastRadius): Set<string> {
  return new Set(blast.impacted_endpoints.map((e) => e.endpoint));
}

/** `BriefRecord | null` (the repository's cache-read shape) → the public
 *  `BriefEnvelope` DTO. No model call on either branch. */
export function toBriefEnvelope(record: BriefRecord | null): BriefEnvelope {
  return record
    ? { status: 'ready', brief: record, reason: null }
    : { status: 'absent', brief: null, reason: null };
}
