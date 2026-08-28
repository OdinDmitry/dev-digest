import type { Finding, CiVerdict } from '@devdigest/shared';
import { CiResultArtifact } from '@devdigest/shared';
import { RunnerError } from './errors.js';

/** Runner build string embedded in every artifact (informational only). */
export const RUNNER_VERSION = '1';

export interface BuildResultArtifactInput {
  findings: Finding[];
  costUsd: number | null;
  durationMs: number;
  agent: string;
  prNumber: number;
  /** "owner/name" of the repository the run belongs to. */
  repo: string;
  /** `pull_request.head.sha`. */
  headSha: string;
  /** `process.env.GITHUB_SHA`. */
  workflowSha: string;
  manifestVersion: number;
  model: string;
  verdict: CiVerdict;
  /** Non-null only when `verdict === 'skipped'`. */
  skipReason: string | null;
}

function severityCounts(findings: Finding[]): { critical: number; warning: number; suggestion: number } {
  const counts = { critical: 0, warning: 0, suggestion: 0 };
  for (const f of findings) {
    if (f.severity === 'CRITICAL') counts.critical++;
    else if (f.severity === 'WARNING') counts.warning++;
    else counts.suggestion++;
  }
  return counts;
}

/**
 * Build + validate the `devdigest-result.json` artifact (AC-26). Validated
 * against the SAME `CiResultArtifact` Zod contract the studio's ingest path
 * (T6) will `safeParse` on the way back in, so a malformed artifact fails
 * loudly here rather than silently on ingest.
 */
export function buildResultArtifact(input: BuildResultArtifactInput): CiResultArtifact {
  const counts = severityCounts(input.findings);
  const candidate = {
    repo: input.repo,
    head_sha: input.headSha,
    workflow_sha: input.workflowSha,
    pr_number: input.prNumber,
    agent: input.agent,
    manifest_version: input.manifestVersion,
    model: input.model,
    runner_build: RUNNER_VERSION,
    verdict: input.verdict,
    skip_reason: input.skipReason,
    findings_count: input.findings.length,
    critical: counts.critical,
    warning: counts.warning,
    suggestion: counts.suggestion,
    cost_usd: input.costUsd,
    duration_ms: input.durationMs,
  };
  const result = CiResultArtifact.safeParse(candidate);
  if (!result.success) {
    // Should be unreachable — every field above is shaped to the schema. If
    // this ever fires it's a genuine internal bug, not a user/config error.
    throw new RunnerError(
      `Internal error: built result artifact failed CiResultArtifact validation: ${result.error.message}`,
    );
  }
  return result.data;
}
