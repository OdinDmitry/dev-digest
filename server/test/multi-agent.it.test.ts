import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { Review } from '@devdigest/shared';

/**
 * A5 multi-agent review — DB-backed (Testcontainers). Covers AC-2, AC-6,
 * AC-7, AC-8, AC-11, AC-13, AC-14. Follows `reviews.it.test.ts:104-138`'s
 * `appWith` shape (MockSecretsProvider, MockGitClient, mocked llm), plus
 * `waitForPrRuns` to await the fire-and-forget background execution.
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

const OPENAI_REVIEW: Review = {
  verdict: 'comment',
  summary: 'From the openai agent',
  score: 88,
  findings: [
    {
      id: 'f-openai',
      severity: 'WARNING',
      category: 'bug',
      title: 'openai finding',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'because',
      confidence: 0.8,
      kind: 'finding',
    },
  ],
};

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `multi-agent-repo-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 482,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Add rate limiting.',
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

d('A5 multi-agent review (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  /**
   * `llm.anthropic` is deliberately NOT injected in most tests here — any
   * agent whose provider is 'anthropic' hits the real key lookup against an
   * empty MockSecretsProvider and fails with ConfigError. This is used
   * on purpose for AC-11 (an unconfigured provider produces a `failed`
   * column) and avoided (by only creating 'openai' agents) everywhere else.
   */
  function appWith(overrides: Parameters<typeof buildApp>[0]['overrides'] = {}) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        secrets: new MockSecretsProvider(),
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: new MockLLMProvider('openai', { structured: OPENAI_REVIEW }) },
        ...overrides,
      },
    });
  }

  async function createAgent(app: Awaited<ReturnType<typeof appWith>>, name: string, provider = 'openai') {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name, provider, model: `${provider}-model`, system_prompt: `You are ${name}.` },
    });
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  it('AC-2: rejects agent_ids: [] with 422 and creates no run', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agent_ids: [] },
    });
    // 422, not 400: `app.ts:115-119` maps every zod schema rejection to 422
    // ("Validation → 422"), and this route declares `body: MultiAgentRunRequest`
    // via the zod schema option. AC-2 requires only that the run not start.
    expect(res.statusCode).toBe(422);

    const runs = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, pr.id));
    expect(runs).toHaveLength(0);

    await app.close();
  });

  /**
   * Verification-gap coverage: `startMultiAgentReview` must not create the
   * `multi_agent_runs` group row (or dispatch any `agent_runs`) before the
   * workspace-scoped PR guard runs. A prId that doesn't exist, or belongs to
   * a different workspace, must 404 and leave the DB exactly as it was
   * before the request — not merely return the right status code with a
   * group row already written.
   */
  it('an unknown prId 404s and leaves no multi_agent_runs row behind', async () => {
    const app = await appWith();
    const agent = await createAgent(app, 'Solo Agent');

    const before = await pg.handle.db.select().from(t.multiAgentRuns);

    const unknownPrId = randomUUID();
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${unknownPrId}/multi-agent-run`,
      payload: { agent_ids: [agent.id] },
    });
    expect(res.statusCode).toBe(404);

    const after = await pg.handle.db.select().from(t.multiAgentRuns);
    expect(after).toHaveLength(before.length);

    const runs = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.agentId, agent.id));
    expect(runs).toHaveLength(0);

    await app.close();
  });

  it("a prId belonging to a different workspace 404s and leaves no multi_agent_runs row behind (and starts no agent_runs)", async () => {
    const app = await appWith();
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other-multi-agent-ws' })
      .returning();
    const { pr: otherPr } = await setupRepoAndPr(pg.handle.db, otherWs!.id);

    // Agent must be resolved in the REQUESTING workspace (the default one),
    // so this exercises the PR guard specifically, not agent resolution.
    const agent = await createAgent(app, 'Cross-Workspace Agent');

    const beforeGroups = await pg.handle.db.select().from(t.multiAgentRuns);

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${otherPr.id}/multi-agent-run`,
      payload: { agent_ids: [agent.id] },
    });
    expect(res.statusCode).toBe(404);

    const afterGroups = await pg.handle.db.select().from(t.multiAgentRuns);
    expect(afterGroups).toHaveLength(beforeGroups.length);
    // None of the (unchanged) group rows belong to the other workspace's PR.
    expect(afterGroups.every((g) => g.prId !== otherPr.id)).toBe(true);

    const runsForOtherPr = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.prId, otherPr.id));
    expect(runsForOtherPr).toHaveLength(0);

    await app.close();
  });

  it('AC-6: a 2-of-3 selection creates exactly two agent_runs rows carrying the new group id; the third agent has none', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agentA = await createAgent(app, 'Agent A');
    const agentB = await createAgent(app, 'Agent B');
    const agentC = await createAgent(app, 'Agent C');

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agent_ids: [agentA.id, agentB.id] },
    });
    expect(res.statusCode).toBe(200);
    const { multi_agent_run_id, runs } = res.json();
    expect(runs).toHaveLength(2);
    expect(multi_agent_run_id).toBeTruthy();

    await waitForPrRuns(pg.handle.db, pr.id, { expected: 2 });

    const allRuns = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, pr.id));
    expect(allRuns).toHaveLength(2);
    for (const run of allRuns) {
      expect(run.multiAgentRunId).toBe(multi_agent_run_id);
      expect([agentA.id, agentB.id]).toContain(run.agentId);
    }
    expect(allRuns.some((r) => r.agentId === agentC.id)).toBe(false);

    await app.close();
  });

  it('AC-11: one agent on an unconfigured provider fails with a non-empty error; the other stays done with its findings intact', async () => {
    // No `llm.anthropic` override — the anthropic agent's provider resolution
    // throws ConfigError('ANTHROPIC_API_KEY is not configured'), isolated to
    // its own run.
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const okAgent = await createAgent(app, 'OK Agent', 'openai');
    const brokenAgent = await createAgent(app, 'Broken Agent', 'anthropic');

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agent_ids: [okAgent.id, brokenAgent.id] },
    });
    expect(res.statusCode).toBe(200);
    const { multi_agent_run_id } = res.json();

    await waitForPrRuns(pg.handle.db, pr.id, { expected: 2 });

    const group = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/multi-agent` })
    ).json();
    expect(group.id).toBe(multi_agent_run_id);
    expect(group.columns).toHaveLength(2);

    const okColumn = group.columns.find((c: { agent_id: string }) => c.agent_id === okAgent.id);
    const brokenColumn = group.columns.find((c: { agent_id: string }) => c.agent_id === brokenAgent.id);

    expect(okColumn.status).toBe('done');
    expect(okColumn.findings).toHaveLength(1);
    expect(okColumn.findings[0].title).toBe('openai finding');

    expect(brokenColumn.status).toBe('failed');
    expect(typeof brokenColumn.error).toBe('string');
    expect(brokenColumn.error.length).toBeGreaterThan(0);

    await app.close();
  });

  it('AC-13: GET /pulls/:id/multi-agent returns the most recently started of two groups for the same PR', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agent1 = await createAgent(app, 'Group1 Agent');
    const agent2 = await createAgent(app, 'Group2 Agent');

    const firstGroup = (
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agent_ids: [agent1.id] },
      })
    ).json();
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    // Force the second group's `ran_at` strictly after the first's, in case
    // both inserts land in the same DB clock tick.
    await pg.handle.db
      .update(t.multiAgentRuns)
      .set({ ranAt: new Date(Date.now() - 60_000) })
      .where(eq(t.multiAgentRuns.id, firstGroup.multi_agent_run_id));

    const secondGroup = (
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agent_ids: [agent2.id] },
      })
    ).json();
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 2 });

    const latest = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/multi-agent` })
    ).json();

    expect(latest.id).toBe(secondGroup.multi_agent_run_id);
    expect(latest.id).not.toBe(firstGroup.multi_agent_run_id);
    expect(latest.columns.map((c: { agent_id: string }) => c.agent_id)).toEqual([agent2.id]);

    await app.close();
  });

  it('AC-14: a regression fixture in the OLD agent_runs shape (multi_agent_run_id + finished_at both NULL) is not adopted into a group', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = await createAgent(app, 'Legacy Agent');

    // Exactly what every pre-L07 row on disk looks like: no multi_agent_runs
    // group row exists, and the agent_runs row itself carries neither a group
    // id nor a finished_at.
    await pg.handle.db.insert(t.agentRuns).values({
      workspaceId,
      agentId: agent.id,
      prId: pr.id,
      provider: 'openai',
      model: 'openai-model',
      status: 'done',
      durationMs: 500,
      multiAgentRunId: null,
      finishedAt: null,
    });

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/multi-agent` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();

    await app.close();
  });

  it('AC-7/AC-8: GET /agents/estimates uses each agent\'s most recent successful run, ignoring later failures and returning nulls for an all-failed agent', async () => {
    const app = await appWith();

    const cheapThenExpensive = await createAgent(app, 'Cheap Then Expensive');
    const allFailed = await createAgent(app, 'All Failed');
    const successNoCost = await createAgent(app, 'Success No Cost');

    const now = Date.now();

    // cheapThenExpensive: an OLDER cheap success, then a NEWER expensive
    // success, then a LATER failed run (durationMs: 0, costUsd: null) that
    // must be ignored entirely.
    await pg.handle.db.insert(t.agentRuns).values([
      {
        workspaceId,
        agentId: cheapThenExpensive.id,
        provider: 'openai',
        model: 'm',
        status: 'done',
        durationMs: 1000,
        costUsd: 0.01,
        ranAt: new Date(now - 3 * 60_000),
      },
      {
        workspaceId,
        agentId: cheapThenExpensive.id,
        provider: 'openai',
        model: 'm',
        status: 'done',
        durationMs: 9000,
        costUsd: 0.5,
        ranAt: new Date(now - 2 * 60_000),
      },
      {
        workspaceId,
        agentId: cheapThenExpensive.id,
        provider: 'openai',
        model: 'm',
        status: 'failed',
        durationMs: 0,
        costUsd: null,
        error: 'boom',
        ranAt: new Date(now - 60_000),
      },
      // allFailed: only ever failed — must resolve to null/null.
      {
        workspaceId,
        agentId: allFailed.id,
        provider: 'openai',
        model: 'm',
        status: 'failed',
        durationMs: 0,
        costUsd: null,
        error: 'boom',
        ranAt: new Date(now - 60_000),
      },
      // successNoCost: one success that recorded a duration but no cost.
      {
        workspaceId,
        agentId: successNoCost.id,
        provider: 'openai',
        model: 'm',
        status: 'done',
        durationMs: 4200,
        costUsd: null,
        ranAt: new Date(now - 60_000),
      },
    ]);

    const estimates = (await app.inject({ method: 'GET', url: '/agents/estimates' })).json();

    const byAgentId = new Map(estimates.map((e: { agent_id: string }) => [e.agent_id, e]));

    const cheapExpensive = byAgentId.get(cheapThenExpensive.id) as { duration_ms: number; cost_usd: number };
    expect(cheapExpensive.duration_ms).toBe(9000);
    expect(cheapExpensive.cost_usd).toBe(0.5);

    const failedOnly = byAgentId.get(allFailed.id) as { duration_ms: number | null; cost_usd: number | null };
    expect(failedOnly.duration_ms).toBeNull();
    expect(failedOnly.cost_usd).toBeNull();

    const noCost = byAgentId.get(successNoCost.id) as { duration_ms: number | null; cost_usd: number | null };
    expect(noCost.duration_ms).toBe(4200);
    expect(noCost.cost_usd).toBeNull();

    await app.close();
  });
});
