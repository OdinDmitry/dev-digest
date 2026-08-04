import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { zipSync, strToU8 } from 'fflate';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skills] Docker not available — skipping integration tests.');
}

/**
 * Skills CRUD over a real Postgres: the versioning rule (only a body edit
 * snapshots), the cascade on delete, workspace scoping, and the promise that
 * `import/preview` writes nothing.
 */
d('skills module', () => {
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

  const body = (over: Record<string, unknown> = {}) => ({
    name: `skill-${Math.random().toString(36).slice(2, 8)}`,
    description: 'Use when reviewing tests.',
    type: 'rubric' as const,
    body: '## rule\nDo the thing.',
    ...over,
  });

  it('seeds the three test-quality skills, linked to the Test Quality Reviewer in order', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/skills' });
    expect(res.statusCode).toBe(200);
    const names = (res.json() as { name: string }[]).map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining(['test-coverage-rubric', 'edge-case-checklist', 'mock-discipline']),
    );

    const agents = await app.inject({ method: 'GET', url: '/agents' });
    const agent = (agents.json() as { id: string; name: string }[]).find(
      (a) => a.name === 'Test Quality Reviewer',
    );
    expect(agent).toBeDefined();

    const links = await app.inject({ method: 'GET', url: `/agents/${agent!.id}/skills` });
    const ordered = (links.json() as { skill_id: string; order: number }[]).map((l) => l.order);
    expect(ordered).toEqual([0, 1, 2]);
  });

  it('creates a skill at v1 with one immutable snapshot', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/skills', payload: body() });
    expect(res.statusCode).toBe(201);
    const skill = res.json() as { id: string; version: number; source: string; enabled: boolean };
    expect(skill.version).toBe(1);
    expect(skill.source).toBe('manual');
    expect(skill.enabled).toBe(true);

    const versions = await pg.handle.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skill.id));
    expect(versions).toHaveLength(1);
    expect(versions[0]!.version).toBe(1);
  });

  it('renaming does not version the skill; editing the body does', async () => {
    const app = await makeApp();
    const created = await app.inject({ method: 'POST', url: '/skills', payload: body() });
    const id = created.json().id as string;

    const renamed = await app.inject({
      method: 'PUT',
      url: `/skills/${id}`,
      payload: { name: 'renamed-skill', description: 'Use when …', enabled: false },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().version).toBe(1);
    expect(renamed.json().enabled).toBe(false);

    const edited = await app.inject({
      method: 'PUT',
      url: `/skills/${id}`,
      payload: { body: '## rule\nDo a different thing.' },
    });
    expect(edited.json().version).toBe(2);

    const versions = await app.inject({ method: 'GET', url: `/skills/${id}/versions` });
    expect((versions.json() as { version: number }[]).map((v) => v.version)).toEqual([2, 1]);

    // v1 still holds the ORIGINAL body — snapshots are immutable.
    const rows = await pg.handle.db
      .select()
      .from(t.skillVersions)
      .where(and(eq(t.skillVersions.skillId, id), eq(t.skillVersions.version, 1)));
    expect(rows[0]!.body).toBe('## rule\nDo the thing.');
  });

  it('deleting a skill cascades to its versions and unlinks it from agents', async () => {
    const app = await makeApp();
    const created = await app.inject({ method: 'POST', url: '/skills', payload: body() });
    const skillId = created.json().id as string;

    const agents = await app.inject({ method: 'GET', url: '/agents' });
    const agentId = (agents.json() as { id: string }[])[0]!.id;
    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_id: skillId },
    });

    const del = await app.inject({ method: 'DELETE', url: `/skills/${skillId}` });
    expect(del.statusCode).toBe(200);

    expect(
      await pg.handle.db.select().from(t.skillVersions).where(eq(t.skillVersions.skillId, skillId)),
    ).toHaveLength(0);
    expect(
      await pg.handle.db.select().from(t.agentSkills).where(eq(t.agentSkills.skillId, skillId)),
    ).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: `/skills/${skillId}` })).statusCode).toBe(404);
  });

  it('404s an unknown skill and 422s a non-uuid id', async () => {
    const app = await makeApp();
    const missing = '00000000-0000-4000-8000-000000000000';
    expect((await app.inject({ method: 'GET', url: `/skills/${missing}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url: `/skills/${missing}`, payload: { name: 'x' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/skills/not-a-uuid' })).statusCode).toBe(422);
  });

  it('rejects a create with an empty description — the description is the interface', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { ...body(), description: '' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('import/preview parses an archive and persists nothing', async () => {
    const app = await makeApp();
    const before = (await app.inject({ method: 'GET', url: '/skills' })).json() as unknown[];

    const zip = zipSync({
      'SKILL.md': strToU8('# imported-rule\n\nUse when reviewing tests.\n'),
      'scripts/run.sh': strToU8('echo nope'),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/skills/import/preview',
      payload: {
        filename: 'imported-rule.zip',
        content_base64: Buffer.from(zip).toString('base64'),
      },
    });

    expect(res.statusCode).toBe(200);
    const preview = res.json() as { name: string; source: string; skipped: { path: string }[] };
    expect(preview.name).toBe('imported-rule');
    expect(preview.source).toBe('imported_url');
    expect(preview.skipped.map((s) => s.path)).toEqual(['scripts/run.sh']);

    const after = (await app.inject({ method: 'GET', url: '/skills' })).json() as unknown[];
    expect(after).toHaveLength(before.length);
  });

  it('rejects an import that supplies both content and content_base64', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/skills/import/preview',
      payload: { filename: 'a.md', content: '# a\n\nb', content_base64: 'QQ==' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('GET /agents/stats rolls up skill counts without a per-card request', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/agents/stats' });
    expect(res.statusCode).toBe(200);

    const stats = res.json() as {
      agent_id: string;
      skill_count: number;
      run_count: number;
      avg_cost_usd: number | null;
    }[];
    const agents = (await app.inject({ method: 'GET', url: '/agents' })).json() as {
      id: string;
      name: string;
    }[];
    expect(stats).toHaveLength(agents.length);

    const testQuality = agents.find((a) => a.name === 'Test Quality Reviewer')!;
    const row = stats.find((s) => s.agent_id === testQuality.id)!;
    expect(row.skill_count).toBe(3);
    // Counts come back as numbers, not the strings postgres-js returns.
    expect(typeof row.run_count).toBe('number');
    // No runs in a fresh seed → null cost, which the UI renders as "—".
    expect(row.avg_cost_usd).toBeNull();
  });
});
