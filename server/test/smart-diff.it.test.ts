import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[smart-diff] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * `GET /pulls/:id/smart-diff` — real Postgres. Covers the multi-agent finding
 * union (constraint 14 / §2), the re-run-supersedes-own-review case, the
 * no-review case, and cross-workspace 404 (constraint 5).
 */
d('GET /pulls/:id/smart-diff (Postgres)', () => {
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
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  let repoSeq = 0;
  async function setupRepoAndPr(ws: string) {
    const { db } = pg.handle;
    const name = `smart-diff-${repoSeq++}`;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws,
        repoId: repo!.id,
        number: 900 + repoSeq,
        title: 'Smart diff test PR',
        author: 'tester',
        branch: 'feat/x',
        base: 'main',
        headSha: 'deadbeef',
        additions: 10,
        deletions: 0,
        filesCount: 2,
        status: 'needs_review',
      })
      .returning();
    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/core.ts', additions: 5, deletions: 0 },
      { prId: pr!.id, path: 'package-lock.json', additions: 50, deletions: 0 },
    ]);
    return { repo: repo!, pr: pr! };
  }

  async function insertReview(
    ws: string,
    prId: string,
    opts: { agentId: string | null; file: string; line: number },
  ) {
    const { db } = pg.handle;
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId: ws,
        prId,
        agentId: opts.agentId,
        kind: 'review',
        verdict: 'request_changes',
        summary: 's',
        score: 80,
        model: 'seed',
      })
      .returning();
    await db.insert(t.findings).values({
      reviewId: review!.id,
      file: opts.file,
      startLine: opts.line,
      endLine: opts.line,
      severity: 'WARNING',
      category: 'bug',
      title: 't',
      rationale: 'r',
      confidence: 0.5,
    });
    return review!;
  }

  it('unions each agent\'s own latest review findings', async () => {
    const app = await makeApp();
    const { pr } = await setupRepoAndPr(workspaceId);
    const agentA = randomUUID();
    const agentB = randomUUID();
    await insertReview(workspaceId, pr.id, { agentId: agentA, file: 'src/core.ts', line: 1 });
    await insertReview(workspaceId, pr.id, { agentId: agentB, file: 'src/core.ts', line: 2 });

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const core = body.groups.find((g: { role: string }) => g.role === 'core');
    const file = core.files.find((f: { path: string }) => f.path === 'src/core.ts');
    expect(file.findings).toHaveLength(2);
    expect(file.findings.map((f: { line: number }) => f.line).sort()).toEqual([1, 2]);

    await app.close();
  });

  it('excludes dismissed findings from the response', async () => {
    const app = await makeApp();
    const { pr } = await setupRepoAndPr(workspaceId);
    const { db } = pg.handle;
    const agentA = randomUUID();
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr.id,
        agentId: agentA,
        kind: 'review',
        verdict: 'request_changes',
        summary: 's',
        score: 80,
        model: 'seed',
      })
      .returning();
    const [live, dismissed] = await db
      .insert(t.findings)
      .values([
        {
          reviewId: review!.id,
          file: 'src/core.ts',
          startLine: 3,
          endLine: 3,
          severity: 'WARNING',
          category: 'bug',
          title: 'live finding',
          rationale: 'r',
          confidence: 0.5,
        },
        {
          reviewId: review!.id,
          file: 'src/core.ts',
          startLine: 4,
          endLine: 4,
          severity: 'CRITICAL',
          category: 'security',
          title: 'dismissed finding',
          rationale: 'r',
          confidence: 0.9,
          dismissedAt: new Date(),
        },
      ])
      .returning();

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const core = body.groups.find((g: { role: string }) => g.role === 'core');
    const file = core.files.find((f: { path: string }) => f.path === 'src/core.ts');
    const findingIds = file.findings.map((f: { finding_id: string }) => f.finding_id);
    expect(findingIds).toEqual([live!.id]);
    expect(findingIds).not.toContain(dismissed!.id);

    await app.close();
  });

  it('a re-run of the same agent supersedes its own older review', async () => {
    const app = await makeApp();
    const { pr } = await setupRepoAndPr(workspaceId);
    const agentA = randomUUID();
    await insertReview(workspaceId, pr.id, { agentId: agentA, file: 'src/core.ts', line: 1 });
    // small delay so createdAt strictly orders the second insert after the first
    await new Promise((r) => setTimeout(r, 5));
    await insertReview(workspaceId, pr.id, { agentId: agentA, file: 'src/core.ts', line: 9 });

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    const body = res.json();
    const core = body.groups.find((g: { role: string }) => g.role === 'core');
    const file = core.files.find((f: { path: string }) => f.path === 'src/core.ts');
    expect(file.findings).toHaveLength(1);
    expect(file.findings[0].line).toBe(9);

    await app.close();
  });

  it('no review yet: empty findings arrays, still groups files', async () => {
    const app = await makeApp();
    const { pr } = await setupRepoAndPr(workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.groups.map((g: { role: string }) => g.role)).toEqual(['core', 'boilerplate']);
    for (const g of body.groups) {
      for (const f of g.files) {
        expect(f.findings).toEqual([]);
        expect(f.pseudocode_summary).toBeNull();
      }
    }

    await app.close();
  });

  it('another workspace\'s PR id 404s', async () => {
    const app = await makeApp();
    const { db } = pg.handle;
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'other-smart-diff' }).returning();
    const { pr } = await setupRepoAndPr(otherWs!.id);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(404);

    await app.close();
  });
});
