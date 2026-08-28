/**
 * `docs/plans/2026-08-28-export-to-ci-a-contracts-generation-install.md` T17.
 * Hermetic unit tests over the pure CI generators — `workflow.ts`,
 * `manifest.ts` and `helpers.ts`. No DB, no HTTP, no adapters: every function
 * under test takes plain inputs and returns plain strings/objects.
 */
import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import type { CiTriggerEvent } from '@devdigest/shared';
import { buildWorkflow, readWorkflowVersion, validateWorkflow, expectedSecrets } from '../src/modules/ci/workflow.js';
import { buildManifest, serializeManifest } from '../src/modules/ci/manifest.js';
import { uniqueSlugs } from '../src/modules/ci/helpers.js';
import {
  ACTION_CHECKOUT,
  ACTION_UPLOAD_ARTIFACT,
  SECRET_MODEL_KEY,
  SECRET_GITHUB_TOKEN,
  WORKFLOW_VERSION_MARKER,
} from '../src/modules/ci/constants.js';
import type { AgentRow } from '../src/modules/agents/repository.js';

const SHA_RE = /^[0-9a-f]{40}$/;

function agentFixture(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: 'agent-1',
    workspaceId: 'ws-1',
    name: 'Security Reviewer',
    description: '',
    provider: 'openai',
    model: 'gpt-4.1',
    systemPrompt: 'You are a reviewer. Flag any hardcoded secret.',
    outputSchema: null,
    strategy: 'auto',
    ciFailOn: 'critical',
    repoIntel: true,
    enabled: true,
    version: 1,
    createdBy: null,
    createdAt: new Date('2026-08-28T00:00:00.000Z'),
    ...overrides,
  };
}

// ===========================================================================
// buildWorkflow — AC-21 (triggers), NFR (permissions/pinning/trigger safety)
// ===========================================================================

describe('buildWorkflow', () => {
  it('AC-21: a single trigger yields on.pull_request.types with exactly that one value, and no other "on" key', () => {
    const doc = parseYaml(buildWorkflow(['opened'])) as Record<string, unknown>;
    expect(doc.on).toEqual({ pull_request: { types: ['opened'] } });
  });

  it('AC-21: three triggers yield exactly those three, in order, and nothing else', () => {
    const triggers: CiTriggerEvent[] = ['opened', 'synchronize', 'reopened'];
    const doc = parseYaml(buildWorkflow(triggers)) as {
      on: { pull_request: { types: string[] } };
    };
    expect(doc.on.pull_request.types).toEqual(['opened', 'synchronize', 'reopened']);
    // No sibling key under `on` beyond `pull_request`.
    expect(Object.keys(doc.on)).toEqual(['pull_request']);
  });

  it('NFR: permissions is exactly { contents: read, pull-requests: write } — no other permission', () => {
    const doc = parseYaml(buildWorkflow(['opened'])) as { permissions: Record<string, string> };
    expect(doc.permissions).toEqual({ contents: 'read', 'pull-requests': 'write' });
  });

  it('NFR: triggers on pull_request, never pull_request_target', () => {
    const doc = parseYaml(buildWorkflow(['opened'])) as Record<string, unknown>;
    expect(doc.on).toHaveProperty('pull_request');
    expect(doc.on).not.toHaveProperty('pull_request_target');
    expect(buildWorkflow(['opened'])).not.toContain('pull_request_target');
  });

  it('NFR: both action references are pinned to a 40-character sha, not a floating tag', () => {
    const workflow = buildWorkflow(['opened']);
    const doc = parseYaml(workflow) as {
      jobs: { review: { steps: { uses?: string }[] } };
    };
    const uses = doc.jobs.review.steps.map((s) => s.uses).filter((u): u is string => !!u);
    expect(uses).toHaveLength(2);
    for (const ref of uses) {
      const [, sha] = ref.split('@');
      expect(sha).toMatch(SHA_RE);
    }
    // Sanity: the two constants really are what got embedded.
    expect(uses).toContain(ACTION_CHECKOUT);
    expect(uses).toContain(ACTION_UPLOAD_ARTIFACT);
    expect(ACTION_CHECKOUT.split('@')[1]).toMatch(SHA_RE);
    expect(ACTION_UPLOAD_ARTIFACT.split('@')[1]).toMatch(SHA_RE);
  });
});

// ===========================================================================
// readWorkflowVersion — AC-8/AC-9
// ===========================================================================

describe('readWorkflowVersion', () => {
  it('round-trips the marker written by buildWorkflow', () => {
    const workflow = buildWorkflow(['opened']);
    const version = readWorkflowVersion(workflow);
    expect(version).not.toBeNull();
    expect(workflow).toContain(`${WORKFLOW_VERSION_MARKER} ${version}`);
  });

  it('returns null for a workflow with no marker', () => {
    const noMarker = 'name: Some Other Workflow\non:\n  push: {}\njobs:\n  build: {}\n';
    expect(readWorkflowVersion(noMarker)).toBeNull();
  });
});

// ===========================================================================
// validateWorkflow — AC-3
// ===========================================================================

