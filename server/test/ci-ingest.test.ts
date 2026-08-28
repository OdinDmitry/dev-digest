/**
 * `docs/plans/2026-08-28-export-to-ci-b-runner-and-ingest.md` T15 — hermetic
 * unit tests for `modules/ci/ingest.ts`'s `verifyResult`/`verdictFromEvent`.
 * Pure functions: no database, no network, no filesystem.
 */
import { describe, it, expect } from 'vitest';
import { verifyResult, verdictFromEvent, type WorkflowRunFacts } from '../src/modules/ci/ingest.js';
import type { CiResultArtifact } from '@devdigest/shared';

const VALID_ARTIFACT: CiResultArtifact = {
  schema_version: 1,
  repo: 'acme/widgets',
  head_sha: 'headsha1234',
  workflow_sha: 'workflowsha5678',
  pr_number: 42,
  agent: 'Security Reviewer',
  manifest_version: 1,
  model: 'deepseek/deepseek-v4-flash',
  runner_build: '1',
  verdict: 'changes_requested',
  skip_reason: null,
  findings_count: 1,
  critical: 1,
  warning: 0,
  suggestion: 0,
  cost_usd: 0.002,
  duration_ms: 1500,
};

const VALID_RUN: WorkflowRunFacts = {
  repo: 'acme/widgets',
  headSha: 'headsha1234',
  prNumbers: [42],
  jobUrl: 'https://github.com/acme/widgets/actions/runs/1',
};

describe('verifyResult', () => {
  it('accepts a well-formed artifact matching the run repo, head sha and pull request', () => {
    const result = verifyResult(JSON.stringify(VALID_ARTIFACT), VALID_RUN);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifact.repo).toBe('acme/widgets');
      expect(result.artifact.pr_number).toBe(42);
    }
  });

  it('rejects non-JSON text with a distinct, non-empty reason and never accepts it', () => {
    const result = verifyResult('this is not json {{{', VALID_RUN);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.length).toBeGreaterThan(0);
      expect(result.reason).toMatch(/json/i);
    }
  });

  it('rejects JSON that fails CiResultArtifact validation, with a distinct, non-empty reason', () => {
    const malformed = { ...VALID_ARTIFACT, pr_number: 'not-a-number' };
    const result = verifyResult(JSON.stringify(malformed), VALID_RUN);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.length).toBeGreaterThan(0);
      expect(result.reason).toMatch(/validation/i);
    }
  });

  it('rejects an artifact naming a different repository', () => {
    const artifact = { ...VALID_ARTIFACT, repo: 'acme/other-repo' };
    const result = verifyResult(JSON.stringify(artifact), VALID_RUN);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.length).toBeGreaterThan(0);
      expect(result.reason).toMatch(/repo/i);
    }
  });

  it('rejects when neither head_sha nor workflow_sha matches the run head sha', () => {
    const artifact = { ...VALID_ARTIFACT, head_sha: 'wrong1', workflow_sha: 'wrong2' };
    const result = verifyResult(JSON.stringify(artifact), VALID_RUN);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.length).toBeGreaterThan(0);
      expect(result.reason).toMatch(/head_sha|workflow_sha/i);
    }
  });

  it('rejects a pull-request number absent from a non-empty prNumbers list', () => {
    const artifact = { ...VALID_ARTIFACT, pr_number: 999 };
    const result = verifyResult(JSON.stringify(artifact), VALID_RUN);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.length).toBeGreaterThan(0);
      expect(result.reason).toMatch(/pull request|pr_number/i);
    }
  });

  it('collects a genuinely distinct reason string per rejection kind (no two collapse to the same message)', () => {
    const nonJson = verifyResult('not json', VALID_RUN);
    const badSchema = verifyResult(JSON.stringify({ ...VALID_ARTIFACT, pr_number: 'x' }), VALID_RUN);
    const badRepo = verifyResult(JSON.stringify({ ...VALID_ARTIFACT, repo: 'other/repo' }), VALID_RUN);
    const badSha = verifyResult(
      JSON.stringify({ ...VALID_ARTIFACT, head_sha: 'x', workflow_sha: 'y' }),
      VALID_RUN,
    );
    const badPr = verifyResult(JSON.stringify({ ...VALID_ARTIFACT, pr_number: 7 }), VALID_RUN);
    const reasons = [nonJson, badSchema, badRepo, badSha, badPr]
      .map((r) => (r.ok ? null : r.reason))
      .filter((r): r is string => r !== null);
    expect(reasons).toHaveLength(5);
    expect(new Set(reasons).size).toBe(5);
  });

  it('accepts when workflow_sha (not head_sha) matches the run head sha', () => {
    const artifact = { ...VALID_ARTIFACT, head_sha: 'some-other-commit', workflow_sha: VALID_RUN.headSha };
    const result = verifyResult(JSON.stringify(artifact), VALID_RUN);
    expect(result.ok).toBe(true);
  });

  it('a run reporting no pull requests accepts any pr_number', () => {
    const runWithNoPrs: WorkflowRunFacts = { ...VALID_RUN, prNumbers: [] };
    const artifact = { ...VALID_ARTIFACT, pr_number: 999999 };
    const result = verifyResult(JSON.stringify(artifact), runWithNoPrs);
    expect(result.ok).toBe(true);
  });

  it('compares the repository case-insensitively', () => {
    const artifact = { ...VALID_ARTIFACT, repo: 'ACME/Widgets' };
    const result = verifyResult(JSON.stringify(artifact), VALID_RUN);
    expect(result.ok).toBe(true);
  });

  it('a "skipped" verdict artifact with a non-null skip_reason parses and is accepted', () => {
    const artifact: CiResultArtifact = {
      ...VALID_ARTIFACT,
      verdict: 'skipped',
      skip_reason: 'pull requests from forks are not reviewed',
      findings_count: 0,
      critical: 0,
      warning: 0,
      suggestion: 0,
      cost_usd: null,
      duration_ms: 0,
    };
    const result = verifyResult(JSON.stringify(artifact), VALID_RUN);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifact.verdict).toBe('skipped');
      expect(result.artifact.skip_reason).toBe('pull requests from forks are not reviewed');
    }
  });
});

describe('verdictFromEvent', () => {
  it('maps APPROVE to "approved"', () => {
    expect(verdictFromEvent('APPROVE')).toBe('approved');
  });

  it('maps REQUEST_CHANGES to "changes_requested"', () => {
    expect(verdictFromEvent('REQUEST_CHANGES')).toBe('changes_requested');
  });

  it('maps COMMENT to "commented"', () => {
    expect(verdictFromEvent('COMMENT')).toBe('commented');
  });
});
