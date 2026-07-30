import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';

/**
 * Severity findings counters (client spec 0001 / server spec 0001):
 *  - GET /repos/:id/pulls exposes `findings_by_severity` per PR, tallied from
 *    the LATEST review's undismissed findings only.
 *  - GET /pulls/:id/runs exposes `warning_count`/`suggestion_count` per run,
 *    alongside the existing `blockers` (already the CRITICAL count).
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** One CRITICAL, two WARNING, one SUGGESTION — all grounded on the added line. */
const MIXED_SEVERITY_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Mixed severities.',
  score: 40,
  findings: [
    {
      id: 'f-crit',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      confidence: 0.95,
      kind: 'finding',
    },
    {
      id: 'f-warn-1',
      severity: 'WARNING',
      category: 'bug',
      title: 'First warning',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A warning-level issue.',
      confidence: 0.8,
      kind: 'finding',
    },
    {
      id: 'f-warn-2',
      severity: 'WARNING',
      category: 'style',
      title: 'Second warning',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'Another warning-level issue.',
      confidence: 0.7,
      kind: 'finding',
    },
    {
      id: 'f-sugg',
      severity: 'SUGGESTION',
      category: 'style',
      title: 'A suggestion',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A minor style suggestion.',
      confidence: 0.6,
      kind: 'finding',
    },
  ],
};

async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string, seq: number) {
  const name = `severity-counts-${seq}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 100 + seq,
      title: 'Mixed severity PR',
      author: 'marisa.koch',
      branch: 'feat/mixed',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

d('severity findings counters (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith(structured: unknown) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: new MockLLMProvider('openai', { structured }) },
      },
    });
  }

  it('tallies findings_by_severity on the PR list and warning_count/suggestion_count on the run, excluding dismissed findings from the list only', async () => {
    const app = await appWith(MIXED_SEVERITY_FIXTURE);
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId, seq++);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Mixed', provider: 'openai', model: 'gpt-4.1', system_prompt: 'x' },
      })
    ).json();

    const run = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = run.json().runs[0].run_id;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    // ---- Per-run breakdown (PR-detail timeline row) ------------------------
    const runsRes = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/runs` })
    ).json();
    const runRow = runsRes.find((r: { run_id: string }) => r.run_id === runId);
    expect(runRow.blockers).toBe(1); // CRITICAL count (default ci_fail_on: 'critical')
    expect(runRow.warning_count).toBe(2);
    expect(runRow.suggestion_count).toBe(1);

    // ---- PR-list rollup (findings_by_severity) ------------------------------
    const listBefore = (
      await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })
    ).json();
    const prMetaBefore = listBefore.find((p: { number: number }) => p.number === pr.number);
    expect(prMetaBefore.findings_by_severity).toEqual({ critical: 1, warning: 2, suggestion: 1 });

    // ---- Dismissing a finding excludes it from the list rollup --------------
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    const warnFinding = reviews[0].findings.find(
      (f: { title: string }) => f.title === 'First warning',
    );
    await app.inject({ method: 'POST', url: `/findings/${warnFinding.id}/dismiss` });

    const listAfter = (
      await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })
    ).json();
    const prMetaAfter = listAfter.find((p: { number: number }) => p.number === pr.number);
    expect(prMetaAfter.findings_by_severity).toEqual({ critical: 1, warning: 1, suggestion: 1 });

    await app.close();
  });

  it('findings_by_severity is null for a PR with no review yet', async () => {
    const app = await appWith(MIXED_SEVERITY_FIXTURE);
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId, seq++);

    const listRes = (
      await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })
    ).json();
    const prMeta = listRes.find((p: { number: number }) => p.number === pr.number);
    expect(prMeta.findings_by_severity).toBeNull();

    await app.close();
  });
});
