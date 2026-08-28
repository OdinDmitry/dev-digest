/**
 * `docs/plans/2026-08-28-export-to-ci-a-contracts-generation-install.md` T18.
 * `modules/ci` routes over a real Postgres. Modelled on `test/context.it.test.ts`
 * and `test/blast.it.test.ts` for the workspace-scoping shape, and on
 * `test/reviews.it.test.ts` for the `MockSecretsProvider` gotcha
 * (server/insights.md, Recurring Errors 2026-08-17): every adapter that could
 * reach the network is mocked, so a real key in `~/.devdigest/secrets.json`
 * can never make this test flaky or slow.
 *
 * `runnerBundlePath` is pointed at a temp file this suite writes itself —
 * `agent-runner/dist/index.js` is git-ignored and not built in this checkout
 * (handoff note); the "missing bundle" case (AC-5) points it at a path that
 * is never created.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, and } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { WORKFLOW_VERSION, type GitHubClient } from '@devdigest/shared';
import { CI_BRANCH, WORKFLOW_PATH } from '../src/modules/ci/constants.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[ci-export] Docker not available — skipping integration tests.');
}

const BUNDLE_CONTENTS = '// fake ncc-bundled agent-runner (test fixture)\nconsole.log("noop");\n';

function appConfig(bundlePath: string): AppConfig {
  return loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    DEVDIGEST_RUNNER_BUNDLE: bundlePath,
  } as NodeJS.ProcessEnv);
}

d('modules/ci export routes (Postgres)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let bundlePath: string;
  let missingBundlePath: string;
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;

    const tmpDir = await mkdtemp(join(tmpdir(), 'ci-export-it-'));
    bundlePath = join(tmpDir, 'index.js');
    await writeFile(bundlePath, BUNDLE_CONTENTS);
    // Deliberately never created — the AC-5 "runner not built" case.
    missingBundlePath = join(tmpDir, 'does-not-exist.js');
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp(bundle: string, github: GitHubClient = new MockGitHubClient()) {
    return buildApp({
      config: appConfig(bundle),
      db: pg.handle.db,
      overrides: {
        secrets: new MockSecretsProvider(),
        github,
      },
    });
  }

  async function insertRepo(ws: string, overrides: Partial<typeof t.repos.$inferInsert> = {}) {
    const name = `ci-export-repo-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: ws,
        owner: 'acme',
        name,
        fullName: `acme/${name}`,
        defaultBranch: 'main',
        ...overrides,
      })
      .returning();
    return repo!;
  }

  async function insertAgent(ws: string, overrides: Partial<typeof t.agents.$inferInsert> = {}) {
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: ws,
        name: `ci-export-agent-${seq++}`,
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'Review the diff for security issues.',
        ...overrides,
      })
      .returning();
    return agent!;
  }

  async function insertSkill(ws: string, overrides: Partial<typeof t.skills.$inferInsert> = {}) {
    const [skill] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId: ws,
        name: `ci-export-skill-${seq++}`,
        description: 'Use when reviewing tests.',
        type: 'rubric',
        source: 'manual',
        body: '## rule\nDo the thing.',
        ...overrides,
      })
      .returning();
    return skill!;
  }

  async function linkSkill(agentId: string, skillId: string, order = 0) {
    await pg.handle.db.insert(t.agentSkills).values({ agentId, skillId, order });
  }

  // -------------------------------------------------------------------------
  // AC-2: preview file set
  // -------------------------------------------------------------------------

  it('preview returns one manifest file, one file per attached skill, the runner file and the workflow, with only the workflow editable', async () => {
    const app = await makeApp(bundlePath);
    const agent = await insertAgent(workspaceId);
    const skillA = await insertSkill(workspaceId, { name: 'Skill A' });
    const skillB = await insertSkill(workspaceId, { name: 'Skill B' });
    await linkSkill(agent.id, skillA.id, 0);
    await linkSkill(agent.id, skillB.id, 1);
    const repo = await insertRepo(workspaceId);

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/ci-export/preview`,
      payload: { repo_id: repo.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.skill_count).toBe(2);
    // manifest + 2 skills + runner + workflow
    expect(body.files).toHaveLength(5);
    const editableFiles = body.files.filter((f: { editable: boolean }) => f.editable);
    expect(editableFiles).toHaveLength(1);
    expect(editableFiles[0].path).toBe(WORKFLOW_PATH);
    expect(body.workflow_version).toBe(WORKFLOW_VERSION);
    expect(body.repo).toBe(repo.fullName);

    await app.close();
  });

  it('preview for an agent with no skills returns no skill file and skill_count: 0', async () => {
    const app = await makeApp(bundlePath);
    const agent = await insertAgent(workspaceId);
    const repo = await insertRepo(workspaceId);

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/ci-export/preview`,
      payload: { repo_id: repo.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.skill_count).toBe(0);
    // manifest + runner + workflow, no skill files
    expect(body.files).toHaveLength(3);
    expect(
      body.files.some((f: { path: string }) => f.path.startsWith('.devdigest/skills/')),
    ).toBe(false);

    await app.close();
  });

  // -------------------------------------------------------------------------
  // AC-5: missing runner bundle refuses the export, no GitHub side effect
  // -------------------------------------------------------------------------

  it('preview with runnerBundlePath pointing at a missing file is refused with a message naming the runner, and touches GitHub not at all', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp(missingBundlePath, github);
    const agent = await insertAgent(workspaceId);
    const repo = await insertRepo(workspaceId);

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/ci-export/preview`,
      payload: { repo_id: repo.id },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error.message.toLowerCase()).toContain('runner');
    expect(github.committed).toHaveLength(0);

    await app.close();
  });

  // -------------------------------------------------------------------------
  // AC-6/AC-7: install commits to devdigest/ci (never the default branch),
  // opens exactly one PR across two installs, returns the same url
  // -------------------------------------------------------------------------

  it('install commits to devdigest/ci (never the repo default branch); a second install opens no second PR and returns the same url', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp(bundlePath, github);
    const agent = await insertAgent(workspaceId);
    const repo = await insertRepo(workspaceId, { defaultBranch: 'main' });

    const first = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/ci-export/install`,
      payload: { repo_id: repo.id },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json();

    expect(github.committed).toHaveLength(1);
    expect(github.committed[0]!.branch).toBe(CI_BRANCH);
    expect(github.committed[0]!.base).toBe('main');
    expect(github.committed[0]!.base).not.toBe(CI_BRANCH);
    expect(github.openedPrs).toHaveLength(1);
    expect(firstBody.pr_url).toBe('https://github.com/mock/mock/pull/1');

    const second = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/ci-export/install`,
      payload: { repo_id: repo.id },
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json();

    // Re-published: files committed again, but no SECOND pull request.
    expect(github.committed).toHaveLength(2);
    expect(github.openedPrs).toHaveLength(1);
    expect(secondBody.pr_url).toBe(firstBody.pr_url);

    await app.close();
  });

  // -------------------------------------------------------------------------
  // AC-8/AC-9: exactly one installation row per (agent, repo); current flag
  // -------------------------------------------------------------------------

  it('install records exactly one installation carrying agent, repo and workflow_version; a second install bumps updated_at on the same row', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp(bundlePath, github);
    const agent = await insertAgent(workspaceId);
    const repo = await insertRepo(workspaceId);

    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/ci-export/install`,
      payload: { repo_id: repo.id },
    });

    const rowsAfterFirst = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(
        and(eq(t.ciInstallations.agentId, agent.id), eq(t.ciInstallations.repo, repo.fullName)),
      );
    expect(rowsAfterFirst).toHaveLength(1);
    const firstRow = rowsAfterFirst[0]!;
    expect(firstRow.agentId).toBe(agent.id);
    expect(firstRow.repo).toBe(repo.fullName);
    expect(firstRow.workflowVersion).toBe(WORKFLOW_VERSION);

    // Ensure updatedAt has room to visibly move forward.
    await new Promise((resolve) => setTimeout(resolve, 5));

    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/ci-export/install`,
      payload: { repo_id: repo.id },
    });

    const rowsAfterSecond = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(
        and(eq(t.ciInstallations.agentId, agent.id), eq(t.ciInstallations.repo, repo.fullName)),
      );
    expect(rowsAfterSecond).toHaveLength(1);
    expect(rowsAfterSecond[0]!.id).toBe(firstRow.id);
    expect(rowsAfterSecond[0]!.updatedAt.getTime()).toBeGreaterThan(firstRow.updatedAt.getTime());

    await app.close();
  });

  it("GET /agents/:id/ci-installations reports current: true for the installed row, and current: false once its workflow_version is reset to null", async () => {
    const github = new MockGitHubClient();
    const app = await makeApp(bundlePath, github);
    const agent = await insertAgent(workspaceId);
    const repo = await insertRepo(workspaceId);

    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/ci-export/install`,
      payload: { repo_id: repo.id },
    });

    const before = await app.inject({
      method: 'GET',
      url: `/agents/${agent.id}/ci-installations`,
    });
    expect(before.statusCode).toBe(200);
    const beforeBody = before.json() as { id: string; current: boolean; repo: string }[];
    const beforeRow = beforeBody.find((r) => r.repo === repo.fullName);
    expect(beforeRow?.current).toBe(true);

    await pg.handle.db
      .update(t.ciInstallations)
      .set({ workflowVersion: null })
      .where(eq(t.ciInstallations.id, beforeRow!.id));

    const after = await app.inject({
      method: 'GET',
      url: `/agents/${agent.id}/ci-installations`,
    });
    expect(after.statusCode).toBe(200);
    const afterBody = after.json() as { id: string; current: boolean; repo: string }[];
    const afterRow = afterBody.find((r) => r.repo === repo.fullName);
    expect(afterRow?.current).toBe(false);

    await app.close();
  });

  // -------------------------------------------------------------------------
  // AC-22 + AC-3: hand-edited workflow_contents — commit exactly those bytes,
  // or reject unparsable YAML and commit nothing
  // -------------------------------------------------------------------------

  it('install with edited workflow_contents commits exactly those bytes', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp(bundlePath, github);
    const agent = await insertAgent(workspaceId);
    const repo = await insertRepo(workspaceId);

    const editedWorkflow = [
      '# devdigest-workflow-version: 1',
      'name: DevDigest Review (edited by hand)',
      'on:',
      '  pull_request:',
      '    types: [opened]',
      'jobs:',
      '  review:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: echo edited',
      '',
    ].join('\n');

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/ci-export/install`,
      payload: { repo_id: repo.id, workflow_contents: editedWorkflow },
    });
    expect(res.statusCode).toBe(200);

    expect(github.committed).toHaveLength(1);
    const workflowFile = github.committed[0]!.files.find((f) => f.path === WORKFLOW_PATH);
    expect(workflowFile?.contents).toBe(editedWorkflow);

    await app.close();
  });

  it('install with unparsable workflow_contents is rejected with the reason and commits nothing', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp(bundlePath, github);
    const agent = await insertAgent(workspaceId);
    const repo = await insertRepo(workspaceId);

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/ci-export/install`,
      payload: { repo_id: repo.id, workflow_contents: '::: not valid yaml :::: [' },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(typeof body.error.message).toBe('string');
    expect(body.error.message.length).toBeGreaterThan(0);
    expect(github.committed).toHaveLength(0);

    await app.close();
  });

  // -------------------------------------------------------------------------
  // Workspace scoping
  // -------------------------------------------------------------------------

  it('an agent or a repo_id from another workspace 404s on every route', async () => {
    const app = await makeApp(bundlePath);
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other-ci-export-ws' })
      .returning();
    const otherAgent = await insertAgent(otherWs!.id);
    const otherRepo = await insertRepo(otherWs!.id);
    const ownAgent = await insertAgent(workspaceId);
    const ownRepo = await insertRepo(workspaceId);

    // Agent belongs to another workspace.
    const previewOtherAgent = await app.inject({
      method: 'POST',
      url: `/agents/${otherAgent.id}/ci-export/preview`,
      payload: { repo_id: ownRepo.id },
    });
    expect(previewOtherAgent.statusCode).toBe(404);

    const installOtherAgent = await app.inject({
      method: 'POST',
      url: `/agents/${otherAgent.id}/ci-export/install`,
      payload: { repo_id: ownRepo.id },
    });
    expect(installOtherAgent.statusCode).toBe(404);

    const listOtherAgent = await app.inject({
      method: 'GET',
      url: `/agents/${otherAgent.id}/ci-installations`,
    });
    expect(listOtherAgent.statusCode).toBe(404);

    // Repo belongs to another workspace, agent is this workspace's own.
    const previewOtherRepo = await app.inject({
      method: 'POST',
      url: `/agents/${ownAgent.id}/ci-export/preview`,
      payload: { repo_id: otherRepo.id },
    });
    expect(previewOtherRepo.statusCode).toBe(404);

    const installOtherRepo = await app.inject({
      method: 'POST',
      url: `/agents/${ownAgent.id}/ci-export/install`,
      payload: { repo_id: otherRepo.id },
    });
    expect(installOtherRepo.statusCode).toBe(404);

    await app.close();
  });
});
