/**
 * T29 / D28 — run-lifecycle integration tests over a real Postgres
 * (testcontainers). `secrets: new MockSecretsProvider()` in every `appWith()`
 * override keeps every adapter resolved through `SecretsProvider` from
 * reaching the real network (`server/insights.md` 2026-08-17); the
 * directly-injected `llm` override is what makes the mocked run itself work.
 *
 * SPEC-04 delta (D28): `POST /eval-cases/:id/verify` (AC-46) writes ONLY
 * `eval_cases.latest_result` — never `eval_suite_runs`, `eval_run_skills` or
 * `eval_runs`. AC-49/AC-50 are asserted BY STATE here — snapshotting the
 * suite-run tables before and after a verification and comparing — not by
 * trusting the call graph the way the hermetic `eval-runner.test.ts` unit
 * tests do.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
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
  console.warn('[eval-runs] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const CONFIG_PATCH = [
  '@@ -9,3 +9,7 @@',
  ' const config = {',
  '   port: process.env.PORT || 3000,',
  "   apiVersion: 'v2',",
  "+  stripeSecretKey: 'sk_live_51Hxxxxxxxxxxxxxxxxxxxxxxxx',",
  '+  rateLimit: { windowMs: 60_000, max: 100 },',
].join('\n');

const USERS_PATCH = [
  '@@ -43,7 +43,9 @@',
  ' async function listUsers(req, res) {',
  '   const ids = await getUserIds();',
  "+  const users = await db.query('SELECT * FROM users WHERE id IN (?)', [ids]);",
  '+  return res.json(users);',
  ' }',
].join('\n');

/** A no-findings `Review` fixture — grounding/scoring aren't this file's
 *  concern; a fixed, tiny cost per call is what AC-34's sum needs. */
function reviewFixture(overrides: Record<string, unknown> = {}) {
  return { verdict: 'comment', summary: 'ok', score: 95, findings: [], ...overrides };
}

/** A counting mock `LLMProvider` — one fixture per call, in order. An
 *  optional `blockAfter` count makes every call AT OR PAST that index await
 *  a manually-released deferred, for the AC-16 "one running per agent" test. */
