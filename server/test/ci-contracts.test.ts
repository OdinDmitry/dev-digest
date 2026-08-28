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