describe('validateWorkflow', () => {
  it('accepts the generated workflow', () => {
    const result = validateWorkflow(buildWorkflow(['opened', 'synchronize']));
    expect(result).toEqual({ valid: true, error: null });
  });

  it('rejects unparsable YAML with a non-empty reason', () => {
    const result = validateWorkflow('on: [opened\n  bad: - - -');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error!.length).toBeGreaterThan(0);
  });

  it('rejects a scalar document (not a mapping) with a non-empty reason', () => {
    const result = validateWorkflow('just a plain string');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error!.length).toBeGreaterThan(0);
  });

  it('rejects a document with no "jobs" with a non-empty reason', () => {
    const result = validateWorkflow('name: no jobs here\non:\n  pull_request: {}\n');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error!.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// expectedSecrets — AC-4
// ===========================================================================

describe('expectedSecrets', () => {
  it('reports OPENROUTER_API_KEY as not platform-provided and GITHUB_TOKEN as platform-provided', () => {
    const secrets = expectedSecrets(buildWorkflow(['opened']));
    const byKey = Object.fromEntries(secrets.map((s) => [s.key, s.provided_by_platform]));
    expect(byKey[SECRET_MODEL_KEY]).toBe(false);
    expect(byKey[SECRET_GITHUB_TOKEN]).toBe(true);
  });
});

// ===========================================================================
// uniqueSlugs — dedup order
// ===========================================================================

describe('uniqueSlugs', () => {
  it('returns two distinct slugs, in input order, for names that collide only by case', () => {
    const slugs = uniqueSlugs(['Secret Leak Gate', 'secret leak gate']);
    expect(slugs).toHaveLength(2);
    expect(slugs[0]).not.toBe(slugs[1]);
    expect(slugs[0]).toBe('secret-leak-gate');
    expect(slugs[1]).toBe('secret-leak-gate-2');
  });
});

// ===========================================================================
// AC-13 — no generated file ever carries an actual secret VALUE; every
// secret is referenced only through the `${{ secrets.NAME }}` interpolation.
// ===========================================================================

describe('AC-13: secret values never leak into generated files', () => {
  // A realistic scenario: the real OPENROUTER_API_KEY/GITHUB_TOKEN values are
  // present in the process environment (as they would be on a real dev box —
  // this is exactly what server/insights.md 2026-08-17 warns can leak into a
  // network call if an adapter isn't mocked), AND the agent's own
  // system prompt legitimately DISCUSSES those secret NAMES (a security
  // reviewer agent's prompt plausibly says so) — but never the raw values.
  const FAKE_OPENROUTER_VALUE = 'sk-or-v1-FAKE0123456789abcdef0123456789abcdef';
  const FAKE_GITHUB_VALUE = 'ghp_FAKEabcdefghijklmnopqrstuvwxyz012345';

  it('buildManifest + serializeManifest + buildWorkflow never emit the actual secret values, and every workflow secret reference is a ${{ secrets.NAME }} interpolation', () => {
    const originalOpenrouter = process.env.OPENROUTER_API_KEY;
    const originalGithub = process.env.GITHUB_TOKEN;
    process.env.OPENROUTER_API_KEY = FAKE_OPENROUTER_VALUE;
    process.env.GITHUB_TOKEN = FAKE_GITHUB_VALUE;
    try {
      const agent = agentFixture({
        systemPrompt:
          'You are a reviewer. Flag any diff that hardcodes OPENROUTER_API_KEY or GITHUB_TOKEN instead of reading them from secrets.',
      });
      const manifest = buildManifest({ agent, skillSlugs: ['sec-basics'], postAs: 'github_review' });
      const manifestYaml = serializeManifest(manifest);
      const skillBody =
        '## Rule\nNever print OPENROUTER_API_KEY or GITHUB_TOKEN — always read them from secrets.';
      const workflow = buildWorkflow(['opened', 'synchronize']);

      for (const [label, content] of [
        ['manifest', manifestYaml],
        ['skill', skillBody],
        ['workflow', workflow],
      ] as const) {
        expect(content, `${label} must not contain the raw OPENROUTER_API_KEY value`).not.toContain(
          FAKE_OPENROUTER_VALUE,
        );
        expect(content, `${label} must not contain the raw GITHUB_TOKEN value`).not.toContain(
          FAKE_GITHUB_VALUE,
        );
      }

      // Every place the workflow references either secret is the
      // `${{ secrets.NAME }}` interpolation form — never a bare `secrets.NAME`
      // (missing `${{ }}`) and never the value itself.
      const secretMentions = [...workflow.matchAll(/secrets\.[A-Z0-9_]+/g)].map((m) => m[0]);
      expect(secretMentions.length).toBeGreaterThan(0);
      for (const mention of secretMentions) {
        const idx = workflow.indexOf(mention);
        const surrounding = workflow.slice(Math.max(0, idx - 4), idx + mention.length + 4);
        expect(surrounding).toContain('${{');
        expect(surrounding).toContain('}}');
      }
    } finally {
      if (originalOpenrouter === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = originalOpenrouter;
      if (originalGithub === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = originalGithub;
    }
  });
});
