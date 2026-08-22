/**
 * T30 / D29 — route-level integration tests for the eval module's READ
 * surfaces, over a real Postgres (testcontainers). `secrets: new
 * MockSecretsProvider()` keeps every adapter resolved through
 * `SecretsProvider` from reaching the real network; no path exercised here
 * makes a model call, so the `llm` override is a provider that throws
 * loudly if anything ever calls it.
 *
 * SPEC-04 delta (D29): `GET /eval-runs` retires its completed-only filter —
 * a run of ANY status appears (AC-62). `GET /eval-agents` is new (AC-63,
 * AC-4). `eval_dashboard_lists_completed_runs_newest_first` and
 * `eval_agent_surface_returns_cases_and_run_history` are renamed, not kept
 * verbatim, because both names assert something SPEC-04 no longer promises
 * (a completed-only feed; a run history rendered off this same surface) —
 * see the plan's Retirement traceability table.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { LLMProvider, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[eval-routes] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const NEVER_CALLED_LLM: LLMProvider = {
  id: 'openai',
  async completeStructured<T>(_req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    throw new Error('eval-routes.it.test.ts: no read path here should ever call the model');
  },
  async listModels() {
    return [];
  },
  async complete() {
    throw new Error('not used in these tests');
  },
  async embed() {
    return [];
  },
};

const CONFIG_PATCH = [
  '@@ -9,3 +9,7 @@',
  ' const config = {',
  '   port: process.env.PORT || 3000,',
  "   apiVersion: 'v2',",
  "+  stripeSecretKey: 'sk_live_51Hxxxxxxxxxxxxxxxxxxxxxxxx',",
].join('\n');

d('modules/eval — read routes (Postgres)', () => {
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

  function appWith() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { secrets: new MockSecretsProvider(), llm: { openai: NEVER_CALLED_LLM } },
    });
  }

  async function createAgent(app: Awaited<ReturnType<typeof buildApp>>, over: Record<string, unknown> = {}) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: `agent-${Math.random().toString(36).slice(2, 8)}`,
        provider: 'openai',
        model: 'gpt-4o-mini',
        system_prompt: 'Review the diff.',
        ...over,
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string };
  }

  async function insertAgentDirect(ws: string) {
    const [row] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: ws,
        name: `direct-agent-${seq++}`,
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: 'Review.',
      })
      .returning();
    return row!;
  }

  async function createCaseFor(app: Awaited<ReturnType<typeof buildApp>>, agentId: string, name: string) {
    const n = seq++;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: `route-repo-${n}`, fullName: `acme/route-repo-${n}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 4000 + n,
        title: 'Change',
        author: 'tester',
        branch: `feat/${n}`,
        base: 'main',
        headSha: `sha-${n}`,
        additions: 4,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    await pg.handle.db
      .insert(t.prFiles)
      .values({ prId: pr!.id, path: 'src/config.ts', additions: 4, deletions: 0, patch: CONFIG_PATCH });
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        agentId,
        kind: 'review',
        verdict: 'request_changes',
        summary: 'seeded',
        score: 50,
        model: 'seed',
      })
      .returning();
    const [finding] = await pg.handle.db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'A finding',
        rationale: 'rationale',
        confidence: 0.9,
        acceptedAt: new Date(),
      })
      .returning();

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/eval-cases`,
      payload: { finding_id: finding!.id, name },
    });
    expect(res.statusCode).toBe(201);
    return { case: res.json() as { id: string }, finding: finding! };
  }

  async function insertSuiteRun(
    ws: string,
    agentId: string,
    opts: {
      status: 'running' | 'completed' | 'failed';
      startedAt: Date;
      recall?: number | null;
      precision?: number | null;
      citationAccuracy?: number | null;
      costUsd?: number | null;
    },
  ) {
    const [row] = await pg.handle.db
      .insert(t.evalSuiteRuns)
      .values({
        workspaceId: ws,
        agentId,
        agentVersion: 1,
        status: opts.status,
        startedAt: opts.startedAt,
        completedAt: opts.status === 'running' ? null : opts.startedAt,
        casesTotal: 1,
        casesCompleted: opts.status === 'running' ? 0 : 1,
        casesPassed: opts.status === 'completed' ? 1 : null,
        casesFailedToComplete: 0,
        recall: opts.recall ?? null,
        precision: opts.precision ?? null,
        citationAccuracy: opts.citationAccuracy ?? null,
        costUsd: opts.costUsd ?? null,
      })
      .returning();
    return row!;
  }

  it('eval_agent_endpoints_return_cases_and_runs', async () => {
    const app = await appWith();
    const agent = await createAgent(app);
    await createCaseFor(app, agent.id, 'the only case');
    await insertSuiteRun(workspaceId, agent.id, { status: 'completed', startedAt: new Date(), recall: 1 });

    const casesRes = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` });
    expect(casesRes.statusCode).toBe(200);
    const cases = casesRes.json() as { name: string }[];
    expect(cases.map((c) => c.name)).toContain('the only case');

    const runsRes = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-runs` });
    expect(runsRes.statusCode).toBe(200);
    const runs = runsRes.json() as { status: string; recall: number | null }[];
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('completed');
    expect(runs[0]!.recall).toBe(1);
    await app.close();
  });

  it('eval_agent_with_no_completed_run_has_no_metrics', async () => {
    const app = await appWith();

    // Case A: no run at all.
    const agentNoRuns = await createAgent(app);
    const noRunsRes = await app.inject({ method: 'GET', url: `/agents/${agentNoRuns.id}/eval-runs` });
    expect(noRunsRes.statusCode).toBe(200);
    expect(noRunsRes.json()).toEqual([]);

    // Case B: a run that exists but is still `running` — its metrics are
    // `null`, never `0`.
    const agentRunning = await createAgent(app);
    await insertSuiteRun(workspaceId, agentRunning.id, { status: 'running', startedAt: new Date() });
    const runningRes = await app.inject({ method: 'GET', url: `/agents/${agentRunning.id}/eval-runs` });
    expect(runningRes.statusCode).toBe(200);
    const runningRuns = runningRes.json() as { status: string; recall: null; precision: null; citation_accuracy: null }[];
    expect(runningRuns).toHaveLength(1);
    expect(runningRuns[0]!.status).toBe('running');
    expect(runningRuns[0]!.recall).toBeNull();
    expect(runningRuns[0]!.precision).toBeNull();
    expect(runningRuns[0]!.citation_accuracy).toBeNull();
    await app.close();
  });

  it('eval_dashboard_endpoint_lists_every_run_newest_first', async () => {
    // SPEC-04 retires the completed-only filter (AC-62) — this is the
    // assertion the OLD filter would fail: a `running` run and a `failed`
    // run both appear, alongside a `completed` one, newest first.
    const app = await appWith();
    const agentA = await createAgent(app);
    const agentB = await createAgent(app);
    const agentC = await createAgent(app);

    const oldest = await insertSuiteRun(workspaceId, agentA.id, {
      status: 'completed',
      startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      recall: 0.5,
    });
    const middle = await insertSuiteRun(workspaceId, agentB.id, {
      status: 'failed',
      startedAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    const newest = await insertSuiteRun(workspaceId, agentC.id, {
      status: 'running',
      startedAt: new Date(),
    });

    // Another workspace's run must never leak into this list.
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'other-eval-ws' }).returning();
    const otherAgent = await insertAgentDirect(otherWs!.id);
    await insertSuiteRun(otherWs!.id, otherAgent.id, { status: 'completed', startedAt: new Date() });

    const res = await app.inject({ method: 'GET', url: '/eval-runs?limit=10' });
    expect(res.statusCode).toBe(200);
    const runs = res.json() as { id: string; status: string }[];
    const statuses = new Set(runs.map((r) => r.status));
    expect(statuses.has('completed')).toBe(true);
    expect(statuses.has('failed')).toBe(true);
    expect(statuses.has('running')).toBe(true);

    const ids = runs.map((r) => r.id);
    expect(ids.indexOf(newest.id)).toBeLessThan(ids.indexOf(middle.id));
    expect(ids.indexOf(middle.id)).toBeLessThan(ids.indexOf(oldest.id));
    expect(ids).not.toContain(otherAgent.id);
    await app.close();
  });

  it('eval_agent_summaries_return_each_agents_latest_run', async () => {
    const app = await appWith();
    const agentWithRuns = await createAgent(app);
    const agentNeverRun = await createAgent(app);

    await insertSuiteRun(workspaceId, agentWithRuns.id, {
      status: 'completed',
      startedAt: new Date(Date.now() - 60 * 60 * 1000),
      recall: 0.5,
    });
    const latest = await insertSuiteRun(workspaceId, agentWithRuns.id, {
      status: 'completed',
      startedAt: new Date(),
      recall: 0.9,
    });

    // Another workspace's agent/run must never leak into this list.
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'other-eval-agents-ws' }).returning();
    const otherAgent = await insertAgentDirect(otherWs!.id);
    await insertSuiteRun(otherWs!.id, otherAgent.id, { status: 'completed', startedAt: new Date() });

    const res = await app.inject({ method: 'GET', url: '/eval-agents' });
    expect(res.statusCode).toBe(200);
    const summaries = res.json() as {
      agent_id: string;
      agent_name: string;
      latest_run: { id: string } | null;
    }[];
    const ids = summaries.map((s) => s.agent_id);
    expect(ids).not.toContain(otherAgent.id);

    // The agent with two runs shows its MOST RECENT one, not the older one.
    const withRuns = summaries.find((s) => s.agent_id === agentWithRuns.id);
    expect(withRuns).toBeDefined();
    expect(withRuns!.latest_run).not.toBeNull();
    expect(withRuns!.latest_run!.id).toBe(latest.id);

    // The never-run agent still gets a row — `null`, not omitted (AC-4).
    const neverRun = summaries.find((s) => s.agent_id === agentNeverRun.id);
    expect(neverRun).toBeDefined();
    expect(neverRun!.latest_run).toBeNull();
    await app.close();
  });

  it('404s every eval path for a case/run/agent belonging to another workspace', async () => {
    const app = await appWith();
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'other-eval-ws-404' }).returning();
    const otherAgent = await insertAgentDirect(otherWs!.id);

    // Build a real case + run in the OTHER workspace directly (bypassing the
    // route layer, which would itself 404 from this workspace).
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: otherWs!.id, owner: 'acme', name: 'other-ws-repo', fullName: 'acme/other-ws-repo' })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: otherWs!.id,
        repoId: repo!.id,
        number: 9001,
        title: 'x',
        author: 'tester',
        branch: 'b',
        base: 'main',
        headSha: 'sha',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    await pg.handle.db
      .insert(t.prFiles)
      .values({ prId: pr!.id, path: 'src/config.ts', additions: 4, deletions: 0, patch: CONFIG_PATCH });
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId: otherWs!.id,
        prId: pr!.id,
        agentId: otherAgent.id,
        kind: 'review',
        verdict: 'request_changes',
        summary: 's',
        score: 50,
        model: 'seed',
      })
      .returning();
    const [finding] = await pg.handle.db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'x',
        rationale: 'x',
        confidence: 0.9,
        acceptedAt: new Date(),
      })
      .returning();
    const [otherCase] = await pg.handle.db
      .insert(t.evalCases)
      .values({
        workspaceId: otherWs!.id,
        ownerKind: 'agent',
        ownerId: otherAgent.id,
        name: 'other-ws-case',
        inputDiff: CONFIG_PATCH,
        sourceFindingId: finding!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
      })
      .returning();
    const otherRun = await insertSuiteRun(otherWs!.id, otherAgent.id, {
      status: 'completed',
      startedAt: new Date(),
    });

    expect(
      (await app.inject({ method: 'GET', url: `/findings/${finding!.id}/eval-case-draft` })).statusCode,
    ).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/agents/${otherAgent.id}/eval-cases` })).statusCode).toBe(
      404,
    );
    expect((await app.inject({ method: 'GET', url: `/agents/${otherAgent.id}/eval-runs` })).statusCode).toBe(
      404,
    );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/agents/${otherAgent.id}/eval-cases`,
          payload: { finding_id: randomUUID(), name: 'x' },
        })
      ).statusCode,
    ).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/agents/${otherAgent.id}/eval-runs` })).statusCode).toBe(
      404,
    );
    expect(
      (await app.inject({ method: 'PUT', url: `/eval-cases/${otherCase!.id}`, payload: { name: 'x' } })).statusCode,
    ).toBe(404);
    // The new verify route (D10) is covered by the same sweep — a case
    // belonging to another workspace 404s, and (since it 404s before ever
    // reaching `invokeCase`) never touches the throwing `NEVER_CALLED_LLM`.
    expect(
      (await app.inject({ method: 'POST', url: `/eval-cases/${otherCase!.id}/verify` })).statusCode,
    ).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/eval-cases/${otherCase!.id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/eval-runs/${otherRun.id}` })).statusCode).toBe(404);
    await app.close();
  });
});
