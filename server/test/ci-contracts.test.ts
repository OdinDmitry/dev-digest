/**
 * `docs/plans/2026-08-28-export-to-ci-a-contracts-generation-install.md` T16.
 * Parses the Export-to-CI contracts (`vendor/shared/contracts/eval-ci.ts`)
 * against valid fixtures, checks the schema-enforceable rejections on
 * `CiExportInput`, and pins the `AgentManifest` backward-compatibility
 * regression that `agent-runner/src/manifest.ts:69`'s `AgentManifest.safeParse`
 * on read depends on (AC-11/AC-21/AC-22).
 */
import { describe, it, expect } from 'vitest';
import {
  AgentManifest,
  CiExportInput,
  CiExportPreview,
  CiInstallation,
  CiExport,
  CiFile,
  CiSecretExpectation,
  CiResultArtifact,
  CiRun,
  CiRefreshResult,
  CiRunStatus,
} from '@devdigest/shared';

const CI_FILE_FIXTURE = {
  path: '.devdigest/agents/security-reviewer.yaml',
  contents: 'name: Security Reviewer\n',
  editable: false,
};

const CI_SECRET_EXPECTATION_FIXTURE = {
  key: 'OPENROUTER_API_KEY',
  provided_by_platform: false,
};

const AGENT_MANIFEST_FIXTURE = {
  manifest_version: 1,
  name: 'Security Reviewer',
  provider: 'openrouter' as const,
  model: 'deepseek/deepseek-v4-flash',
  system_prompt: 'You are a security-focused code reviewer.',
  skills: ['sec-basics'],
  strategy: 'auto' as const,
  ci_fail_on: 'critical' as const,
  post_as: 'github_review' as const,
};

const CI_EXPORT_INPUT_FIXTURE = {
  repo_id: '11111111-1111-1111-1111-111111111111',
  target: 'gha' as const,
  post_as: 'github_review' as const,
  triggers: ['opened', 'synchronize'] as const,
  base: null,
  workflow_contents: null,
};

const CI_EXPORT_PREVIEW_FIXTURE = {
  files: [CI_FILE_FIXTURE],
  workflow_version: '1',
  expected_secrets: [CI_SECRET_EXPECTATION_FIXTURE],
  repo: 'acme/payments-api',
  base: 'main',
  ci_fail_on: 'critical' as const,
  skill_count: 1,
};

const CI_INSTALLATION_FIXTURE = {
  id: 'inst-1',
  agent_id: 'agent-1',
  agent_name: 'Security Reviewer',
  repo: 'acme/payments-api',
  target_type: 'gha' as const,
  installed_at: '2026-08-28T00:00:00.000Z',
  updated_at: '2026-08-28T00:00:00.000Z',
  workflow_version: '1',
  pr_url: 'https://github.com/acme/payments-api/pull/42',
  ci_fail_on: 'critical' as const,
  current: true,
};

const CI_EXPORT_FIXTURE = {
  installation: CI_INSTALLATION_FIXTURE,
  files: [CI_FILE_FIXTURE, { ...CI_FILE_FIXTURE, path: '.github/workflows/devdigest-review.yml', editable: true }],
  pr_url: 'https://github.com/acme/payments-api/pull/42',
};

describe('CI contracts parse valid fixtures', () => {
  it('AgentManifest', () => {
    expect(() => AgentManifest.parse(AGENT_MANIFEST_FIXTURE)).not.toThrow();
  });
  it('CiExportInput', () => {
    expect(() => CiExportInput.parse(CI_EXPORT_INPUT_FIXTURE)).not.toThrow();
  });
  it('CiExportPreview', () => {
    expect(() => CiExportPreview.parse(CI_EXPORT_PREVIEW_FIXTURE)).not.toThrow();
  });
  it('CiInstallation', () => {
    expect(() => CiInstallation.parse(CI_INSTALLATION_FIXTURE)).not.toThrow();
  });
  it('CiExport', () => {
    expect(() => CiExport.parse(CI_EXPORT_FIXTURE)).not.toThrow();
  });
  it('CiFile', () => {
    expect(() => CiFile.parse(CI_FILE_FIXTURE)).not.toThrow();
  });
  it('CiSecretExpectation', () => {
    expect(() => CiSecretExpectation.parse(CI_SECRET_EXPECTATION_FIXTURE)).not.toThrow();
  });
});

