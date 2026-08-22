/**
 * `modules/evals` suite-run project-context resolution over a real Postgres.
 * Content-only evals (AC-11 / AC-49 / AC-52): captured_context stays empty even
 * when the agent has attachments and cases carry a legacy repo_id.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
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

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const CLEAN_REVIEW = { verdict: 'approve' as const, summary: 'Clean.', score: 100, findings: [] };

async function writeFileAt(root: string, rel: string, contents: string): Promise<void> {
  const full = join(root, rel);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, contents);
}

d('modules/evals — suite-run project context is never resolved (Postgres)', () => {
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

  async function createCase(app: Awaited<ReturnType<typeof makeApp>>, agentId: string) {
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/eval-cases`,
      payload: {
        name: `case-${seq++}`,
        input_diff: DIFF,
        repo_id: null,
        expectations: [
          { kind: 'must_not_flag', file: 'src/config.ts', start_line: 11, end_line: 11 },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    return res.json() as { id: string; resolves_context: boolean };
  }

  it(
    'a suite run leaves captured_context empty even when the agent has attachments (AC-49, AC-52)',
    async () => {
      const app = await makeApp();
      const agent = await createAgent(app);

      const repo = await makeSyncedRepo([
        { path: 'specs/from-a.md', contents: 'MUST NOT appear in captured_context.' },
      ]);
      await createSkillAttachedTo(app, agent.id, repo.id, 'specs/from-a.md');
      const kase = await createCase(app, agent.id);
      expect(kase.resolves_context).toBe(false);

      const started = (
        await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` })
      ).json();
      const completed = await waitForEvalRun(app, started.id);
      expect(completed.state).toBe('completed');

      const result = completed.per_trace.find((r: { case_id: string }) => r.case_id === kase.id);
      expect(result?.status).toBe('passed');
      expect(completed.captured_context.documents).toEqual([]);
      expect(completed.captured_context.excluded).toEqual([]);

      await app.close();
    },
    30_000,
  );

  it(
    'legacy case rows with a repo_id still get empty context on run (runner always-empty)',
    async () => {
      const app = await makeApp();
      const agent = await createAgent(app);
      const repo = await makeSyncedRepo([
        { path: 'specs/legacy.md', contents: 'legacy attachment text' },
      ]);
      await createSkillAttachedTo(app, agent.id, repo.id, 'specs/legacy.md');

      // Bypass the service (which forces null) and insert a legacy-shaped row.
      const [row] = await pg.handle.db
        .insert(t.evalCases)
        .values({
          workspaceId,
          ownerKind: 'agent',
          ownerId: agent.id,
          name: `legacy-case-${seq++}`,
          inputDiff: DIFF,
          repoId: repo.id,
          expectedOutput: [
            { kind: 'must_not_flag', file: 'src/config.ts', start_line: 11, end_line: 11 },
          ],
        })
        .returning();

      const started = (
        await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` })
      ).json();
      const completed = await waitForEvalRun(app, started.id);
      expect(completed.state).toBe('completed');
      const result = completed.per_trace.find((r: { case_id: string }) => r.case_id === row!.id);
      expect(result?.status).toBe('passed');
      expect(completed.captured_context.documents).toEqual([]);
      expect(completed.captured_context.excluded).toEqual([]);

      await app.close();
    },
    30_000,
  );
});
