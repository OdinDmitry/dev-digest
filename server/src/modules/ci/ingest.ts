import { CiResultArtifact, type CiVerdict } from '@devdigest/shared';

/**
 * Ingest-time verification (ring 2) — pure. No database, no network, no
 * import beyond zod/the contracts, never throws. `CiService.refresh` calls
 * this after downloading a run's result artifact, before ANY row is written.
 */

export interface WorkflowRunFacts {
  repo: string; // "owner/name" of the repository the run belongs to
  headSha: string;
  prNumbers: number[];
  jobUrl: string;
}

export type VerifyResult =
  | { ok: true; artifact: CiResultArtifact }
  | { ok: false; reason: string };

/**
 * AC-15. Rejects, with a reason naming the mismatch, when: the text is not
 * JSON; `CiResultArtifact.safeParse` fails; `artifact.repo` differs from
 * `run.repo` (compared case-insensitively — GitHub repository names are);
 * neither `artifact.head_sha` nor `artifact.workflow_sha` equals
 * `run.headSha`; or `run.prNumbers` is non-empty and does not contain
 * `artifact.pr_number`. When the platform reports no pull request for the
 * run, the pull-request check is vacuous — a result is rejected only when it
 * *names* something other than what the run says, and a run that says
 * nothing contradicts nothing.
 */
export function verifyResult(rawText: string, run: WorkflowRunFacts): VerifyResult {
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch {
    return { ok: false, reason: 'result artifact is not valid JSON' };
  }

  const parsed = CiResultArtifact.safeParse(json);
  if (!parsed.success) {
    return { ok: false, reason: `result artifact failed validation: ${parsed.error.message}` };
  }
  const artifact = parsed.data;

  if (artifact.repo.toLowerCase() !== run.repo.toLowerCase()) {
    return {
      ok: false,
      reason: `artifact repo "${artifact.repo}" does not match run repo "${run.repo}"`,
    };
  }

  if (artifact.head_sha !== run.headSha && artifact.workflow_sha !== run.headSha) {
    return {
      ok: false,
      reason: `neither head_sha "${artifact.head_sha}" nor workflow_sha "${artifact.workflow_sha}" matches the run's head_sha "${run.headSha}"`,
    };
  }

  if (run.prNumbers.length > 0 && !run.prNumbers.includes(artifact.pr_number)) {
    return {
      ok: false,
      reason: `artifact pr_number ${artifact.pr_number} is not among the run's pull requests (${run.prNumbers.join(', ')})`,
    };
  }

  return { ok: true, artifact };
}

/** payload.event → CiVerdict. Deterministic; never the model's self-report. */
export function verdictFromEvent(event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'): CiVerdict {
  switch (event) {
    case 'APPROVE':
      return 'approved';
    case 'REQUEST_CHANGES':
      return 'changes_requested';
    case 'COMMENT':
      return 'commented';
  }
}
