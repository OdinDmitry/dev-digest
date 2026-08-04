import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[conventions] Docker not available — skipping integration tests.');
}

/**
 * Extraction end-to-end over a real Postgres + a real clone directory on
 * disk: the code-based grounding gate drops fabricated evidence, a re-scan
 * preserves accepted/rejected decisions, and merge-preview drafts a skill
 * body only from the conventions it was given.
 */
d('conventions module', () => {
  let pg: PgFixture;
  let clonePath: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    clonePath = await mkdtemp(join(tmpdir(), 'ddg-conventions-it-'));
    await writeFile(
      join(clonePath, 'tsconfig.json'),
      '{\n  "compilerOptions": {\n    "strict": true\n  }\n}\n',
    );
  });
  afterAll(async () => {
    await pg?.stop();
    await rm(clonePath, { recursive: true, force: true });
  });

  async function makeRepo() {
    const [ws] = await pg.handle.db.select().from(t.workspaces).limit(1);
    const suffix = Math.random().toString(36).slice(2, 8);
    const [row] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: ws!.id,
        owner: 'acme',
        name: `repo-${suffix}`,
        fullName: `acme/repo-${suffix}`,
        clonePath,
      })
      .returning();
    return row!;
  }

  function makeApp(llmFixture: unknown) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        llm: { openai: new MockLLMProvider('openai', { structured: llmFixture }) },
      },
    });
  }

  it('keeps a grounded candidate, drops a fabricated line and a missing file', async () => {
    const repo = await makeRepo();
    const app = await makeApp({
      candidates: [
        {
          category: 'config',
          rule: 'Enable strict TypeScript',
          evidence: { file: 'tsconfig.json', start_line: 3, end_line: 3, snippet: '"strict": true' },
          confidence: 0.9,
        },
        {
          category: 'bogus',
          rule: 'A rule with a fabricated line number',
          evidence: { file: 'tsconfig.json', start_line: 999, end_line: 999, snippet: 'nope' },
          confidence: 0.5,
        },
        {
          category: 'missing-file',
          rule: 'A rule citing a file that does not exist',
          evidence: { file: 'does-not-exist.ts', start_line: 1, end_line: 1, snippet: 'nope' },
          confidence: 0.5,
        },
      ],
    });

    const res = await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      candidates: { rule: string; status: string }[];
      scanned_files: string[];
    };
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0]!.rule).toBe('Enable strict TypeScript');
    expect(body.candidates[0]!.status).toBe('pending');
    expect(body.scanned_files).toContain('tsconfig.json');
  });

  it('re-scan preserves an accepted decision and only refreshes pending rows', async () => {
    const repo = await makeRepo();
    const app = await makeApp({
      candidates: [
        {
          category: 'config',
          rule: 'First scan rule',
          evidence: { file: 'tsconfig.json', start_line: 3, end_line: 3, snippet: '"strict": true' },
          confidence: 0.8,
        },
      ],
    });

    const first = await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` });
    const [candidate] = (first.json() as { candidates: { id: string }[] }).candidates;

    const accept = await app.inject({
      method: 'PUT',
      url: `/conventions/${candidate!.id}`,
      payload: { status: 'accepted' },
    });
    expect(accept.statusCode).toBe(200);

    const second = await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` });
    expect(second.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: `/repos/${repo.id}/conventions` });
    const rows = list.json() as { id: string; status: string }[];
    const survived = rows.find((r) => r.id === candidate!.id);
    expect(survived?.status).toBe('accepted');
  });

  it('merge-preview drafts a skill body only from the given conventions', async () => {
    const repo = await makeRepo();
    const app = await makeApp({
      candidates: [
        {
          category: 'config',
          rule: 'Enable strict TypeScript',
          evidence: { file: 'tsconfig.json', start_line: 3, end_line: 3, snippet: '"strict": true' },
          confidence: 0.9,
        },
      ],
    });
    const extracted = await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` });
    const [candidate] = (extracted.json() as { candidates: { id: string }[] }).candidates;
    await app.inject({
      method: 'PUT',
      url: `/conventions/${candidate!.id}`,
      payload: { status: 'accepted' },
    });

    const preview = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/conventions/merge-preview`,
      payload: { convention_ids: [candidate!.id] },
    });
    expect(preview.statusCode).toBe(200);
    const previewBody = preview.json() as { body: string; evidence_files: string[]; type: string };
    expect(previewBody.body).toContain('Enable strict TypeScript');
    expect(previewBody.body).toContain('tsconfig.json:3');
    expect(previewBody.evidence_files).toEqual(['tsconfig.json']);
    expect(previewBody.type).toBe('convention');
  });

  it('deletes a candidate permanently, regardless of status', async () => {
    const repo = await makeRepo();
    const app = await makeApp({
      candidates: [
        {
          category: 'config',
          rule: 'Enable strict TypeScript',
          evidence: { file: 'tsconfig.json', start_line: 3, end_line: 3, snippet: '"strict": true' },
          confidence: 0.9,
        },
      ],
    });
    const extracted = await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` });
    const [candidate] = (extracted.json() as { candidates: { id: string }[] }).candidates;

    const del = await app.inject({ method: 'DELETE', url: `/conventions/${candidate!.id}` });
    expect(del.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: `/repos/${repo.id}/conventions` });
    expect(list.json() as unknown[]).toHaveLength(0);

    const delAgain = await app.inject({ method: 'DELETE', url: `/conventions/${candidate!.id}` });
    expect(delAgain.statusCode).toBe(404);
  });
});
