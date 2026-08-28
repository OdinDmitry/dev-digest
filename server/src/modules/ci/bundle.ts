import { readFileSync } from 'node:fs';

/**
 * Read the ncc-bundled agent-runner (`AppConfig.runnerBundlePath`) as text.
 * Never throws — a missing/unreadable bundle returns `null`, and the decision
 * of what that means (refuse the whole export, AC-5) belongs to `CiService`,
 * not this file.
 */
export function readRunnerBundle(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}
