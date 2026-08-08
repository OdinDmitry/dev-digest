import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
  console.warn('[blast] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * `GET /pulls/:id/blast` — real Postgres. Seeds a repo + PR + `pr_files`,
 * inserts `symbols`/`references`/`file_edges`/`file_facts`/`file_rank`/
 * `repo_index_state` rows DIRECTLY (no indexer run — this is a route/facade
 * test, not a pipeline test), then asserts the route reads them back through
 * `repoIntel.getBlastRadius`.
 */
d('GET /pulls/:id/blast (Postgres)', () => {
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

  function makeApp() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        // No secrets in tests (server/insights.md 2026-08-07) — every adapter
        // resolved through SecretsProvider fails fast with ConfigError
        // instead of silently going to the network. This route makes no LLM
        // or GitHub call, but the mock costs nothing and keeps the test
        // hermetic against future changes to what boots at app construction.
        secrets: new MockSecretsProvider(),
        git: new MockGitClient(),
        github: new MockGitHubClient(),
      },
    });
  }

  let repoSeq = 0;
  async function setupRepoAndPr(ws: string, changedPath = 'src/core.ts') {
    const { db } = pg.handle;
    const name = `blast-${repoSeq++}`;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws,
        repoId: repo!.id,
        number: 700 + repoSeq,
        title: 'Blast radius test PR',
        author: 'tester',
        branch: 'feat/blast',
        base: 'main',
        headSha: 'deadbeef',
        additions: 10,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    await db.insert(t.prFiles).values([{ prId: pr!.id, path: changedPath, additions: 5, deletions: 0 }]);
    return { repo: repo!, pr: pr! };
  }

  /**
   * Seeds a small persistent index: `changedFile` declares one symbol
   * ('doThing'), two caller files reference it (resolved via
   * `references.decl_file`), each caller has a `file_rank` row (required by
   * `getResolvedCallers`'s inner join), and `changedFile` itself carries a
   * `file_facts` endpoint — so the endpoint is attributed at hops: 0 without
   * needing any `file_edges` at all.
   */
  async function seedPersistentIndex(repoId: string, changedFile: string) {
    const { db } = pg.handle;
    await db.insert(t.symbols).values([
      { repoId, path: changedFile, name: 'doThing', kind: 'function', line: 1, endLine: 3, exported: true },
      { repoId, path: 'src/caller1.ts', name: 'handler1', kind: 'function', line: 1, endLine: 2, exported: true },
      { repoId, path: 'src/caller2.ts', name: 'handler2', kind: 'function', line: 1, endLine: 2, exported: true },
    ]);
    await db.insert(t.references).values([
      { repoId, fromPath: 'src/caller1.ts', toSymbol: 'doThing', line: 5, declFile: changedFile },
      { repoId, fromPath: 'src/caller2.ts', toSymbol: 'doThing', line: 8, declFile: changedFile },
    ]);
    await db.insert(t.fileRank).values([
      { repoId, filePath: 'src/caller1.ts', pagerank: 0.5, hotness: 0, rank: 0.5, percentile: 80 },
      { repoId, filePath: 'src/caller2.ts', pagerank: 0.3, hotness: 0, rank: 0.3, percentile: 60 },
    ]);
    await db.insert(t.fileFacts).values([
      { repoId, filePath: changedFile, endpoints: ['GET /core'], crons: [] },
    ]);
    await db.insert(t.repoIndexState).values({
      repoId,
      lastIndexedSha: 'deadbeef',
      indexerVersion: 2,
      status: 'full',
      filesIndexed: 3,
      filesSkipped: 0,
      stats: {},
    });
  }

  it('returns a 200 with >=2 callers and >=1 endpoint from the persistent index', async () => {
    const app = await makeApp();
    const { repo, pr } = await setupRepoAndPr(workspaceId);
    await seedPersistentIndex(repo.id, 'src/core.ts');

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.state).toBe('ok');
    expect(body.reason).toBeNull();
    expect(body.pr_id).toBe(pr.id);
    expect(body.repo_id).toBe(repo.id);
    expect(body.changed_symbols).toEqual([
      { file: 'src/core.ts', name: 'doThing', kind: 'function', line: 1 },
    ]);
    expect(body.callers.length).toBeGreaterThanOrEqual(2);
    const percentileByFile: Record<string, number> = {
      'src/caller1.ts': 80,
      'src/caller2.ts': 60,
    };
    for (const caller of body.callers) {
      expect(caller.via_symbol).toBe('doThing');
      expect(typeof caller.percentile).toBe('number');
      expect(caller.percentile).toBe(percentileByFile[caller.file]);
    }
    expect(body.impacted_endpoints.length).toBeGreaterThanOrEqual(1);
    expect(body.impacted_endpoints).toContainEqual({ endpoint: 'GET /core', file: 'src/core.ts', hops: 0 });

    await app.close();
  });

  it("another workspace's PR id 404s", async () => {
    const app = await makeApp();
    const { db } = pg.handle;
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'other-blast' }).returning();
    const { repo, pr } = await setupRepoAndPr(otherWs!.id);
    await seedPersistentIndex(repo.id, 'src/core.ts');

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('a non-uuid :id 422s (IdParams guard)', async () => {
    const app = await makeApp();

    const res = await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/blast' });
    expect(res.statusCode).toBe(422);

    await app.close();
  });

  it('degraded index state (no repo_index_state row) returns state: degraded without an empty-array "no impact" illusion', async () => {
    const app = await makeApp();
    const { pr } = await setupRepoAndPr(workspaceId);
    // No seedPersistentIndex call — no repo_index_state row at all, so
    // getIndexState synthesises a degraded row (facade default).

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.state).toBe('degraded');
    expect(body.reason).not.toBeNull();
    expect(body.changed_symbols).toEqual([]);
    expect(body.callers).toEqual([]);
    expect(body.impacted_endpoints).toEqual([]);

    await app.close();
  });
});
