import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { SkillsRepository } from '../src/modules/skills/repository.js';
import { SkillsService } from '../src/modules/skills/service.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skills-versions] Docker not available — skipping integration tests.');
}

/**
 * Skill version history, notes, restore and the per-skill stats rollup, over a
 * real Postgres. Mirrors `agents-versions.it.test.ts`.
 */
d('skill version history', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  async function createSkill(app: Awaited<ReturnType<typeof makeApp>>) {
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name: `skill-${Math.random().toString(36).slice(2, 8)}`,
        description: 'Use when reviewing tests.',
        type: 'rubric',
        body: 'line one\nline two\nline three',
      },
    });
    return res.json() as { id: string; version: number };
  }

  it('a save with a note persists it, with non-zero line deltas', async () => {
    const app = await makeApp();
    const { id } = await createSkill(app);

    const edited = await app.inject({
      method: 'PUT',
      url: `/skills/${id}`,
      payload: { body: 'line one\nline TWO\nline three\nline four', note: 'Tightened the rubric' },
    });
    expect(edited.json().version).toBe(2);

    const list = await app.inject({ method: 'GET', url: `/skills/${id}/versions` });
    expect(list.statusCode).toBe(200);
    const versions = list.json() as {
      version: number;
      note: string | null;
      lines_added: number;
      lines_removed: number;
    }[];
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ version: 2, note: 'Tightened the rubric' });
    expect(versions[0]!.lines_added).toBeGreaterThan(0);
    expect(versions[0]!.lines_removed).toBeGreaterThan(0);
    // v1 has no predecessor to diff against — every line counts as added.
    expect(versions[1]).toMatchObject({ version: 1, note: null, lines_added: 3, lines_removed: 0 });
    // The list response never carries a body.
    expect(versions[0]).not.toHaveProperty('body');
  });

  it('a note on a save that does not change the body is discarded and adds no version', async () => {
    const app = await makeApp();
    const { id } = await createSkill(app);

    const renamed = await app.inject({
      method: 'PUT',
      url: `/skills/${id}`,
      payload: { name: 'renamed', note: 'this should be dropped' },
    });
    expect(renamed.json().version).toBe(1);

    const versions = await app.inject({ method: 'GET', url: `/skills/${id}/versions` });
    expect(versions.json()).toHaveLength(1);
    expect((versions.json() as { note: string | null }[])[0]!.note).toBeNull();
  });

  it('GET .../versions/:version returns the historical body; 404s unknown; 422s non-numeric', async () => {
    const app = await makeApp();
    const { id } = await createSkill(app);
    await app.inject({
      method: 'PUT',
      url: `/skills/${id}`,
      payload: { body: 'a whole new body' },
    });

    const v1 = await app.inject({ method: 'GET', url: `/skills/${id}/versions/1` });
    expect(v1.statusCode).toBe(200);
    expect(v1.json().body).toBe('line one\nline two\nline three');

    expect((await app.inject({ method: 'GET', url: `/skills/${id}/versions/99` })).statusCode).toBe(
      404,
    );
    expect(
      (await app.inject({ method: 'GET', url: `/skills/${id}/versions/not-a-number` }))
        .statusCode,
    ).toBe(422);
  });

  it('restore appends a NEW version and leaves the intermediate snapshot intact', async () => {
    const app = await makeApp();
    const { id } = await createSkill(app); // v1: "line one\nline two\nline three"
    await app.inject({ method: 'PUT', url: `/skills/${id}`, payload: { body: 'v2 body' } });
    await app.inject({ method: 'PUT', url: `/skills/${id}`, payload: { body: 'v3 body' } });

    const restore = await app.inject({
      method: 'POST',
      url: `/skills/${id}/versions/1/restore`,
      payload: {},
    });
    expect(restore.statusCode).toBe(200);
    expect(restore.json().version).toBe(4);
    expect(restore.json().body).toBe('line one\nline two\nline three');

    const versions = await app.inject({ method: 'GET', url: `/skills/${id}/versions` });
    expect((versions.json() as { version: number }[]).map((v) => v.version)).toEqual([4, 3, 2, 1]);

    // v2's snapshot is untouched by the v1 restore.
    const v2 = await app.inject({ method: 'GET', url: `/skills/${id}/versions/2` });
    expect(v2.json().body).toBe('v2 body');
  });

  it('restoring the current version is a no-op — no new row, version unchanged', async () => {
    const app = await makeApp();
    const { id } = await createSkill(app);

    const restore = await app.inject({
      method: 'POST',
      url: `/skills/${id}/versions/1/restore`,
      payload: {},
    });
    expect(restore.statusCode).toBe(200);
    expect(restore.json().version).toBe(1);

    const versions = await app.inject({ method: 'GET', url: `/skills/${id}/versions` });
    expect(versions.json()).toHaveLength(1);
  });

  it("versions are workspace-scoped: another tenant's context cannot read or restore them", async () => {
    const { db } = pg.handle;
    const [otherWs] = await db
      .insert(t.workspaces)
      .values({ name: `other-${Math.random().toString(36).slice(2, 8)}` })
      .returning();
    const repo = new SkillsRepository(db);
    const foreign = await repo.insert({
      workspaceId: otherWs!.id,
      name: 'Foreign skill',
      description: 'Use when …',
      type: 'rubric',
      source: 'manual',
      body: 'foreign body',
    });

    const service = new SkillsService({ repo });
    const [{ id: defaultWs }] = await db
      .select({ id: t.workspaces.id })
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));

    // Owner's workspace can read; the default (request) workspace is denied —
    // undefined → 404 at the route, same contract as the agents module.
    expect(await service.listVersions(otherWs!.id, foreign.id)).toHaveLength(1);
    expect(await service.listVersions(defaultWs!, foreign.id)).toBeUndefined();
    expect(await service.getVersion(defaultWs!, foreign.id, 1)).toBeUndefined();
    expect(await service.restoreVersion(defaultWs!, foreign.id, 1)).toBeUndefined();
  });

  it('GET /skills/stats returns agent_count per skill, 0 for an unlinked one, before /skills/:id', async () => {
    const app = await makeApp();
    const { id } = await createSkill(app); // freshly created, unlinked to any agent

    const stats = await app.inject({ method: 'GET', url: '/skills/stats' });
    expect(stats.statusCode).toBe(200);
    const rows = stats.json() as { skill_id: string; agent_count: number }[];

    const unlinked = rows.find((r) => r.skill_id === id);
    expect(unlinked).toEqual({ skill_id: id, agent_count: 0 });

    const skills = (await app.inject({ method: 'GET', url: '/skills' })).json() as {
      id: string;
      name: string;
    }[];
    const seeded = skills.find((s) => s.name === 'test-coverage-rubric')!;
    const linked = rows.find((r) => r.skill_id === seeded.id)!;
    expect(linked.agent_count).toBeGreaterThanOrEqual(1);
    expect(typeof linked.agent_count).toBe('number');
  });
});