describe('CiExportInput rejects invalid input', () => {
  it('rejects an empty triggers array (at least one trigger required)', () => {
    const result = CiExportInput.safeParse({ ...CI_EXPORT_INPUT_FIXTURE, triggers: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('triggers');
    }
  });

  it('rejects a trigger name outside the CiTriggerEvent enum', () => {
    const result = CiExportInput.safeParse({
      ...CI_EXPORT_INPUT_FIXTURE,
      triggers: ['opened', 'closed'], // 'closed' is not a CiTriggerEvent member
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths.some((p) => p.startsWith('triggers'))).toBe(true);
    }
  });

  it('rejects a non-uuid repo_id', () => {
    const result = CiExportInput.safeParse({ ...CI_EXPORT_INPUT_FIXTURE, repo_id: 'not-a-uuid' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('repo_id');
    }
  });
});

// ===========================================================================
// T17 (Phase B) — CiResultArtifact / CiRun / CiRefreshResult / CiRunStatus
// ===========================================================================

const CI_RESULT_ARTIFACT_FIXTURE = {
  schema_version: 1,
  repo: 'acme/widgets',
  head_sha: 'headsha1234',
  workflow_sha: 'workflowsha5678',
  pr_number: 42,
  agent: 'Security Reviewer',
  manifest_version: 1,
  model: 'deepseek/deepseek-v4-flash',
  runner_build: '1',
  verdict: 'changes_requested' as const,
  skip_reason: null,
  findings_count: 1,
  critical: 1,
  warning: 0,
  suggestion: 0,
  cost_usd: 0.002,
  duration_ms: 1500,
};

const CI_RUN_FIXTURE = {
  id: 'run-1',
  ci_installation_id: 'inst-1',
  agent_id: 'agent-1',
  agent_name: 'Security Reviewer',
  repo: 'acme/widgets',
  pr_number: 42,
  head_sha: 'headsha1234',
  status: 'recorded' as const,
  verdict: 'changes_requested' as const,
  unavailable_reason: null,
  findings_count: 1,
  critical: 1,
  warning: 0,
  suggestion: 0,
  cost_usd: 0.002,
  duration_ms: 1500,
  ran_at: '2026-08-28T00:00:00.000Z',
  job_url: 'https://github.com/acme/widgets/actions/runs/1',
  model: 'deepseek/deepseek-v4-flash',
  manifest_version: 1,
  runner_build: '1',
};

const CI_REFRESH_RESULT_FIXTURE = {
  runs: [CI_RUN_FIXTURE],
  recorded: 1,
  skipped_existing: 0,
  rejected: [{ job_url: 'https://github.com/acme/widgets/actions/runs/2', reason: 'artifact repo mismatch' }],
  installations_checked: 1,
};

describe('CI contracts parse valid fixtures (Phase B)', () => {
  it('CiResultArtifact', () => {
    expect(() => CiResultArtifact.parse(CI_RESULT_ARTIFACT_FIXTURE)).not.toThrow();
  });
  it('CiRun', () => {
    expect(() => CiRun.parse(CI_RUN_FIXTURE)).not.toThrow();
  });
  it('CiRefreshResult', () => {
    expect(() => CiRefreshResult.parse(CI_REFRESH_RESULT_FIXTURE)).not.toThrow();
  });
});

describe('CiResultArtifact rejects invalid input', () => {
  it('rejects a missing repo', () => {
    const { repo: _repo, ...rest } = CI_RESULT_ARTIFACT_FIXTURE;
    const result = CiResultArtifact.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('repo');
    }
  });

  it('rejects a missing head_sha', () => {
    const { head_sha: _headSha, ...rest } = CI_RESULT_ARTIFACT_FIXTURE;
    const result = CiResultArtifact.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('head_sha');
    }
  });

  it('rejects a pr_number of 0', () => {
    const result = CiResultArtifact.safeParse({ ...CI_RESULT_ARTIFACT_FIXTURE, pr_number: 0 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('pr_number');
    }
  });

  it('a verdict: "skipped" artifact with a non-null skip_reason parses', () => {
    const skipped = {
      ...CI_RESULT_ARTIFACT_FIXTURE,
      verdict: 'skipped' as const,
      skip_reason: 'pull requests from forks are not reviewed',
      findings_count: 0,
      critical: 0,
      warning: 0,
      suggestion: 0,
      cost_usd: null,
      duration_ms: 0,
    };
    const result = CiResultArtifact.safeParse(skipped);
    expect(result.success).toBe(true);
  });
});

describe('CiRunStatus', () => {
  it('accepts in_progress / recorded / unavailable', () => {
    expect(CiRunStatus.safeParse('in_progress').success).toBe(true);
    expect(CiRunStatus.safeParse('recorded').success).toBe(true);
    expect(CiRunStatus.safeParse('unavailable').success).toBe(true);
  });

  it('no longer accepts "succeeded" or "no_findings"', () => {
    expect(CiRunStatus.safeParse('succeeded').success).toBe(false);
    expect(CiRunStatus.safeParse('no_findings').success).toBe(false);
  });
});

describe('AgentManifest — pre-manifest_version/post_as regression (studio predating this phase)', () => {
  // The exact shape a studio export written BEFORE this phase would have
  // produced: no `manifest_version` key, no `post_as` key at all — not even
  // `undefined` explicitly, the keys are simply absent, matching what an
  // older `.devdigest/agents/<slug>.yaml` on disk looks like. This is what
  // `agent-runner/src/manifest.ts:69`'s `AgentManifest.safeParse(parsed)`
  // reads on every CI run against a repo that installed the workflow before
  // this phase shipped — it must keep validating, not start failing CI.
  const LEGACY_MANIFEST = {
    name: 'Security Reviewer',
    provider: 'openrouter' as const,
    model: 'deepseek/deepseek-v4-flash',
    system_prompt: 'You are a security-focused code reviewer.',
    skills: ['sec-basics'],
    strategy: 'auto' as const,
    ci_fail_on: 'critical' as const,
    // Deliberately NO `manifest_version`, NO `post_as`.
  };

  it('validates, defaulting manifest_version to 1 and post_as to "github_review"', () => {
    const result = AgentManifest.safeParse(LEGACY_MANIFEST);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.manifest_version).toBe(1);
      expect(result.data.post_as).toBe('github_review');
    }
  });
});
