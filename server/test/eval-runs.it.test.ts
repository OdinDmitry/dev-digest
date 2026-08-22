/**
 * `modules/evals` suite runs over a real Postgres
 * (`docs/plans/2026-08-22-eval-pipeline-b-suite-runs.md` T19). Covers AC-21,
 * AC-23, AC-27, AC-28, AC-29, AC-30, AC-31, AC-33, AC-34, AC-35, AC-36.
 *
 * `appWith` carries BOTH `secrets: new MockSecretsProvider()` (constraint
 * 8 — no adapter resolved through SecretsProvider may reach the real
 * network, `server/insights.md` Recurring Errors 2026-08-05) and a
 * hand-rolled `LLMProvider` keyed for the seeded agent's own provider
 * ('openai' throughout this file). No test here asserts how many eval
 * cases exist anywhere — the plan forbids a case-count assertion.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { LLMProvider, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForEvalRun } from './helpers/eval-runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[eval-runs] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** A unified diff touching src/config.ts (line 11 added) — every eval case
 *  in this file cites within this diff so grounding never silently drops
 *  the fixture finding a "passing" step is meant to produce. */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const CLEAN_REVIEW = { verdict: 'approve' as const, summary: 'Clean.', score: 100, findings: [] };

function findingReview(overrides: { file?: string; line?: number } = {}) {
  const file = overrides.file ?? 'src/config.ts';
  const line = overrides.line ?? 11;
  return {
    verdict: 'request_changes' as const,
    summary: 'Found an issue.',
    score: 60,
    findings: [
      {
        id: `f-${file}-${line}`,
        severity: 'CRITICAL' as const,
        category: 'security' as const,
        title: 'An issue',
        file,
        start_line: line,
        end_line: line,
        rationale: 'r',
        suggestion: null,
        confidence: 0.9,
        kind: 'finding' as const,
      },
    ],
  };
}

/**
 * A hand-rolled counting `LLMProvider` — one fixture per expected call, IN
 * ORDER (mirrors `test/brief.it.test.ts`'s `makeMockLLM`). `'ERROR'` makes
 * that specific call throw (AC-27/AC-28/AC-29); an OPTIONAL `delayMs` holds
 * every call open long enough to make "a run is still active" assertable
 * (AC-23) without a real network round trip's non-determinism.
 */
