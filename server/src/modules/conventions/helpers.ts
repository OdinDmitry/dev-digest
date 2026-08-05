import type { ConventionCandidate, ConventionStatus } from '@devdigest/shared';
import type { ConventionRow } from '../../db/rows.js';

/** Pure helpers for the conventions module — DB row ⇄ DTO mapping and the
 *  merge-preview markdown builder. No I/O. */

export function toConventionDto(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    repo_id: row.repoId,
    category: row.category,
    rule: row.rule,
    evidence_path: row.evidencePath,
    evidence_start_line: row.evidenceStartLine,
    evidence_end_line: row.evidenceEndLine,
    evidence_snippet: row.evidenceSnippet,
    confidence: row.confidence,
    status: row.status as ConventionStatus,
    scanned_sha: row.scannedSha,
    created_at: row.createdAt.toISOString(),
  };
}

/** `file:start-end` (or just `file:start` for a single line) evidence label. */
function evidenceLabel(row: Pick<ConventionRow, 'evidencePath' | 'evidenceStartLine' | 'evidenceEndLine'>): string | null {
  if (!row.evidencePath) return null;
  if (row.evidenceStartLine == null) return row.evidencePath;
  const range =
    row.evidenceEndLine != null && row.evidenceEndLine !== row.evidenceStartLine
      ? `${row.evidenceStartLine}-${row.evidenceEndLine}`
      : String(row.evidenceStartLine);
  return `${row.evidencePath}:${range}`;
}

/**
 * Build a markdown skill body from a set of accepted conventions, grouped by
 * category (uncategorized rows fall under "General"). One section per
 * convention: the rule, its evidence location, and the code snippet — so the
 * resulting skill reads as a directive checklist with receipts, not a bare
 * list of sentences.
 */
export function buildMergeBody(rows: ConventionRow[]): string {
  const byCategory = new Map<string, ConventionRow[]>();
  for (const row of rows) {
    const key = row.category?.trim() || 'General';
    const arr = byCategory.get(key) ?? [];
    arr.push(row);
    byCategory.set(key, arr);
  }

  const sections: string[] = [];
  for (const [category, items] of byCategory) {
    const block: string[] = [`## ${category}`];
    for (const row of items) {
      block.push(`### ${row.rule}`);
      const label = evidenceLabel(row);
      if (label) block.push(`Detected in \`${label}\`:`);
      if (row.evidenceSnippet) block.push('```', row.evidenceSnippet, '```');
    }
    sections.push(block.join('\n\n'));
  }
  return sections.join('\n\n');
}

export function defaultMergeName(repoName: string): string {
  return `${repoName}-conventions`;
}

export function defaultMergeDescription(count: number, repoFullName: string): string {
  return `${count} house convention${count === 1 ? '' : 's'} extracted from ${repoFullName}.`;
}
