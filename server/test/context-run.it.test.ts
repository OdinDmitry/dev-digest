/**
 * modules/context — run-time injection (U5/U6, docs/plans/2026-08-16-project-
 * context-run-injection.md). Modelled on `test/reviews.it.test.ts` (running a
 * real agent through `buildApp` + `app.inject`) and `test/context.it.test.ts`
 * (a temp working copy on disk, `repos.clonePath` pointed at it).
 *
 * Runs one agent on a PR and reads back `GET /runs/:id/trace` to prove, in one
 * real run:
 *  - AC-11: a document attached to a SKILL the agent links appears in
 *    `prompt_assembly.specs` even though the agent has no attachment of its
 *    own for it.
 *  - AC-19: the block contains each attached document's FULL text, exactly as
 *    it is on disk.
 *  - AC-22: a document attached from a DIFFERENT repo than the PR's does not
 *    appear, and is reported in `specs_excluded` with `other_repo`.
 *  - AC-23: an attachment whose file has been deleted from the working copy
 *    does not appear, and is reported with `absent`.
 *  - AC-28 (data side): `specs_excluded` carries both entries with their
 *    paths and reasons, in assembled order.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockGitClient, MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Review, RunTrace } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[context-run] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

async function writeFileAt(root: string, rel: string, contents: string): Promise<void> {
  const full = join(root, rel);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, contents);
}

/**
 * A unified diff touching one file, matched to the mocked review fixture
 * below. The exact target file is irrelevant to project context — only the
 * PR's REPO id matters for other_repo/absent resolution.
 */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW_FIXTURE: Review = {
  verdict: 'approve',
  summary: 'Clean.',
  score: 100,
  findings: [],
};

d('modules/context — run-time injection (Postgres)', () => {
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
        // server/insights.md 2026-08-07: IntentService.ensure() runs before
        // every review and resolves review_intent's OWN provider (openrouter),
        // a different key than the `llm` override below — without a mocked
        // `secrets` provider it reaches for a real key and makes a real,
        // paid network call.
        secrets: new MockSecretsProvider(),
        git: new MockGitClient({ diff: DIFF }),
        github: new MockGitHubClient(),
        llm: { openai: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }) },
      },
    });
  }

  let seq = 0;
  async function makeSyncedRepo(
    files: { path: string; contents: string }[] = [],
  ): Promise<{ id: string; clonePath: string; owner: string; name: string }> {
    const clonePath = await mkdtemp(join(tmpdir(), 'context-run-it-'));
    for (const f of files) await writeFileAt(clonePath, f.path, f.contents);

    const owner = 'acme';
    const name = `context-run-repo-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner, name, fullName: `${owner}/${name}`, clonePath, lastPolledAt: new Date() })
      .returning();
    return { id: repo!.id, clonePath, owner, name };
  }

  async function makePr(repo: { id: string; owner: string; name: string }) {
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo.id,
        number: 900 + seq,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: null,
      })
      .returning();
    return pr!;
  }

  async function createAgent(app: Awaited<ReturnType<typeof buildApp>>) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: `context-run-agent-${Math.random().toString(36).slice(2, 8)}`,
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: 'Review the diff.',
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
        name: `context-run-skill-${Math.random().toString(36).slice(2, 8)}`,
        description: 'Use when reviewing.',
        type: 'rubric',
        body: '## rule\nDo the thing.',
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string };
  }

  it(
    'includes a skill-inherited document, sends its full text, and reports both an other-repo and an absent attachment as excluded',
    async () => {
      const app = await makeApp();

      const prRepo = await makeSyncedRepo([
        { path: 'specs/from-skill.md', contents: 'FULL-TEXT-FROM-SKILL — every line of this must reach the prompt verbatim.' },
        { path: 'docs/will-be-deleted.md', contents: 'this file is removed before the run' },
      ]);
      const otherRepo = await makeSyncedRepo([{ path: 'other-repo/note.md', contents: 'lives in a different repo' }]);
      const pr = await makePr(prRepo);

      const agent = await createAgent(app);
      const skill = await createSkill(app);

      // Skill-inherited attachment: same repo as the PR, present on disk —
      // must appear in the prompt (AC-11) even though the agent never
      // attaches it directly.
      const attachSkill = await app.inject({
        method: 'PUT',
        url: `/skills/${skill.id}/context`,
        payload: { repo_id: prRepo.id, paths: ['specs/from-skill.md'] },
      });
      expect(attachSkill.statusCode).toBe(200);

      const link = await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/skills`,
        payload: { skill_id: skill.id },
      });
      expect(link.statusCode).toBe(200);

      // Agent's own attachment, in a DIFFERENT repo than the PR's — excluded
      // with `other_repo` (AC-22).
      const attachAgentOtherRepo = await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}/context`,
        payload: { repo_id: otherRepo.id, paths: ['other-repo/note.md'] },
      });
      expect(attachAgentOtherRepo.statusCode).toBe(200);

      // A second skill, attached to the PR's repo but to a path that will be
      // deleted from the working copy before the run — excluded with
      // `absent` (AC-23).
      const absentSkill = await createSkill(app);
      const attachAbsentSkill = await app.inject({
        method: 'PUT',
        url: `/skills/${absentSkill.id}/context`,
        payload: { repo_id: prRepo.id, paths: ['docs/will-be-deleted.md'] },
      });
      expect(attachAbsentSkill.statusCode).toBe(200);
      const linkAbsent = await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/skills`,
        payload: { skill_id: absentSkill.id },
      });
      expect(linkAbsent.statusCode).toBe(200);

      // Delete the file from the working copy AFTER attaching it — the
      // attachment record still exists, but readDocument now returns null.
      await rm(join(prRepo.clonePath, 'docs/will-be-deleted.md'));

      const res = await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/review`,
        payload: { agentId: agent.id },
      });
      expect(res.statusCode).toBe(200);
      const runId = res.json().runs[0].run_id as string;

      await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

      const traceRes = await app.inject({ method: 'GET', url: `/runs/${runId}/trace` });
      expect(traceRes.statusCode).toBe(200);
      const trace = traceRes.json() as RunTrace;

      // AC-19 — the skill-inherited document's FULL text, exactly as on
      // disk, reached the prompt.
      expect(trace.prompt_assembly.specs).toContain(
        'FULL-TEXT-FROM-SKILL — every line of this must reach the prompt verbatim.',
      );
      expect(trace.prompt_assembly.specs).toContain('### specs/from-skill.md');
      // AC-11 — specs_read names the skill-inherited path, though the agent
      // never attached it itself.
      expect(trace.specs_read).toEqual(['specs/from-skill.md']);

      // Neither excluded document's content reached the prompt.
      expect(trace.prompt_assembly.specs).not.toContain('lives in a different repo');
      expect(trace.prompt_assembly.specs).not.toContain('this file is removed before the run');

      // AC-22 / AC-23 / AC-28 (data side) — both exclusions recorded with
      // their path and reason.
      expect(trace.specs_excluded).toEqual(
        expect.arrayContaining([
          { path: 'other-repo/note.md', reason: 'other_repo' },
          { path: 'docs/will-be-deleted.md', reason: 'absent' },
        ]),
      );
      expect(trace.specs_excluded).toHaveLength(2);

      await app.close();
    },
    20_000,
  );
});
