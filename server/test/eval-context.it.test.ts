/**
 * `modules/evals` suite-run project-context resolution over a real Postgres
 * (`docs/plans/2026-08-22-eval-pipeline-b-suite-runs.md` T20). Modelled on
 * `test/context-run.it.test.ts`'s temp-working-copy fixture shape. Covers
 * AC-49, AC-51, AC-52, AC-53.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForEvalRun } from './helpers/eval-runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[eval-context] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** A unified diff every case in this file shares — project context resolution
 *  doesn't depend on its content, only on each case's OWN `repo_id`. */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** No findings — every case in this file uses a trivially-satisfiable
 *  must_not_flag expectation, so pass/fail is never in question and every
 *  assertion can focus purely on captured_context. */
const CLEAN_REVIEW = { verdict: 'approve' as const, summary: 'Clean.', score: 100, findings: [] };

async function writeFileAt(root: string, rel: string, contents: string): Promise<void> {
  const full = join(root, rel);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, contents);
}

d('modules/evals — suite-run project context resolution (Postgres)', () => {
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

  function makeApp() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        secrets: new MockSecretsProvider(),
        llm: { openai: new MockLLMProvider('openai', { structured: CLEAN_REVIEW }) },
      },
    });
  }

  async function makeSyncedRepo(
    files: { path: string; contents: string }[] = [],
  ): Promise<{ id: string; clonePath: string }> {
    const clonePath = await mkdtemp(join(tmpdir(), 'eval-context-it-'));
    for (const f of files) await writeFileAt(clonePath, f.path, f.contents);
    const owner = 'acme';
    const name = `eval-context-repo-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner, name, fullName: `${owner}/${name}`, clonePath, lastPolledAt: new Date() })
      .returning();
    return { id: repo!.id, clonePath };
  }

  async function createAgent(app: Awaited<ReturnType<typeof makeApp>>) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: `eval-context-agent-${seq++}`,
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: 'Review the diff.',
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string };
  }

  async function createSkillAttachedTo(
    app: Awaited<ReturnType<typeof makeApp>>,
    agentId: string,
    repoId: string,
    path: string,
  ) {
    const skillRes = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name: `eval-context-skill-${seq++}`,
        description: 'Use when reviewing.',
        type: 'rubric',
        body: '## rule\nDo the thing.',
      },
    });
    expect(skillRes.statusCode).toBe(201);
    const skill = skillRes.json() as { id: string };

    const attach = await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}/context`,
      payload: { repo_id: repoId, paths: [path] },
    });
    expect(attach.statusCode).toBe(200);

    const link = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_id: skill.id },
    });
    expect(link.statusCode).toBe(200);

    return skill;
  }

  async function createCase(
    app: Awaited<ReturnType<typeof makeApp>>,
    agentId: string,
    repoId: string | null,
  ) {
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/eval-cases`,
      payload: {
        name: `case-${seq++}`,
        input_diff: DIFF,
        repo_id: repoId,
        expectations: [
          { kind: 'must_not_flag', file: 'src/config.ts', start_line: 11, end_line: 11 },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    return res.json() as { id: string };
  }

  it(
    "a run's captured_context.documents is the UNION of what two cases (each associated with a DIFFERENT repository) used, each carrying the text exactly as read (AC-53)",
    async () => {
      const app = await makeApp();
      const agent = await createAgent(app);

      const repoA = await makeSyncedRepo([
        { path: 'specs/from-a.md', contents: 'FULL TEXT FROM REPO A — every line must reach captured_context verbatim.' },
      ]);
      const repoB = await makeSyncedRepo([
        { path: 'specs/from-b.md', contents: 'FULL TEXT FROM REPO B — every line must reach captured_context verbatim.' },
      ]);
      await createSkillAttachedTo(app, agent.id, repoA.id, 'specs/from-a.md');
      await createSkillAttachedTo(app, agent.id, repoB.id, 'specs/from-b.md');

      const caseA = await createCase(app, agent.id, repoA.id);
      const caseB = await createCase(app, agent.id, repoB.id);

      const started = (
        await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` })
      ).json();
      const completed = await waitForEvalRun(app, started.id);
      expect(completed.state).toBe('completed');

      const byCaseId = new Map(completed.per_trace.map((r: { case_id: string }) => [r.case_id, r]));
      expect(byCaseId.get(caseA.id)?.status).toBe('passed');
      expect(byCaseId.get(caseB.id)?.status).toBe('passed');

      const docs = completed.captured_context.documents;
      expect(docs).toEqual(
        expect.arrayContaining([
          {
            repo_id: repoA.id,
            path: 'specs/from-a.md',
            text: 'FULL TEXT FROM REPO A — every line must reach captured_context verbatim.',
          },
          {
            repo_id: repoB.id,
            path: 'specs/from-b.md',
            text: 'FULL TEXT FROM REPO B — every line must reach captured_context verbatim.',
          },
        ]),
      );
      expect(docs).toHaveLength(2);

      await app.close();
    },
    30_000,
  );

  it(
    'a case whose attached file was deleted from the working copy before the run is still evaluated (AC-51), and the run records that path as excluded with a reason (AC-52)',
    async () => {
      const app = await makeApp();
      const agent = await createAgent(app);

      const repo = await makeSyncedRepo([
        { path: 'docs/will-be-deleted.md', contents: 'this file is removed before the run' },
      ]);
      await createSkillAttachedTo(app, agent.id, repo.id, 'docs/will-be-deleted.md');
      const kase = await createCase(app, agent.id, repo.id);

      await rm(join(repo.clonePath, 'docs/will-be-deleted.md'));

      const started = (
        await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` })
      ).json();
      const completed = await waitForEvalRun(app, started.id);

      expect(completed.state).toBe('completed');
      // AC-51 — the case still evaluated; a missing attachment is not an error.
      const result = completed.per_trace.find((r: { case_id: string }) => r.case_id === kase.id);
      expect(result?.status).toBe('passed');
      expect(result?.errored).toBe(false);

      // AC-52 — the run records the absent path with a reason, and reads no text for it.
      expect(completed.captured_context.documents).toEqual([]);
      expect(completed.captured_context.excluded).toEqual(
        expect.arrayContaining([{ path: 'docs/will-be-deleted.md', reason: 'absent' }]),
      );

      await app.close();
    },
    30_000,
  );

  it('a case with repo_id: null produces no document and no exclusion — its context resolution is skipped entirely (AC-49)', async () => {
    const app = await makeApp();
    const agent = await createAgent(app);

    // The agent DOES have project context available (via a linked skill) —
    // proving the null-repo case's empty contribution is because the
    // resolver was never called for it, not because there was nothing to find.
    const repo = await makeSyncedRepo([{ path: 'specs/available.md', contents: 'would be found for a repo-scoped case' }]);
    await createSkillAttachedTo(app, agent.id, repo.id, 'specs/available.md');

    const kase = await createCase(app, agent.id, null);

    const started = (
      await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` })
    ).json();
    const completed = await waitForEvalRun(app, started.id);

    expect(completed.state).toBe('completed');
    const result = completed.per_trace.find((r: { case_id: string }) => r.case_id === kase.id);
    expect(result?.status).toBe('passed');
    expect(result?.errored).toBe(false);

    // Nothing was resolved for this run at all: the only case is repo_id:
    // null, so `resolveCaseContext` short-circuits without ever calling
    // `ContextService.assembleForRun` — no document, no exclusion.
    expect(completed.captured_context.documents).toEqual([]);
    expect(completed.captured_context.excluded).toEqual([]);

    await app.close();
  });
});
