/**
 * T23 — modules/context routes over a real Postgres. Modelled on
 * `test/blast.it.test.ts`. Writes a temp working copy on disk, points a
 * `repos` row's `clonePath` at it, then exercises the discoverable-set
 * listing (AC-1), the usage count across direct/skill-inherited/disabled
 * agents (AC-8), attachment persistence across a fresh read (AC-9), and
 * workspace scoping.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[context] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

async function writeFileAt(root: string, rel: string, contents: string): Promise<void> {
  const full = join(root, rel);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, contents);
}

d('modules/context routes (Postgres)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        // server/insights.md 2026-08-07: without this, an adapter resolved
        // through SecretsProvider can reach the real network mid-test — the
        // tokenizer here is real (deterministic, no network) but every other
        // adapter constructed at app-build time must fail fast instead.
        secrets: new MockSecretsProvider(),
        git: new MockGitClient(),
        github: new MockGitHubClient(),
      },
    });
  }

  let seq = 0;
  /** Inserts a `repos` row whose `clonePath` points at a fresh temp working
   *  copy containing `files` ({ path, contents }), and whose `lastPolledAt`
   *  marks it as synced. */
  async function makeSyncedRepo(
    ws: string,
    files: { path: string; contents: string }[],
  ): Promise<{ id: string; clonePath: string }> {
    const clonePath = await mkdtemp(join(tmpdir(), 'context-it-'));
    for (const f of files) await writeFileAt(clonePath, f.path, f.contents);

    const name = `context-repo-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: ws,
        owner: 'acme',
        name,
        fullName: `acme/${name}`,
        clonePath,
        lastPolledAt: new Date(),
      })
      .returning();
    return { id: repo!.id, clonePath };
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

  it("lists every markdown document of the synced working copy with its containing folder", async () => {
    const app = await makeApp();
    const repo = await makeSyncedRepo(workspaceId, [
      { path: 'README.md', contents: '# root readme' },
      { path: 'docs/guide.md', contents: '# guide\n\nSome words here.' },
      { path: 'notes.txt', contents: 'not markdown, excluded' },
    ]);

    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context/documents` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      documents: { path: string; folder: string; token_count: number; usage_count: number }[];
      document_count: number;
      synced: boolean;
    };

    expect(body.synced).toBe(true);
    expect(body.documents.map((doc) => doc.path)).toEqual(['README.md', 'docs/guide.md']);
    expect(body.document_count).toBe(2);

    const readme = body.documents.find((doc) => doc.path === 'README.md')!;
    expect(readme.folder).toBe('');
    expect(typeof readme.token_count).toBe('number');
    expect(readme.token_count).toBeGreaterThan(0);
    expect(readme.usage_count).toBe(0);

    const guide = body.documents.find((doc) => doc.path === 'docs/guide.md')!;
    expect(guide.folder).toBe('docs');

    await app.close();
  });

  it(
    'usage count counts an agent once whether it reaches the document directly, via a skill, or both',
    async () => {
      const app = await makeApp();
      const repo = await makeSyncedRepo(workspaceId, [{ path: 'shared.md', contents: '# shared' }]);

      const agentA = await createAgent(app);
      const agentB = await createAgent(app);
      const skill = await createSkill(app);

      // agentA links the skill, and reaches shared.md BOTH directly and
      // through that skill — must still count as ONE agent.
      const link = await app.inject({
        method: 'POST',
        url: `/agents/${agentA.id}/skills`,
        payload: { skill_id: skill.id },
      });
      expect(link.statusCode).toBe(200);

      const attachAgentA = await app.inject({
        method: 'PUT',
        url: `/agents/${agentA.id}/context`,
        payload: { repo_id: repo.id, paths: ['shared.md'] },
      });
      expect(attachAgentA.statusCode).toBe(200);

      const attachSkill = await app.inject({
        method: 'PUT',
        url: `/skills/${skill.id}/context`,
        payload: { repo_id: repo.id, paths: ['shared.md'] },
      });
      expect(attachSkill.statusCode).toBe(200);

      const usageAfterA = await app.inject({
        method: 'GET',
        url: `/repos/${repo.id}/context/documents`,
      });
      const docsAfterA = usageAfterA.json().documents as { path: string; usage_count: number }[];
      expect(docsAfterA.find((doc) => doc.path === 'shared.md')!.usage_count).toBe(1);

      // A second, unrelated agent attaches the SAME document directly.
      const attachAgentB = await app.inject({
        method: 'PUT',
        url: `/agents/${agentB.id}/context`,
        payload: { repo_id: repo.id, paths: ['shared.md'] },
      });
      expect(attachAgentB.statusCode).toBe(200);

      const usageAfterB = await app.inject({
        method: 'GET',
        url: `/repos/${repo.id}/context/documents`,
      });
      const docsAfterB = usageAfterB.json().documents as { path: string; usage_count: number }[];
      expect(docsAfterB.find((doc) => doc.path === 'shared.md')!.usage_count).toBe(2);

      // Disabling agentA does not change the count — disabled owners are
      // still counted (spec Contracts: "the count answers who carries this
      // document, not who is running today").
      const disable = await app.inject({
        method: 'PUT',
        url: `/agents/${agentA.id}`,
        payload: { enabled: false },
      });
      expect(disable.statusCode).toBe(200);
      expect(disable.json().enabled).toBe(false);

      const usageAfterDisable = await app.inject({
        method: 'GET',
        url: `/repos/${repo.id}/context/documents`,
      });
      const docsAfterDisable = usageAfterDisable.json().documents as {
        path: string;
        usage_count: number;
      }[];
      expect(docsAfterDisable.find((doc) => doc.path === 'shared.md')!.usage_count).toBe(2);

      await app.close();
    },
  );

  it('an attachment survives a fresh read of the owner', async () => {
    const app = await makeApp();
    const repo = await makeSyncedRepo(workspaceId, [
      { path: 'a.md', contents: '# a' },
      { path: 'b.md', contents: '# b' },
    ]);
    const agent = await createAgent(app);
    const skill = await createSkill(app);

    const putAgent = await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: { repo_id: repo.id, paths: ['b.md', 'a.md'] },
    });
    expect(putAgent.statusCode).toBe(200);

    const putSkill = await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}/context`,
      payload: { repo_id: repo.id, paths: ['a.md'] },
    });
    expect(putSkill.statusCode).toBe(200);

    // Fresh reads — a NEW app instance, not the connection that wrote them —
    // prove the ordered set was actually persisted, not just echoed back.
    const freshApp = await makeApp();

    const agentRead = await freshApp.inject({ method: 'GET', url: `/agents/${agent.id}/context` });
    expect(agentRead.statusCode).toBe(200);
    const agentSet = agentRead.json() as { attachments: { path: string; order: number }[] };
    expect(agentSet.attachments.map((a) => a.path)).toEqual(['b.md', 'a.md']);
    expect(agentSet.attachments.map((a) => a.order)).toEqual([0, 1]);

    const skillRead = await freshApp.inject({ method: 'GET', url: `/skills/${skill.id}/context` });
    expect(skillRead.statusCode).toBe(200);
    const skillSet = skillRead.json() as { attachments: { path: string }[] };
    expect(skillSet.attachments.map((a) => a.path)).toEqual(['a.md']);

    await app.close();
    await freshApp.close();
  });

  it('a repo, agent or skill from another workspace 404s', async () => {
    const app = await makeApp();
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other-context-ws' })
      .returning();

    const otherRepo = await makeSyncedRepo(otherWs!.id, [{ path: 'x.md', contents: '# x' }]);
    const otherAgent = await createAgentInWorkspace(app, otherWs!.id);
    const otherSkill = await createSkillInWorkspace(otherWs!.id);

    const repoRes = await app.inject({
      method: 'GET',
      url: `/repos/${otherRepo.id}/context/documents`,
    });
    expect(repoRes.statusCode).toBe(404);

    const agentGet = await app.inject({ method: 'GET', url: `/agents/${otherAgent}/context` });
    expect(agentGet.statusCode).toBe(404);

    const agentPut = await app.inject({
      method: 'PUT',
      url: `/agents/${otherAgent}/context`,
      payload: { repo_id: otherRepo.id, paths: ['x.md'] },
    });
    expect(agentPut.statusCode).toBe(404);

    const skillGet = await app.inject({ method: 'GET', url: `/skills/${otherSkill}/context` });
    expect(skillGet.statusCode).toBe(404);

    const skillPut = await app.inject({
      method: 'PUT',
      url: `/skills/${otherSkill}/context`,
      payload: { repo_id: otherRepo.id, paths: ['x.md'] },
    });
    expect(skillPut.statusCode).toBe(404);

    await app.close();
  });

  /** Insert an agent directly (bypassing the workspace-scoped `POST /agents`
   *  route, which always writes to the DEFAULT workspace via getContext). */
  async function createAgentInWorkspace(
    app: Awaited<ReturnType<typeof buildApp>>,
    ws: string,
  ): Promise<string> {
    void app;
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: ws,
        name: `other-ws-agent-${seq++}`,
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: 'Review the diff.',
      })
      .returning();
    return agent!.id;
  }

  async function createSkillInWorkspace(ws: string): Promise<string> {
    const [skill] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId: ws,
        name: `other-ws-skill-${seq++}`,
        description: 'Use when reviewing tests.',
        type: 'rubric',
        source: 'manual',
        body: '## rule\nDo the thing.',
      })
      .returning();
    return skill!.id;
  }
});
