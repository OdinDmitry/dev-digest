import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Container } from '../../platform/container.js';
import type { RepoRow } from '../repos/repository.js';
import {
  CODE_SAMPLE_FILE_COUNT,
  CONFIG_SAMPLE_FILES,
  MAX_SAMPLE_LINES_PER_FILE,
  MAX_SAMPLE_LINE_CHARS,
} from './constants.js';

/**
 * Sample selection is entirely code-driven — no model call. Config files
 * (eslint/tsconfig/prettier) at the repo root, plus the top-ranked files from
 * `repoIntel.getConventionSamples` (already filters tests/configs/migrations/
 * generated dirs — see repo-intel/service.ts's JUNK_PATH_PATTERNS).
 */

export interface ConventionSamples {
  /** Combined, line-numbered text for every readable sampled file. */
  text: string;
  /** Paths that were actually read — surfaced as "Detected from N sample files". */
  scannedFiles: string[];
}

async function readClone(clonePath: string, file: string): Promise<string | null> {
  return readFile(join(clonePath, file), 'utf8').catch(() => null);
}

/**
 * Render one file with a 1-based line-number prefix per line, so a line the
 * model cites back is a REAL line number in the real file — the grounding
 * check (`grounding.ts`) re-reads the same file and trusts nothing else.
 * Truncated by whole lines (never mid-line), and each line width-capped, so a
 * citation always lands on content that actually exists.
 */
export function renderSample(path: string, content: string): string {
  const lines = content.split('\n').slice(0, MAX_SAMPLE_LINES_PER_FILE);
  const numbered = lines.map((line, i) => {
    const n = i + 1;
    const clipped =
      line.length > MAX_SAMPLE_LINE_CHARS ? `${line.slice(0, MAX_SAMPLE_LINE_CHARS)}…` : line;
    return `${String(n).padStart(4, ' ')}: ${clipped}`;
  });
  return `### ${path}\n${numbered.join('\n')}`;
}

export async function buildConventionSamples(
  container: Container,
  repo: Pick<RepoRow, 'id' | 'clonePath'>,
): Promise<ConventionSamples> {
  if (!repo.clonePath) return { text: '', scannedFiles: [] };
  const clonePath = repo.clonePath;

  const sections: string[] = [];
  const scannedFiles: string[] = [];

  for (const path of CONFIG_SAMPLE_FILES) {
    const content = await readClone(clonePath, path);
    if (content == null) continue;
    sections.push(renderSample(path, content));
    scannedFiles.push(path);
  }

  const rankedPaths = await container.repoIntel.getConventionSamples(
    repo.id,
    CODE_SAMPLE_FILE_COUNT,
  );
  for (const path of rankedPaths) {
    if (scannedFiles.includes(path)) continue;
    const content = await readClone(clonePath, path);
    if (content == null) continue;
    sections.push(renderSample(path, content));
    scannedFiles.push(path);
  }

  return { text: sections.join('\n\n'), scannedFiles };
}
