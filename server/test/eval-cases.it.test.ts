import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockSecretsProvider, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

/**
 * `modules/evals/routes.ts` CRUD + the finding seed/create surface
 * (`docs/plans/2026-08-22-eval-pipeline-a-foundation.md` T18). Covers AC-3,
 * AC-4, AC-5, AC-8, AC-9, AC-46, AC-47, plus cross-workspace 404s on both
 * finding routes.
 *
 * No test here asserts how many eval cases exist anywhere — the plan
 * forbids a case-count assertion.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** A unified diff touching only src/config.ts, one added line (11). Mirrors
 *  the fixture in `reviews.it.test.ts`, kept local since this file's
 *  assertions depend on the exact line/text. */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

let seq = 0;

d('eval-case CRUD + finding seed/create (Testcontainers pg)', () => {
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

  function appWith() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        // No secrets in tests — no adapter this route touches may reach the
        // network (`server/insights.md`, Recurring Errors 2026-08-05).
        secrets: new MockSecretsProvider(),
        git: new MockGitClient({ diff: DIFF }),
      },
    });
  }

  /** repo + PR + review + one finding, workspace-scoped to `ws`, whose
   *  review is owned by `agentId`. `decision` controls the finding's
   *  accept/dismiss state (and therefore its seeded expectation polarity). */
  async function setupFinding(
    ws: string,
    agentId: string,
    decision: 'accepted' | 'dismissed' | 'undecided',
  ) {
    const name = `payments-api-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws,
        repoId: repo!.id,
        number: 1,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId: ws,
        prId: pr!.id,
        agentId,
        kind: 'review',
        verdict: 'request_changes',
        summary: 'Hardcoded Stripe secret key introduced.',
        score: 65,
        model: 'gpt-4.1',
      })
      .returning();
    const [finding] = await pg.handle.db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 11,
        endLine: 11,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key',
        rationale: 'A live Stripe key is committed in source.',
        confidence: 0.95,
        acceptedAt: decision === 'accepted' ? new Date() : null,
        dismissedAt: decision === 'dismissed' ? new Date() : null,
      })
      .returning();
    return { repo: repo!, pr: pr!, review: review!, finding: finding! };
  }

  async function createAgent(app: Awaited<ReturnType<typeof appWith>>, name: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name, provider: 'openai', model: 'gpt-4.1', system_prompt: 'You review PRs.' },
    });
    return res.json();
  }

  it('GET /findings/:id/eval-case-seed on an accepted finding returns one must_find expectation at the finding location, with input_diff covering that file over that range (AC-3, AC-4)', async () => {
    const app = await appWith();
    const agent = await createAgent(app, 'Seed Agent (accepted)');
    const { finding, repo } = await setupFinding(workspaceId, agent.id, 'accepted');

    const res = await app.inject({ method: 'GET', url: `/findings/${finding.id}/eval-case-seed` });
    expect(res.statusCode).toBe(200);
    const seedDto = res.json();

    expect(seedDto.expectations).toHaveLength(1);
    expect(seedDto.expectations[0]).toMatchObject({
      kind: 'must_find',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
    });
    expect(seedDto.agent_id).toBe(agent.id);
    expect(seedDto.repo_id).toBe(repo.id);
    // AC-4 — the diff slice covers this file's hunk, including the line the
    // expectation cites.
    expect(seedDto.input_diff).toContain('src/config.ts');
    expect(seedDto.input_diff).toContain('stripeKey');

    await app.close();
  });

  it('GET /findings/:id/eval-case-seed on a dismissed finding returns one must_not_flag expectation (AC-3)', async () => {
    const app = await appWith();
    const agent = await createAgent(app, 'Seed Agent (dismissed)');
    const { finding } = await setupFinding(workspaceId, agent.id, 'dismissed');

    const res = await app.inject({ method: 'GET', url: `/findings/${finding.id}/eval-case-seed` });
    expect(res.statusCode).toBe(200);
    const seedDto = res.json();

    expect(seedDto.expectations).toHaveLength(1);
    expect(seedDto.expectations[0]).toMatchObject({
      kind: 'must_not_flag',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
    });

    await app.close();
  });

  it('POST /findings/:id/eval-case derives owner_id from the review agent (ignoring any agent id in the body) and repo_id from the pull (AC-5, AC-46)', async () => {
    const app = await appWith();
    const owningAgent = await createAgent(app, 'Owning Agent');
    const otherAgent = await createAgent(app, 'Other Agent');
    const { finding, repo } = await setupFinding(workspaceId, owningAgent.id, 'accepted');

    const res = await app.inject({
      method: 'POST',
      url: `/findings/${finding.id}/eval-case`,
      // The body schema (`CreateEvalCaseFromFindingBody`) does not declare an
      // agent/owner field at all — sending one anyway must have no effect;
      // the persisted owner always comes from the finding's own review.
      payload: { name: 'Case from finding', agent_id: otherAgent.id, owner_id: otherAgent.id },
    });
    expect(res.statusCode).toBe(200);
    const dto = res.json();

    expect(dto.owner_id).toBe(owningAgent.id);
    expect(dto.owner_id).not.toBe(otherAgent.id);
    expect(dto.repo_id).toBe(repo.id);

    await app.close();
  });

  it('POST /agents/:id/eval-cases persists the body repo_id (AC-47)', async () => {
    const app = await appWith();
    const agent = await createAgent(app, 'Direct-create Agent');
    const name = `payments-api-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/eval-cases`,
      payload: {
        name: 'Hand-written case',
        input_diff: DIFF,
        repo_id: repo!.id,
        expectations: [
          { kind: 'must_find', file: 'src/config.ts', start_line: 11, end_line: 11 },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const dto = res.json();
    expect(dto.owner_id).toBe(agent.id);
    expect(dto.repo_id).toBe(repo!.id);
    expect(dto.repo_full_name).toBe(repo!.fullName);

    await app.close();
  });

  it('PUT /eval-cases/:id with expectations: [] leaves a must_not_flag case unchanged (AC-8) but is rejected with a reason on a must_find case (AC-9)', async () => {
    const app = await appWith();
    const agent = await createAgent(app, 'Update-path Agent');

    const negativeCase = (
      await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/eval-cases`,
        payload: {
          name: 'Negative case',
          input_diff: DIFF,
          repo_id: null,
          expectations: [
            { kind: 'must_not_flag', file: 'src/config.ts', start_line: 11, end_line: 11 },
          ],
        },
      })
    ).json();

    const keptRes = await app.inject({
      method: 'PUT',
      url: `/eval-cases/${negativeCase.id}`,
      payload: { expectations: [] },
    });
    expect(keptRes.statusCode).toBe(200);
    const kept = keptRes.json();
    expect(kept.expectations).toEqual(negativeCase.expectations);
    expect(kept.polarity).toBe('must_not_flag');

    const positiveCase = (
      await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/eval-cases`,
        payload: {
          name: 'Positive case',
          input_diff: DIFF,
          repo_id: null,
          expectations: [
            { kind: 'must_find', file: 'src/config.ts', start_line: 11, end_line: 11 },
          ],
        },
      })
    ).json();

    const rejectedRes = await app.inject({
      method: 'PUT',
      url: `/eval-cases/${positiveCase.id}`,
      payload: { expectations: [] },
    });
    expect(rejectedRes.statusCode).toBe(422);
    const rejectedBody = rejectedRes.json();
    expect(rejectedBody.error.code).toBe('validation_error');
    expect(rejectedBody.error.message).toMatch(/expectation/i);

    // The must_find case's stored expectations are unaffected by the
    // rejected request.
    const stillThere = (
      await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` })
    ).json();
    const persisted = stillThere.find((c: { id: string }) => c.id === positiveCase.id);
    expect(persisted.expectations).toEqual(positiveCase.expectations);

    await app.close();
  });

  it('a finding from another workspace 404s on both finding routes', async () => {
    const app = await appWith();
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-ws-${seq++}` })
      .returning();
    // The agent id doesn't need to belong to any workspace the route can
    // resolve — the workspace mismatch is caught before the agent is read.
    const [foreignAgent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: otherWs!.id,
        name: 'Foreign Agent',
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'x',
      })
      .returning();
    const { finding } = await setupFinding(otherWs!.id, foreignAgent!.id, 'accepted');

    const seedRes = await app.inject({
      method: 'GET',
      url: `/findings/${finding.id}/eval-case-seed`,
    });
    expect(seedRes.statusCode).toBe(404);

    const createRes = await app.inject({
      method: 'POST',
      url: `/findings/${finding.id}/eval-case`,
      payload: { name: 'Should not be created' },
    });
    expect(createRes.statusCode).toBe(404);

    await app.close();
  });
});