function makeMockLLM(opts: { blocking?: boolean } = {}) {
  const calls: { req: StructuredRequest<unknown> }[] = [];
  const pending: { resolve: () => void }[] = [];
  const llm: LLMProvider = {
    id: 'openai',
    async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
      calls.push({ req: req as StructuredRequest<unknown> });
      if (opts.blocking) {
        await new Promise<void>((resolve) => pending.push({ resolve }));
      }
      const fixture = reviewFixture();
      const parsed = req.schema.safeParse(fixture);
      if (!parsed.success) throw new Error(`fixture mismatch: ${parsed.error.message}`);
      return {
        data: parsed.data,
        model: req.model,
        tokensIn: 10,
        tokensOut: 5,
        costUsd: 0.001,
        raw: JSON.stringify(fixture),
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
  return {
    llm,
    calls,
    releaseAll: () => pending.splice(0).forEach((p) => p.resolve()),
    pendingCount: () => pending.length,
  };
}

d('modules/eval — run lifecycle (Postgres)', () => {
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
      overrides: { secrets: new MockSecretsProvider(), llm: { openai: llm, openrouter: llm } },
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
    return res.json() as { id: string; version: number };
  }

  async function createSkill(app: Awaited<ReturnType<typeof buildApp>>, over: Record<string, unknown> = {}) {
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name: `skill-${Math.random().toString(36).slice(2, 8)}`,
        description: 'Use when reviewing tests.',
        type: 'rubric',
        body: '## rule\nDo the thing.',
        ...over,
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string; name: string; version: number };
  }

  /** A finding on `agent`, with a real patch its case can be cut from. */
  async function setupFinding(agentId: string, opts: { patch?: string; file?: string; line?: number } = {}) {
    const n = seq++;
    const name = `eval-run-repo-${n}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 3000 + n,
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
    const file = opts.file ?? 'src/config.ts';
    const patch = opts.patch ?? CONFIG_PATCH;
    await pg.handle.db.insert(t.prFiles).values({ prId: pr!.id, path: file, additions: 4, deletions: 0, patch });

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

    const line = opts.line ?? 12;
    const [finding] = await pg.handle.db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file,
        startLine: line,
        endLine: line,
        severity: 'CRITICAL',
        category: 'security',
        title: 'A finding',
        rationale: 'rationale',
        confidence: 0.9,
        acceptedAt: new Date(),
      })
      .returning();
    return finding!;
  }

  async function createCase(
    app: Awaited<ReturnType<typeof buildApp>>,
    agentId: string,
    opts: { patch?: string; file?: string; line?: number; name?: string } = {},
  ) {
    const finding = await setupFinding(agentId, opts);
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/eval-cases`,
      payload: {
        finding_id: finding.id,
        name: opts.name ?? 'a case',
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string };
  }

  async function waitForRun(
    app: Awaited<ReturnType<typeof buildApp>>,
    runId: string,
    predicate: (run: Record<string, unknown>) => boolean,
    timeoutMs = 10_000,
  ): Promise<Record<string, unknown>> {
    const start = Date.now();
    // Polling is required: the runner does NOT await execution before
    // returning 202 (mirrors run-executor.ts's background-run shape).
    for (;;) {
      const res = await app.inject({ method: 'GET', url: `/eval-runs/${runId}` });
      const run = res.json() as Record<string, unknown>;
      if (predicate(run)) return run;
      if (Date.now() - start > timeoutMs) {
        throw new Error(`waitForRun timed out; last status=${String(run.status)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  it('eval_empty_case_set_refuses_to_run', async () => {
    const { llm } = makeMockLLM();
    const app = await appWith(llm);
    const agent = await createAgent(app);

    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('eval_run_covers_the_set_as_it_was_at_start', async () => {
    const { llm } = makeMockLLM();
    const app = await appWith(llm);
    const agent = await createAgent(app);
    const case1 = await createCase(app, agent.id, { file: 'src/config.ts', line: 12, name: 'case-1' });
    const case2 = await createCase(app, agent.id, {
      file: 'src/api/users.ts',
      line: 45,
      patch: USERS_PATCH,
      name: 'case-2',
    });

    const startRes = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(startRes.statusCode).toBe(202);
    const started = startRes.json();
    // Frozen synchronously, before the background execution even begins.
    expect(started.cases_total).toBe(2);
    expect([...started.case_ids].sort()).toEqual([case1.id, case2.id].sort());

    // A THIRD case, created immediately after the run started, must not
    // join the already-started run.
    await createCase(app, agent.id, { file: 'src/config.ts', line: 12, name: 'case-3-too-late' });

    const finished = await waitForRun(app, started.id, (r) => r.status !== 'running');
    expect(finished.cases_total).toBe(2);
    expect((finished.case_ids as string[]).sort()).toEqual([case1.id, case2.id].sort());
    await app.close();
  });

  it('eval_runs_one_running_per_agent', async () => {
    const { llm, releaseAll } = makeMockLLM({ blocking: true });
    const app = await appWith(llm);
    const agent = await createAgent(app);
    await createCase(app, agent.id, { name: 'case-1' });

    const first = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(first.statusCode).toBe(202);

    // The first run's model call is blocked (still 'running') — a second
    // start for the SAME agent must be refused.
    const second = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(second.statusCode).toBe(409);

    // Let the first run finish so it doesn't leak a dangling background task.
    releaseAll();
    await waitForRun(app, first.json().id, (r) => r.status !== 'running');
    await app.close();
  });

  it('eval_orphaned_running_run_is_reaped_on_boot', async () => {
    const { llm } = makeMockLLM();
    const app = await appWith(llm);
    const agent = await createAgent(app);

    // A `running` row inserted directly, bypassing the runner — simulates a
    // process that died mid-run.
    const [orphan] = await pg.handle.db
      .insert(t.evalSuiteRuns)
      .values({
        workspaceId,
        agentId: agent.id,
        agentVersion: agent.version,
        status: 'running',
        startedAt: new Date(),
        casesTotal: 1,
        casesCompleted: 0,
        casesFailedToComplete: 0,
      })
      .returning();
    await app.close();

    // A fresh app instance — this is where the boot-time reap runs.
    const secondApp = await appWith(llm);
    const [row] = await pg.handle.db
      .select()
      .from(t.evalSuiteRuns)
      .where(eq(t.evalSuiteRuns.id, orphan!.id));
    expect(row!.status).toBe('failed');
    expect(row!.completedAt).not.toBeNull();

    // The reap is visible over the API too — the agent is no longer blocked
    // from starting a new run by the orphaned row (AC-16).
    await createCase(secondApp, agent.id, { name: 'unblocks-a-new-run' });
    const restarted = await secondApp.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(restarted.statusCode).toBe(202);
    await waitForRun(secondApp, restarted.json().id, (r) => r.status !== 'running');
    await secondApp.close();
  });

  it('eval_run_records_agent_version', async () => {
    const { llm } = makeMockLLM();
    const app = await appWith(llm);
    const agent = await createAgent(app);
    expect(agent.version).toBe(1);

    // Bump the agent's config version before creating cases / running.
    const updated = await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}`,
      payload: { system_prompt: 'A revised system prompt.' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().version).toBe(2);

    await createCase(app, agent.id, { name: 'case-1' });
    const started = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(started.json().agent_version).toBe(2);

    const finished = await waitForRun(app, started.json().id, (r) => r.status !== 'running');
    expect(finished.agent_version).toBe(2);
    await app.close();
  });

  it('eval_run_records_invoked_skill_versions', async () => {
    const { llm } = makeMockLLM();
    const app = await appWith(llm);
    const agent = await createAgent(app);
    const skill = await createSkill(app);
    expect(skill.version).toBe(1);

    const link = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [skill.id] },
    });
    expect(link.statusCode).toBe(200);

    await createCase(app, agent.id, { name: 'case-1' });
    const started = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    const runId = started.json().id as string;
    const finished = await waitForRun(app, runId, (r) => r.status !== 'running');

    const invoked = finished.invoked_skills as { skill_id: string; skill_version: number; name: string }[];
    expect(invoked).toEqual([{ skill_id: skill.id, skill_version: 1, name: skill.name }]);

    // Edit the skill's body — its version bumps (isBodyChange) — but the
    // already-recorded run must NOT change retroactively.
    const editRes = await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { body: '## rule\nA rewritten body.' },
    });
    expect(editRes.statusCode).toBe(200);
    expect(editRes.json().version).toBe(2);

    // Delete the skill outright — the recorded row must survive (no FK).
    const deleteRes = await app.inject({ method: 'DELETE', url: `/skills/${skill.id}` });
    expect(deleteRes.statusCode).toBe(200);

    const reread = await app.inject({ method: 'GET', url: `/eval-runs/${runId}` });
    expect(reread.statusCode).toBe(200);
    const rereadInvoked = reread.json().invoked_skills as { skill_id: string; skill_version: number; name: string }[];
    expect(rereadInvoked).toEqual([{ skill_id: skill.id, skill_version: 1, name: skill.name }]);
    await app.close();
  });

  it('eval_run_records_total_model_call_cost', async () => {
    const { llm } = makeMockLLM();
    const app = await appWith(llm);
    const agent = await createAgent(app);
    await createCase(app, agent.id, { file: 'src/config.ts', line: 12, name: 'case-1' });
    await createCase(app, agent.id, {
      file: 'src/api/users.ts',
      line: 45,
      patch: USERS_PATCH,
      name: 'case-2',
    });

    const started = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    const finished = await waitForRun(app, started.json().id, (r) => r.status !== 'running');

    // Two cases, each costing exactly $0.001 from the mock provider.
    expect(finished.cost_usd).toBeCloseTo(0.002);
    await app.close();
  });

  it('eval_run_detail_tolerates_a_legacy_result_document', async () => {
    const { llm } = makeMockLLM();
    const app = await appWith(llm);
    const agent = await createAgent(app);
    const evalCase = await createCase(app, agent.id, { name: 'legacy-doc-case' });

    const [suiteRun] = await pg.handle.db
      .insert(t.evalSuiteRuns)
      .values({
        workspaceId,
        agentId: agent.id,
        agentVersion: agent.version,
        status: 'completed',
        startedAt: new Date(),
        completedAt: new Date(),
        casesTotal: 1,
        casesCompleted: 1,
        casesPassed: 1,
        casesFailedToComplete: 0,
        recall: 1,
        precision: 1,
        citationAccuracy: 1,
        costUsd: 0.001,
      })
      .returning();

    // The RAW legacy jsonb shape — `severity`/`title` keys ABSENT, not
    // `null` — exactly as a row written before those keys existed would
    // look. Inserted as a plain JS literal, never routed through
    // `EvalReturnedFinding.parse()` first (server/insights.md 2026-08-17).
    await pg.handle.db.insert(t.evalRuns).values({
      caseId: evalCase.id,
      suiteRunId: suiteRun!.id,
      actualOutput: [{ file: 'src/config.ts', start_line: 12, end_line: 12, grounded: true }],
      pass: true,
      costUsd: 0.001,
    });

    const res = await app.inject({ method: 'GET', url: `/eval-runs/${suiteRun!.id}` });
    expect(res.statusCode).toBe(200); // does NOT throw
    const body = res.json();
    expect(body.results).toHaveLength(1);
    const finding = body.results[0].findings[0];
    expect(finding.file).toBe('src/config.ts');
    expect(finding.grounded).toBe(true);
    expect(finding.severity).toBeUndefined();
    expect(finding.title).toBeUndefined();
    await app.close();
  });

  it('eval_verification_records_the_case_latest_result', async () => {
    const { llm } = makeMockLLM();
    const app = await appWith(llm);
    const agent = await createAgent(app);
    const evalCase = await createCase(app, agent.id, { name: 'verify-me' });

    const started = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    await waitForRun(app, started.json().id, (r) => r.status !== 'running');

    // A completed run already moved `latest_result` (AC-48's data path).
    const beforeVerify = (
      await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` }).then((r) => r.json())
    ).find((c: { id: string }) => c.id === evalCase.id);
    expect(beforeVerify.latest_result).not.toBeNull();
    expect(beforeVerify.latest_result.completed).toBe(true);
    const ranAtFromRun = beforeVerify.latest_result.ran_at as string;

    // A short delay so the verification's own timestamp is provably LATER,
    // not merely different by construction.
    await new Promise((resolve) => setTimeout(resolve, 5));

    const verifyRes = await app.inject({ method: 'POST', url: `/eval-cases/${evalCase.id}/verify` });
    expect(verifyRes.statusCode).toBe(200);
    const verified = verifyRes.json();
    expect(verified.id).toBe(evalCase.id);
    expect(verified.latest_result.completed).toBe(true);
    expect(typeof verified.latest_result.matched_count).toBe('number');
    expect(new Date(verified.latest_result.ran_at).getTime()).toBeGreaterThan(
      new Date(ranAtFromRun).getTime(),
    );

    // The pointer moved on the READ path too — not just in the verify
    // response.
    const reread = (
      await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` }).then((r) => r.json())
    ).find((c: { id: string }) => c.id === evalCase.id);
    expect(reread.latest_result.ran_at).toBe(verified.latest_result.ran_at);
    await app.close();
  });

  it('eval_verification_leaves_every_run_metric_and_result_unchanged', async () => {
    const { llm } = makeMockLLM();
    const app = await appWith(llm);
    const agent = await createAgent(app);
    const evalCase = await createCase(app, agent.id, { name: 'unchanged-by-verify' });

    const started = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    const runId = started.json().id as string;
    await waitForRun(app, runId, (r) => r.status !== 'running');

    // Snapshot the run's own read surface AND the raw suite-run/per-case rows
    // — asserted by STATE, not by trusting `verifyCase`'s call graph.
    const beforeDetail = await app.inject({ method: 'GET', url: `/eval-runs/${runId}` }).then((r) => r.json());
    const beforeRawRuns = await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.suiteRunId, runId));
    const beforeRawSuiteRun = await pg.handle.db
      .select()
      .from(t.evalSuiteRuns)
      .where(eq(t.evalSuiteRuns.id, runId));

    const verifyRes = await app.inject({ method: 'POST', url: `/eval-cases/${evalCase.id}/verify` });
    expect(verifyRes.statusCode).toBe(200);
    // The case's OWN `latest_result` did move — the pointer, not the run.
    expect(verifyRes.json().latest_result).not.toBeNull();

    const afterDetail = await app.inject({ method: 'GET', url: `/eval-runs/${runId}` }).then((r) => r.json());
    const afterRawRuns = await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.suiteRunId, runId));
    const afterRawSuiteRun = await pg.handle.db
      .select()
      .from(t.evalSuiteRuns)
      .where(eq(t.evalSuiteRuns.id, runId));

    // Byte-identical — recall, precision, citation accuracy, passed count and
    // every per-case `eval_runs` row (AC-50).
    expect(afterDetail).toEqual(beforeDetail);
    expect(afterRawRuns).toEqual(beforeRawRuns);
    expect(afterRawSuiteRun).toEqual(beforeRawSuiteRun);
    await app.close();
  });

  it('eval_verification_writes_no_suite_run_row', async () => {
    const { llm, releaseAll, pendingCount } = makeMockLLM({ blocking: true });
    const app = await appWith(llm);
    const agent = await createAgent(app);
    const evalCase = await createCase(app, agent.id, { name: 'no-new-run-row' });

    const suiteRunsBefore = await pg.handle.db
      .select()
      .from(t.evalSuiteRuns)
      .where(eq(t.evalSuiteRuns.agentId, agent.id));
    const runsListBefore = (
      await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-runs` }).then((r) => r.json())
    ) as { id: string }[];

    // A suite run is IN PROGRESS — its one case's model call is blocked
    // (call #1 pending), so the run stays `running` until released below.
    const started = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(started.statusCode).toBe(202);
    const startedId = started.json().id as string;
    await vi.waitFor(() => expect(pendingCount()).toBe(1));

    // SPEC-04's edge case: a verification is ACCEPTED, not refused, while a
    // run is `running` (AC-16 bars a second RUN, not a verification). Fired
    // WITHOUT awaiting — its own model call (#2) blocks too, so awaiting it
    // here would deadlock before the run is released.
    const verifyPromise = app.inject({ method: 'POST', url: `/eval-cases/${evalCase.id}/verify` });
    await vi.waitFor(() => expect(pendingCount()).toBe(2));

    // Both calls are now in flight — the started run is still `running`,
    // and NEITHER call has resolved — release both and let them finish.
    const runWhileBothPending = await app.inject({ method: 'GET', url: `/eval-runs/${startedId}` });
    expect(runWhileBothPending.json().status).toBe('running');

    releaseAll();
    const verifyRes = await verifyPromise;
    expect(verifyRes.statusCode).toBe(200);
    await waitForRun(app, startedId, (r) => r.status !== 'running');

    // No `eval_suite_runs` row exists beyond the one the START created — the
    // verification added NOTHING on top (AC-49, AC-51).
    const suiteRunsAfter = await pg.handle.db
      .select()
      .from(t.evalSuiteRuns)
      .where(eq(t.evalSuiteRuns.agentId, agent.id));
    expect(suiteRunsAfter).toHaveLength(suiteRunsBefore.length + 1);

    // `GET /agents/:id/eval-runs` afterward lists exactly the started run
    // plus whatever existed before — the verification is invisible to it.
    const runsListAfter = (
      await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-runs` }).then((r) => r.json())
    ) as { id: string }[];
    expect(runsListAfter.map((r) => r.id).sort()).toEqual(
      [startedId, ...runsListBefore.map((r) => r.id)].sort(),
    );
    await app.close();
  });
});