function makeMockLLM(
  steps: (Record<string, unknown> | 'ERROR')[],
  opts: { delayMs?: number } = {},
): LLMProvider {
  let i = 0;
  return {
    id: 'openai',
    async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (i >= steps.length) {
        throw new Error(`unexpected extra model call #${i + 1} (schema ${req.schemaName})`);
      }
      const step = steps[i]!;
      i++;
      if (step === 'ERROR') throw new Error('mock model call failed');
      const parsed = req.schema.safeParse(step);
      if (!parsed.success) {
        throw new Error(`mock fixture did not match schema ${req.schemaName}: ${parsed.error.message}`);
      }
      return {
        data: parsed.data,
        model: req.model,
        tokensIn: 10,
        tokensOut: 5,
        costUsd: 0.001,
        raw: JSON.stringify(step),
        attempts: 1,
      };
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
}

d('modules/evals — suite runs (Postgres)', () => {
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

  function appWith(llm: LLMProvider) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        secrets: new MockSecretsProvider(),
        llm: { openai: llm },
      },
    });
  }

  async function createAgent(app: Awaited<ReturnType<typeof appWith>>) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: `eval-runs-agent-${seq++}`,
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: 'Review the diff.',
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string };
  }

  async function createCase(
    app: Awaited<ReturnType<typeof appWith>>,
    agentId: string,
    expectation: { kind: 'must_find' | 'must_not_flag'; file?: string; start_line?: number; end_line?: number },
  ) {
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/eval-cases`,
      payload: {
        name: `case-${seq++}`,
        input_diff: DIFF,
        repo_id: null,
        expectations: [
          {
            kind: expectation.kind,
            file: expectation.file ?? 'src/config.ts',
            start_line: expectation.start_line ?? 11,
            end_line: expectation.end_line ?? 11,
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    return res.json() as { id: string; name: string };
  }

  it(
    "POST /agents/:id/eval-runs returns state 'pending' before any case is evaluated (AC-21), a concurrent second POST 409s while it is active (AC-23), and the run completes with recall/precision/citation_accuracy and per_trace persisted (AC-36)",
    async () => {
      const llm = makeMockLLM([findingReview()], { delayMs: 500 });
      const app = await appWith(llm);
      const agent = await createAgent(app);
      const kase = await createCase(app, agent.id, { kind: 'must_find' });

      const res1 = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
      expect(res1.statusCode).toBe(201);
      const run1 = res1.json();
      // AC-21 — pending BEFORE any case has been evaluated (the slow LLM
      // guarantees `execute`'s first case hasn't resolved yet).
      expect(run1.state).toBe('pending');
      expect(run1.traces_total).toBe(1);

      // AC-23 — fired immediately after, while run1 is still active.
      const res2 = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
      expect(res2.statusCode).toBe(409);
      expect(res2.json().error.code).toBe('eval_run_active');

      const completed = await waitForEvalRun(app, run1.id);
      expect(completed.state).toBe('completed');
      expect(completed.recall).toBe(1);
      expect(completed.precision).toBe(1);
      expect(completed.citation_accuracy).toBe(1);
      expect(completed.traces_passed).toBe(1);
      expect(completed.traces_total).toBe(1);
      expect(completed.per_trace).toHaveLength(1);
      expect(completed.per_trace[0]!.case_id).toBe(kase.id);
      expect(completed.per_trace[0]!.status).toBe('passed');
      expect(completed.per_trace[0]!.stored).toBe(true);

      await app.close();
    },
    30_000,
  );

  it('a case created AFTER a run started is absent from that run\'s per_trace (AC-30)', async () => {
    const llm = makeMockLLM([CLEAN_REVIEW]);
    const app = await appWith(llm);
    const agent = await createAgent(app);
    const caseA = await createCase(app, agent.id, { kind: 'must_not_flag' });

    const started = (
      await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` })
    ).json();
    const completed = await waitForEvalRun(app, started.id);
    expect(completed.state).toBe('completed');

    // Created only AFTER the run above started (and finished).
    await createCase(app, agent.id, { kind: 'must_not_flag' });

    const reread = (
      await app.inject({ method: 'GET', url: `/eval-runs/${started.id}` })
    ).json();
    expect(reread.per_trace).toHaveLength(1);
    expect(reread.per_trace[0].case_id).toBe(caseA.id);

    await app.close();
  });

  it('one case whose LLM call throws leaves the other cases evaluated (AC-27) and records that case errored, not passed (AC-28)', async () => {
    const llm = makeMockLLM([CLEAN_REVIEW, 'ERROR', CLEAN_REVIEW]);
    const app = await appWith(llm);
    const agent = await createAgent(app);
    const caseA = await createCase(app, agent.id, { kind: 'must_not_flag' });
    const caseB = await createCase(app, agent.id, { kind: 'must_not_flag' });
    const caseC = await createCase(app, agent.id, { kind: 'must_not_flag' });

    const started = (
      await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` })
    ).json();
    const completed = await waitForEvalRun(app, started.id);

    // Not every case errored — the run completes, it does not fail.
    expect(completed.state).toBe('completed');
    expect(completed.errored_count).toBe(1);
    const byCaseId = new Map(completed.per_trace.map((r: { case_id: string }) => [r.case_id, r]));

    expect(byCaseId.get(caseA.id)?.status).toBe('passed');
    const errored = byCaseId.get(caseB.id);
    expect(errored?.status).toBe('errored');
    expect(errored?.pass).toBe(false);
    expect(errored?.errored).toBe(true);
    expect(typeof errored?.error).toBe('string');
    expect(byCaseId.get(caseC.id)?.status).toBe('passed');

    await app.close();
  });

  it('a run whose EVERY case throws ends failed, with recall/precision/citation_accuracy all null (AC-29)', async () => {
    const llm = makeMockLLM(['ERROR', 'ERROR']);
    const app = await appWith(llm);
    const agent = await createAgent(app);
    await createCase(app, agent.id, { kind: 'must_not_flag' });
    await createCase(app, agent.id, { kind: 'must_not_flag' });

    const started = (
      await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` })
    ).json();
    const completed = await waitForEvalRun(app, started.id);

    expect(completed.state).toBe('failed');
    expect(completed.recall).toBeNull();
    expect(completed.precision).toBeNull();
    expect(completed.citation_accuracy).toBeNull();
    expect(completed.errored_count).toBe(2);

    await app.close();
  });

  it('POST /eval-cases/:id/preview returns stored: false and adds NO row to eval_suite_runs or eval_case_results (AC-33)', async () => {
    const llm = makeMockLLM([findingReview(), findingReview()]);
    const app = await appWith(llm);
    const agent = await createAgent(app);
    const kase = await createCase(app, agent.id, { kind: 'must_find' });

    const before = await pg.handle.db
      .select({ id: t.evalSuiteRuns.id })
      .from(t.evalSuiteRuns)
      .where(eq(t.evalSuiteRuns.agentId, agent.id));
    expect(before).toHaveLength(0);

    const res = await app.inject({ method: 'POST', url: `/eval-cases/${kase.id}/preview` });
    expect(res.statusCode).toBe(200);
    const preview = res.json();
    expect(preview.stored).toBe(false);
    expect(preview.case_id).toBe(kase.id);
    expect(preview.result.stored).toBe(false);
    expect(preview.result.status).toBe('passed');

    const afterRuns = await pg.handle.db
      .select({ id: t.evalSuiteRuns.id })
      .from(t.evalSuiteRuns)
      .where(eq(t.evalSuiteRuns.agentId, agent.id));
    expect(afterRuns).toHaveLength(0);

    const afterResults = await pg.handle.db
      .select({ id: t.evalCaseResults.id })
      .from(t.evalCaseResults)
      .where(eq(t.evalCaseResults.caseId, kase.id));
    expect(afterResults).toHaveLength(0);

    await app.close();
  });

  it('GET /agents/:id/eval-cases returns last_outcome from the most recent completed run, and null for a case no completed run included (AC-34)', async () => {
    const llm = makeMockLLM([CLEAN_REVIEW]);
    const app = await appWith(llm);
    const agent = await createAgent(app);
    const caseA = await createCase(app, agent.id, { kind: 'must_not_flag' });

    const started = (
      await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` })
    ).json();
    await waitForEvalRun(app, started.id);

    // Created after the only run for this agent — never covered.
    const caseB = await createCase(app, agent.id, { kind: 'must_not_flag' });

    const cases = (
      await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` })
    ).json();
    const dtoA = cases.find((c: { id: string }) => c.id === caseA.id);
    const dtoB = cases.find((c: { id: string }) => c.id === caseB.id);
    expect(dtoA.last_outcome).not.toBeNull();
    expect(dtoA.last_outcome.status).toBe('passed');
    expect(dtoB.last_outcome).toBeNull();

    await app.close();
  });

  it('the dashboard lists an agent with cases and no completed run as never_run (AC-35), and POST /evals/run-all starts a run for it (AC-31)', async () => {
    const llm = makeMockLLM([CLEAN_REVIEW]);
    const app = await appWith(llm);
    const agent = await createAgent(app);
    await createCase(app, agent.id, { kind: 'must_not_flag' });

    const dashboard = (
      await app.inject({ method: 'GET', url: '/evals/dashboard' })
    ).json();
    const entry = dashboard.agents.find((a: { agent_id: string }) => a.agent_id === agent.id);
    expect(entry).toBeDefined();
    expect(entry.never_run).toBe(true);
    expect(entry.running).toBe(false);
    expect(entry.cases_total).toBeGreaterThanOrEqual(1);

    const runAll = await app.inject({ method: 'POST', url: '/evals/run-all' });
    expect(runAll.statusCode).toBe(200);
    const runsBody = runAll.json();
    const ourRun = runsBody.runs.find((r: { agent_id: string }) => r.agent_id === agent.id);
    expect(ourRun).toBeDefined();
    expect(['pending', 'running']).toContain(ourRun.state);

    await waitForEvalRun(app, ourRun.id);
    await app.close();
  });

  it('a run for an agent in another workspace 404s', async () => {
    const llm = makeMockLLM([]);
    const app = await appWith(llm);
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-ws-${seq++}` })
      .returning();
    const [foreignAgent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: otherWs!.id,
        name: 'Foreign Agent',
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'x',
      })
      .returning();

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${foreignAgent!.id}/eval-runs`,
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  // ---- plan-verifier gap 1: AC-36/AC-38 at the LIST route (previously only
  // `metricDelta` itself was unit-tested; `GET /agents/:id/eval-runs` and its
  // `EvalService.listRuns` wiring were never invoked by any test) --------

  it(
    "GET /agents/:id/eval-runs lists an agent's completed suite runs newest-started-first, with delta null for the earliest run and populated for a later one (AC-36, AC-38 at the route)",
    async () => {
      const llm = makeMockLLM([CLEAN_REVIEW, CLEAN_REVIEW]);
      const app = await appWith(llm);
      const agent = await createAgent(app);
      await createCase(app, agent.id, { kind: 'must_not_flag' });

      const started1 = (
        await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` })
      ).json();
      await waitForEvalRun(app, started1.id);

      const started2 = (
        await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` })
      ).json();
      await waitForEvalRun(app, started2.id);

      const list = (
        await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-runs` })
      ).json();

      // This agent has exactly the two runs created above — a controlled
      // count of RUNS for a fresh agent, not an assertion about how many
      // eval cases exist.
      expect(list).toHaveLength(2);
      expect(list[0].id).toBe(started2.id);
      expect(list[1].id).toBe(started1.id);

      // AC-38 at the route — the earliest completed run has no predecessor.
      expect(list[1].delta).toBeNull();
      // Both runs used the identical CLEAN_REVIEW fixture over the same
      // must_not_flag case, so every metric is unchanged — a real, non-null
      // delta object of zeroes, distinct from the "no predecessor" null above.
      expect(list[0].delta).toEqual({ recall: 0, precision: 0, citation_accuracy: 0, cost_usd: 0 });

      await app.close();
    },
    30_000,
  );

  // ---- plan-verifier gap 2: AC-32's run_all counts, against real,
  // distinguishable data (previously only a static parse fixture in
  // eval-contracts.test.ts, which proves the shape parses, not the sum) ----

  it("the dashboard's run_all counts reflect only agents WITHOUT an active run, summed from their real case counts — an agent with zero cases never appears or contributes (AC-32)", async () => {
    const llm = makeMockLLM([]);
    const app = await appWith(llm);

    const before = (await app.inject({ method: 'GET', url: '/evals/dashboard' })).json();

    const agentWithTwo = await createAgent(app);
    await createCase(app, agentWithTwo.id, { kind: 'must_not_flag' });
    await createCase(app, agentWithTwo.id, { kind: 'must_not_flag' });

    const agentWithOne = await createAgent(app);
    await createCase(app, agentWithOne.id, { kind: 'must_not_flag' });

    // Zero eval cases — `dashboardRows` groups FROM eval_cases, so this
    // agent must never appear in `agents` and must never contribute to
    // run_all's counts.
    const agentWithNone = await createAgent(app);

    const after = (await app.inject({ method: 'GET', url: '/evals/dashboard' })).json();

    const entryTwo = after.agents.find((a: { agent_id: string }) => a.agent_id === agentWithTwo.id);
    const entryOne = after.agents.find((a: { agent_id: string }) => a.agent_id === agentWithOne.id);
    const entryNone = after.agents.find((a: { agent_id: string }) => a.agent_id === agentWithNone.id);
    expect(entryTwo?.cases_total).toBe(2);
    expect(entryOne?.cases_total).toBe(1);
    expect(entryNone).toBeUndefined();

    // Neither new agent has an active run, so run_all's DELTA against the
    // before-snapshot is exactly what these two contribute: 2 agents that
    // would really be started, 3 cases (2 + 1) between them — the zero-case
    // agent contributes to neither number. Asserted as a delta (not an
    // absolute value) so this holds regardless of what earlier tests in this
    // file already put in the shared workspace.
    expect(after.run_all.agent_count - before.run_all.agent_count).toBe(2);
    expect(after.run_all.case_count - before.run_all.case_count).toBe(3);

    await app.close();
  });

  // ---- plan-verifier gap 3: two routes never invoked by any test --------

  it(
    'GET /agents/:id/eval-runs/active returns the in-flight run while one is running, and null once none is active',
    async () => {
      const llm = makeMockLLM([CLEAN_REVIEW], { delayMs: 500 });
      const app = await appWith(llm);
      const agent = await createAgent(app);
      await createCase(app, agent.id, { kind: 'must_not_flag' });

      const started = (
        await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` })
      ).json();

      const activeRes = await app.inject({
        method: 'GET',
        url: `/agents/${agent.id}/eval-runs/active`,
      });
      expect(activeRes.statusCode).toBe(200);
      const active = activeRes.json();
      expect(active).not.toBeNull();
      expect(active.id).toBe(started.id);
      expect(['pending', 'running']).toContain(active.state);

      await waitForEvalRun(app, started.id);

      const afterRes = await app.inject({
        method: 'GET',
        url: `/agents/${agent.id}/eval-runs/active`,
      });
      expect(afterRes.statusCode).toBe(200);
      expect(afterRes.json()).toBeNull();

      await app.close();
    },
    30_000,
  );

  it(
    "GET /agents/:id/eval-compare returns a comparison for two real runs of the SAME agent, and 404s when the two run ids do not share an agent (compareRuns's cross-agent guard)",
    async () => {
      const llm = makeMockLLM([CLEAN_REVIEW, CLEAN_REVIEW, CLEAN_REVIEW]);
      const app = await appWith(llm);

      const agent1 = await createAgent(app);
      await createCase(app, agent1.id, { kind: 'must_not_flag' });
      const run1 = (
        await app.inject({ method: 'POST', url: `/agents/${agent1.id}/eval-runs` })
      ).json();
      await waitForEvalRun(app, run1.id);
      const run2 = (
        await app.inject({ method: 'POST', url: `/agents/${agent1.id}/eval-runs` })
      ).json();
      await waitForEvalRun(app, run2.id);

      const cmpRes = await app.inject({
        method: 'GET',
        url: `/agents/${agent1.id}/eval-compare?a=${run1.id}&b=${run2.id}`,
      });
      expect(cmpRes.statusCode).toBe(200);
      const cmp = cmpRes.json();
      expect(cmp.earlier.id).toBe(run1.id);
      expect(cmp.later.id).toBe(run2.id);

      // A second agent, with its own completed run.
      const agent2 = await createAgent(app);
      await createCase(app, agent2.id, { kind: 'must_not_flag' });
      const run3 = (
        await app.inject({ method: 'POST', url: `/agents/${agent2.id}/eval-runs` })
      ).json();
      await waitForEvalRun(app, run3.id);

      // Requested against agent1's :id, but run3 belongs to agent2 — the
      // cross-agent guard in `compareRuns` (service.ts:319-321) must reject
      // this rather than silently comparing runs from different agents.
      const crossRes = await app.inject({
        method: 'GET',
        url: `/agents/${agent1.id}/eval-compare?a=${run1.id}&b=${run3.id}`,
      });
      expect(crossRes.statusCode).toBe(404);

      await app.close();
    },
    30_000,
  );

  // ---- plan-verifier gap 4: AC-22 server half — zero eval cases -----------

  it('POST /agents/:id/eval-runs for an agent with ZERO eval cases rejects with 400 and writes no run row (AC-22 server half)', async () => {
    const llm = makeMockLLM([]);
    const app = await appWith(llm);
    const agent = await createAgent(app);
    // Deliberately no createCase call for this agent.

    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('no_eval_cases');
    expect(body.error.message).toMatch(/no eval cases/i);

    const rows = await pg.handle.db
      .select({ id: t.evalSuiteRuns.id })
      .from(t.evalSuiteRuns)
      .where(eq(t.evalSuiteRuns.agentId, agent.id));
    expect(rows).toHaveLength(0);

    await app.close();
  });
});
