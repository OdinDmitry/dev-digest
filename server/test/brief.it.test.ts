/**
 * T23 — modules/brief routes over a real Postgres. `appWith`-style helper per
 * the plan: `secrets: new MockSecretsProvider()` keeps every adapter resolved
 * through `SecretsProvider` (github, the `review_intent`-default openrouter
 * provider, …) from reaching the real network (`server/insights.md`,
 * Recurring Errors 2026-08-17); a hand-rolled COUNTING `LLMProvider` is what
 * makes "zero model calls" / "exactly one model call" assertable, and throws
 * loudly on any call beyond what a test explicitly expects.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { eq } from 'drizzle-orm';
import type {
  ChatMessage,
  LLMProvider,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
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
  console.warn('[brief] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

async function writeFileAt(root: string, rel: string, contents: string): Promise<void> {
  const full = join(root, rel);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, contents);
}

/** The default changed files any `setupRepoAndPr` PR carries, unless overridden. */
const DEFAULT_FILES = [
  { path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
  { path: 'src/config.ts', additions: 4, deletions: 0 },
];

/** A RawBrief-shaped fixture the mock model returns — grounded against
 *  DEFAULT_FILES' `src/middleware/ratelimit.ts`, and never equal to any test
 *  PR's title (AC-2, incidentally exercised here too). */
function briefFixture(overrides: Record<string, unknown> = {}) {
  return {
    what: 'Introduces a token-bucket limiter in front of the public API endpoints.',
    why: 'Unauthenticated clients could overwhelm the public endpoints with no throttling.',
    risk_level: 'medium',
    risks: [
      {
        kind: 'security',
        title: 'Limiter can be bypassed by IP rotation',
        explanation: 'The limiter keys solely on client IP.',
        severity: 'high',
        refs: [{ path: 'src/middleware/ratelimit.ts', start_line: null, end_line: null, endpoint: null }],
      },
    ],
    review_focus: [
      {
        reason: 'Start with the limiter itself',
        refs: [{ path: 'src/middleware/ratelimit.ts', start_line: null, end_line: null, endpoint: null }],
      },
    ],
    ...overrides,
  };
}

/** A fully-filled `BriefDoc`-shaped object for DIRECT db inserts (bypassing
 *  generation entirely) — used by tests that need a pre-existing stored row. */
const PERSISTED_BRIEF_DOC = {
  what: 'Stored what statement, distinct from every PR title used in this file.',
  why: 'Stored why statement.',
  risk_level: 'medium',
  risks: [
    {
      kind: 'security',
      title: 'Stored risk',
      explanation: 'Stored risk explanation.',
      severity: 'medium',
      refs: [{ path: 'src/middleware/ratelimit.ts', start_line: null, end_line: null, endpoint: null }],
    },
  ],
  review_focus: [
    {
      refs: [{ path: 'src/middleware/ratelimit.ts', start_line: null, end_line: null, endpoint: null }],
      reason: 'Stored reason.',
    },
  ],
};

interface RecordedCall {
  schemaName: string;
  messages: ChatMessage[];
}

/**
 * A hand-rolled counting `LLMProvider` — one fixture per expected call, IN
 * ORDER. A call beyond the provided steps throws loudly (an unexpected extra
 * model call is a real bug, not something to tolerate silently); `'ERROR'`
 * makes that specific call fail, for the AC-13 case.
 */
function makeMockLLM(steps: (Record<string, unknown> | 'ERROR')[]): {
  llm: LLMProvider;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let i = 0;
  const llm: LLMProvider = {
    id: 'openai',
    async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
      calls.push({ schemaName: req.schemaName, messages: req.messages });
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
  return { llm, calls };
}

d('modules/brief routes (Postgres)', () => {
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
        llm: { openrouter: llm, openai: llm },
      },
    });
  }

  async function setupRepoAndPr(
    ws: string,
    opts: {
      title?: string;
      body?: string;
      headSha?: string;
      files?: { path: string; additions: number; deletions: number }[];
      clonePath?: string | null;
    } = {},
  ) {
    const n = seq++;
    const name = `brief-repo-${n}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: ws,
        owner: 'acme',
        name,
        fullName: `acme/${name}`,
        clonePath: opts.clonePath ?? null,
        lastPolledAt: opts.clonePath ? new Date() : null,
      })
      .returning();

    const files = opts.files ?? DEFAULT_FILES;
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws,
        repoId: repo!.id,
        number: 1000 + n,
        title: opts.title ?? 'Add rate limiting to public API endpoints',
        author: 'tester',
        branch: 'feat/rl',
        base: 'main',
        headSha: opts.headSha ?? `headsha-${n}`,
        additions: 10,
        deletions: 2,
        filesCount: files.length,
        status: 'needs_review',
        body: opts.body ?? 'Adds a token-bucket limiter in front of the public API.',
      })
      .returning();

    if (files.length > 0) {
      await pg.handle.db.insert(t.prFiles).values(files.map((f) => ({ prId: pr!.id, ...f })));
    }

    return { repo: repo!, pr: pr! };
  }

  async function seedIntent(
    prId: string,
    intent = 'Adds token-bucket rate limiting to the public API endpoints.',
  ) {
    await pg.handle.db.insert(t.prIntent).values({
      prId,
      intent,
      inScope: ['public API rate limiting'],
      outOfScope: ['authentication changes'],
    });
  }

  async function insertReview(
    ws: string,
    prId: string,
    opts: {
      verdict?: string;
      score?: number | null;
      findings?: { severity: 'CRITICAL' | 'WARNING' | 'SUGGESTION' }[];
    } = {},
  ) {
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId: ws,
        prId,
        kind: 'review',
        verdict: opts.verdict ?? 'request_changes',
        summary: 'A test-seeded review.',
        score: opts.score === undefined ? 70 : opts.score,
        model: 'seed',
      })
      .returning();
    const findings = opts.findings ?? [{ severity: 'CRITICAL' }, { severity: 'WARNING' }];
    if (findings.length > 0) {
      await pg.handle.db.insert(t.findings).values(
        findings.map((f) => ({
          reviewId: review!.id,
          file: 'src/config.ts',
          startLine: 1,
          endLine: 1,
          severity: f.severity,
          category: 'security',
          title: 'seeded finding',
          rationale: 'seeded rationale',
          confidence: 0.9,
        })),
      );
    }
    return review!;
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

  async function createSkill(app: Awaited<ReturnType<typeof buildApp>>) {
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name: `skill-${Math.random().toString(36).slice(2, 8)}`,
        description: 'Use when reviewing tests.',
        type: 'rubric',
        body: '## rule\nDo the thing.',
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string };
  }

  // ---- Run summary (AC-3, AC-4, AC-5) ----

  it('returns the verdict, finding count and blocker count of the latest completed review', async () => {
    const { llm } = makeMockLLM([]);
    const app = await appWith(llm);
    const { pr } = await setupRepoAndPr(workspaceId);
    await insertReview(workspaceId, pr.id, {
      verdict: 'request_changes',
      score: 55,
      findings: [{ severity: 'CRITICAL' }, { severity: 'CRITICAL' }, { severity: 'WARNING' }],
    });

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/run-summary` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.verdict).toBe('request_changes');
    expect(body.findings_count).toBe(3);
    expect(body.blockers_count).toBe(2);
    expect(body.score).toBe(55);
    await app.close();
  });

  it('reports the same score as the pull request list for the same pull request', async () => {
    const { llm } = makeMockLLM([]);
    const app = await appWith(llm);
    const { repo, pr } = await setupRepoAndPr(workspaceId);
    await insertReview(workspaceId, pr.id, { score: 61 });

    const listRes = await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` });
    expect(listRes.statusCode).toBe(200);
    const listed = (listRes.json() as { id: string; score: number | null }[]).find(
      (p) => p.id === pr.id,
    )!;
    const summaryRes = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/run-summary` });

    expect(listed.score).toBe(61);
    expect(summaryRes.json().score).toBe(listed.score);
    await app.close();
  });

  it('returns no run summary for a pull request with no completed review', async () => {
    const { llm } = makeMockLLM([]);
    const app = await appWith(llm);
    const { pr } = await setupRepoAndPr(workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/run-summary` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
    await app.close();
  });

  // ---- Generating, caching, rebuilding (AC-6, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13) ----

  it('starts exactly one generation for a pull request with no stored brief', async () => {
    const { llm, calls } = makeMockLLM([briefFixture()]);
    const app = await appWith(llm);
    const { pr } = await setupRepoAndPr(workspaceId);
    await seedIntent(pr.id);

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ready');
    expect(body.brief.what).toBeTruthy();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.schemaName).toBe('RawBrief');

    const [row] = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    expect(row).toBeDefined();
    expect(row!.headSha).toBe(pr.headSha);
    await app.close();
  });

  it('serves a stored brief for the same head commit without a model call', async () => {
    const { llm, calls } = makeMockLLM([briefFixture()]);
    const app = await appWith(llm);
    const { pr } = await setupRepoAndPr(workspaceId);
    await seedIntent(pr.id);

    const first = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(first.statusCode).toBe(200);
    expect(calls).toHaveLength(1);

    const read = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(read.statusCode).toBe(200);
    expect(read.json().status).toBe('ready');
    expect(read.json().brief).toEqual(first.json().brief);
    expect(calls).toHaveLength(1); // the GET made no model call

    const secondPost = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(secondPost.json().brief).toEqual(first.json().brief);
    expect(calls).toHaveLength(1); // ensure-if-absent found it already stored
    await app.close();
  });

  it('treats a stored brief produced for a different head commit as absent', async () => {
    const { llm, calls } = makeMockLLM([]);
    const app = await appWith(llm);
    const { pr } = await setupRepoAndPr(workspaceId, { headSha: 'sha-old' });
    await seedIntent(pr.id);

    await pg.handle.db.insert(t.prBrief).values({
      prId: pr.id,
      headSha: 'sha-old',
      json: { ...PERSISTED_BRIEF_DOC, pr_id: pr.id, head_sha: 'sha-old' },
    });

    // The head commit moves — no model call has fired yet.
    await pg.handle.db
      .update(t.pullRequests)
      .set({ headSha: 'sha-new' })
      .where(eq(t.pullRequests.id, pr.id));

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'absent', brief: null, reason: null });
    expect(calls).toHaveLength(0);
    await app.close();
  });

  it('leaves the stored brief unchanged when intent is recomputed and when a run completes', async () => {
    const { llm, calls } = makeMockLLM([
      briefFixture(),
      { intent: 'Recomputed intent text, different from before.', in_scope: [], out_of_scope: [] },
    ]);
    const app = await appWith(llm);
    const { pr } = await setupRepoAndPr(workspaceId);
    await seedIntent(pr.id);

    const generated = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(generated.statusCode).toBe(200);
    const storedBrief = generated.json().brief;
    expect(calls.filter((c) => c.schemaName === 'RawBrief')).toHaveLength(1);

    // Intent is recomputed (a SEPARATE model call, schema RawIntent — the
    // second step in the mock)…
    const recomputed = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent/recompute` });
    expect(recomputed.statusCode).toBe(200);

    // …and an agent run completes.
    await insertReview(workspaceId, pr.id, { verdict: 'approve', score: 90, findings: [] });

    const read = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(read.json().brief).toEqual(storedBrief);
    // Still exactly ONE brief-schema call — neither event triggered a second
    // brief generation.
    expect(calls.filter((c) => c.schemaName === 'RawBrief')).toHaveLength(1);
    await app.close();
  });

  it('replaces the whole stored brief with one new model call on regenerate', async () => {
    const { llm, calls } = makeMockLLM([
      briefFixture({ what: 'First generation what statement, distinct from the title.' }),
      briefFixture({ what: 'Second generation what statement, distinct from the first and the title.' }),
    ]);
    const app = await appWith(llm);
    const { pr } = await setupRepoAndPr(workspaceId);
    await seedIntent(pr.id);

    const first = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(first.statusCode).toBe(200);
    expect(calls).toHaveLength(1);

    const regenerated = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/regenerate` });
    expect(regenerated.statusCode).toBe(200);
    expect(calls).toHaveLength(2); // exactly ONE new call

    expect(regenerated.json().brief.what).not.toBe(first.json().brief.what);

    const read = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(read.json().brief).toEqual(regenerated.json().brief);
    await app.close();
  });

  it('stores the brief and creates no score for a pull request with no completed run', async () => {
    const { llm } = makeMockLLM([briefFixture()]);
    const app = await appWith(llm);
    const { pr } = await setupRepoAndPr(workspaceId);
    await seedIntent(pr.id);

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ready');

    const summary = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/run-summary` });
    expect(summary.json()).toBeNull();

    const reviewRows = await pg.handle.db.select().from(t.reviews).where(eq(t.reviews.prId, pr.id));
    expect(reviewRows).toHaveLength(0);
    await app.close();
  });

  it('leaves the previously stored brief unchanged when the model call fails', async () => {
    const { llm } = makeMockLLM([
      briefFixture({ what: 'Original what statement, distinct from the title.' }),
      'ERROR',
    ]);
    const app = await appWith(llm);
    const { pr } = await setupRepoAndPr(workspaceId);
    await seedIntent(pr.id);

    const first = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(first.statusCode).toBe(200);
    const stored = first.json().brief;

    const failedRegen = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/regenerate` });
    expect(failedRegen.statusCode).toBe(500);

    const read = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(read.json().status).toBe('ready');
    expect(read.json().brief).toEqual(stored);
    await app.close();
  });

  it('reports intent_absent without a model call when no intent is persisted', async () => {
    // MUST be a PR other than the seeded #482 — its pr_intent row is
    // pre-filled by seed.ts (T20), so #482 would never exercise this branch.
    const { llm, calls } = makeMockLLM([briefFixture()]);
    const app = await appWith(llm);
    const { pr } = await setupRepoAndPr(workspaceId); // no seedIntent call

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'unavailable', brief: null, reason: 'intent_absent' });
    expect(calls).toHaveLength(0);

    const [row] = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    expect(row).toBeUndefined();

    // The NEXT open, once intent exists, generates normally.
    await seedIntent(pr.id);
    const second = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(second.statusCode).toBe(200);
    expect(second.json().status).toBe('ready');
    expect(calls).toHaveLength(1);
    await app.close();
  });

  // ---- Project context (AC-14 / T16) ----

  it("includes the repository's attached project-context documents in the generation", async () => {
    const { llm, calls } = makeMockLLM([briefFixture()]);
    const app = await appWith(llm);

    const clonePath = await mkdtemp(join(tmpdir(), 'brief-it-'));
    await writeFileAt(
      clonePath,
      'docs/api-guidelines.md',
      '# API guidelines\n\nAll public endpoints must be rate limited.',
    );

    const { pr } = await setupRepoAndPr(workspaceId, { clonePath });
    await seedIntent(pr.id);

    const agent = await createAgent(app);
    const attach = await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: { repo_id: pr.repoId, paths: ['docs/api-guidelines.md'] },
    });
    expect(attach.statusCode).toBe(200);

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    expect(calls).toHaveLength(1);

    const userMessage = calls[0]!.messages.find((m) => m.role === 'user')!.content;
    expect(userMessage).toContain('docs/api-guidelines.md');
    expect(userMessage).toContain('All public endpoints must be rate limited.');
    await app.close();
  });

  it('excludes documents that reach no enabled agent', async () => {
    const { llm, calls } = makeMockLLM([briefFixture()]);
    const app = await appWith(llm);

    const clonePath = await mkdtemp(join(tmpdir(), 'brief-it-'));
    await writeFileAt(clonePath, 'reachable.md', '# reachable\n\nMARKER-REACHABLE-DOC');
    await writeFileAt(clonePath, 'skill-only.md', '# skill only\n\nMARKER-SKILL-ONLY-DOC');
    await writeFileAt(clonePath, 'disabled-agent.md', '# disabled\n\nMARKER-DISABLED-AGENT-DOC');

    const { pr } = await setupRepoAndPr(workspaceId, { clonePath });
    await seedIntent(pr.id);

    const enabledAgent = await createAgent(app);
    const disabledAgent = await createAgent(app);
    const skill = await createSkill(app);

    // reachable.md — attached directly to an ENABLED agent.
    const attachEnabled = await app.inject({
      method: 'PUT',
      url: `/agents/${enabledAgent.id}/context`,
      payload: { repo_id: pr.repoId, paths: ['reachable.md'] },
    });
    expect(attachEnabled.statusCode).toBe(200);

    // disabled-agent.md — attached to an agent, then that agent is disabled.
    const attachDisabled = await app.inject({
      method: 'PUT',
      url: `/agents/${disabledAgent.id}/context`,
      payload: { repo_id: pr.repoId, paths: ['disabled-agent.md'] },
    });
    expect(attachDisabled.statusCode).toBe(200);
    const disable = await app.inject({
      method: 'PUT',
      url: `/agents/${disabledAgent.id}`,
      payload: { enabled: false },
    });
    expect(disable.statusCode).toBe(200);

    // skill-only.md — attached to a skill that no agent links.
    const attachSkill = await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}/context`,
      payload: { repo_id: pr.repoId, paths: ['skill-only.md'] },
    });
    expect(attachSkill.statusCode).toBe(200);

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    expect(calls).toHaveLength(1);

    const userMessage = calls[0]!.messages.find((m) => m.role === 'user')!.content;
    expect(userMessage).toContain('MARKER-REACHABLE-DOC');
    expect(userMessage).not.toContain('MARKER-SKILL-ONLY-DOC');
    expect(userMessage).not.toContain('MARKER-DISABLED-AGENT-DOC');
    await app.close();
  });

  // ---- Workspace scoping (Constraint 8 / server/insights.md 2026-08-05) ----

  it('refuses a stored brief belonging to another workspace', async () => {
    const { llm } = makeMockLLM([]);
    const app = await appWith(llm);
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'other-brief-ws' }).returning();
    const { pr: otherPr } = await setupRepoAndPr(otherWs!.id);
    await pg.handle.db.insert(t.prBrief).values({
      prId: otherPr.id,
      headSha: otherPr.headSha,
      json: { ...PERSISTED_BRIEF_DOC, pr_id: otherPr.id, head_sha: otherPr.headSha },
    });

    const res = await app.inject({ method: 'GET', url: `/pulls/${otherPr.id}/brief` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('refuses a run summary belonging to another workspace', async () => {
    const { llm } = makeMockLLM([]);
    const app = await appWith(llm);
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other-brief-ws-run-summary' })
      .returning();
    const { pr: otherPr } = await setupRepoAndPr(otherWs!.id);
    await insertReview(otherWs!.id, otherPr.id, { verdict: 'approve', score: 88 });

    const res = await app.inject({ method: 'GET', url: `/pulls/${otherPr.id}/run-summary` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
