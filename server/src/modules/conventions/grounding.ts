import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Code-only evidence check for a raw candidate's cited file:line — no model
 * trust involved. A candidate is dropped unless its file exists in the clone
 * AND its line range sits inside that file's real line count.
 *
 * Deliberately NOT a reuse of `reviewer-core/src/grounding.ts`'s
 * `groundFindings` — that gate checks a finding's lines against unified-diff
 * hunks and reviewer-core is filesystem-free by design. A repo-wide file/line
 * existence check needs fs access, which belongs here in server/.
 */
export interface RawEvidence {
  file: string;
  start_line: number;
  end_line: number;
}

export async function verifyEvidence(clonePath: string, evidence: RawEvidence): Promise<boolean> {
  if (evidence.start_line < 1 || evidence.end_line < evidence.start_line) return false;
  const content = await readFile(join(clonePath, evidence.file), 'utf8').catch(() => null);
  if (content == null) return false;
  const lineCount = content.split('\n').length;
  return evidence.end_line <= lineCount;
}
