/**
 * `docs/plans/2026-08-28-export-to-ci-b-runner-and-ingest.md` T16 + T20.
 * Postgres-backed tests for `POST /ci/refresh`, `GET /ci/runs`,
 * `GET /agents/:id/ci-runs`, and the run's effect on `GET /agents/stats`.
 *
 * Modelled on `test/ci-export.it.test.ts` for the workspace-scoping shape and
 * the `MockSecretsProvider` gotcha (server/insights.md, Recurring Errors
 * 2026-08-17). `MockGitHubClient`'s `workflowRuns`/`artifactEntries` fixtures
 * and its `downloadCalls` recorder (server/insights.md, "Context you will
 * need" in this handoff) drive every scenario — no real GitHub call is ever
 * made. `ci_installations.repo` is a bare `"owner/name"` string with no FK to
 * `repos`, so these tests never need to seed a `repos` row.
 *
 * T16 and T20 share this file and this describe block's single seeded
 * workspace (server/insights.md, What Works 2026-08-22) — every assertion
 * that reads a workspace-wide aggregate (the `GET /agents/stats` run_count in
 * the T20 test) asserts a before/after DELTA, never an absolute count.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { eq, and } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient, MockSecretsProvider, type MockGitHubOptions } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { CiResultArtifact, CiWorkflowRunRef } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[ci-ingest] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('modules/ci refresh/ingest routes (Postgres)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  // `POST /ci/refresh` fans out over EVERY installation in the workspace, and
  // `MockGitHubClient.listWorkflowRuns` returns the SAME `workflowRuns`
  // fixture regardless of which repo it's asked about — so an installation
  // left behind by an earlier test would silently receive the CURRENT test's
  // fixture run too on the next refresh() call, inflating `downloadCalls`/
  // `rejected` counts with entries that have nothing to do with the test
  // that's asserting on them. Deleting this workspace's installations after
  // every test (its `ci_runs` rows survive — the FK is `onDelete: 'set
  // null'`, and every test reads its own rows BEFORE this runs) keeps each
  // test's `POST /ci/refresh` call scoped to only the installation(s) IT
  // created.
  afterEach(async () => {
    await pg.handle.db.delete(t.ciInstallations).where(eq(t.ciInstallations.workspaceId, workspaceId));
  });

  async function makeApp(ghOpts: MockGitHubOptions) {
    const github = new MockGitHubClient(ghOpts);
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        secrets: new MockSecretsProvider(),
        github,
      },
    });
    return { app, github };
  }

  async function insertAgent(ws: string, overrides: Partial<typeof t.agents.$inferInsert> = {}) {
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: ws,
        name: `ci-ingest-agent-${seq++}`,
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'Review the diff for security issues.',
        ...overrides,
      })
      .returning();
    return agent!;
  }

  async function insertInstallation(
    ws: string,
    agentId: string,
    overrides: Partial<typeof t.ciInstallations.$inferInsert> = {},
  ) {
    const repoFullName = `acme/ci-ingest-repo-${seq++}`;
    const [installation] = await pg.handle.db
      .insert(t.ciInstallations)
      .values({
        workspaceId: ws,
        agentId,
        repo: repoFullName,
        targetType: 'gha',
        ...overrides,
      })
      .returning();
    return installation!;
  }

  function workflowRun(overrides: Partial<CiWorkflowRunRef> = {}): CiWorkflowRunRef {
    return {
      id: `run-${seq++}`,
      runNumber: 1,
      headSha: 'headsha1234',
      finished: true,
      conclusion: 'success',
      htmlUrl: 'https://github.com/acme/widgets/actions/runs/1',
      createdAt: '2026-08-28T00:00:00.000Z',
      prNumbers: [42],
      ...overrides,
    };
  }

  /** A valid `CiResultArtifact` matching `repo`/`headSha`, JSON-stringified. */
  function artifactFor(repo: string, headSha: string, overrides: Partial<CiResultArtifact> = {}): string {
    const artifact: CiResultArtifact = {
      schema_version: 1,
      repo,
      head_sha: headSha,
      workflow_sha: headSha,
      pr_number: 42,
      agent: 'Security Reviewer',
      manifest_version: 1,
      model: 'deepseek/deepseek-v4-flash',
      runner_build: '1',
      verdict: 'changes_requested',
      skip_reason: null,
      findings_count: 1,
      critical: 1,
      warning: 0,
      suggestion: 0,
      cost_usd: 0.0025,
      duration_ms: 4200,
      ...overrides,
    };
    return JSON.stringify(artifact);
  }

  async function ciRunsFor(installationId: string) {
    return pg.handle.db
      .select()
      .from(t.ciRuns)
      .where(eq(t.ciRuns.ciInstallationId, installationId));
  }

  // -------------------------------------------------------------------------
  // AC-14, AC-16, AC-24: a finished run with a valid artifact records one row
  // -------------------------------------------------------------------------

  it('a finished run with a valid artifact records exactly one ci_runs row in "recorded" with verdict/counts/cost/duration/commit/job url, plus one agent_runs row (source: "ci", pr_id null)', async () => {
    const agent = await insertAgent(workspaceId);
    const installation = await insertInstallation(workspaceId, agent.id);
    const run = workflowRun({ headSha: 'commit-good-1' });
    const { app } = await makeApp({
      workflowRuns: [run],
      artifactEntries: { [run.id]: artifactFor(installation.repo, 'commit-good-1') },
    });

    const res = await app.inject({ method: 'POST', url: '/ci/refresh' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.recorded).toBe(1);

    const rows = await ciRunsFor(installation.id);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.status).toBe('recorded');
    expect(row.verdict).toBe('changes_requested');
    expect(row.findingsCount).toBe(1);
    expect(row.criticalCount).toBe(1);
    expect(row.costUsd).toBeCloseTo(0.0025);
    expect(row.durationMs).toBe(4200);
    expect(row.headSha).toBe('commit-good-1');
    expect(row.githubUrl).toBe(run.htmlUrl);

    // Exactly one agent_runs row, source 'ci', no pr_id.
    const agentRuns = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(and(eq(t.agentRuns.agentId, agent.id), eq(t.agentRuns.source, 'ci')));
    expect(agentRuns).toHaveLength(1);
    expect(agentRuns[0]!.prId).toBeNull();
    expect(agentRuns[0]!.costUsd).toBeCloseTo(0.0025);
    expect(agentRuns[0]!.durationMs).toBe(4200);
    expect(row.agentRunId).toBe(agentRuns[0]!.id);

    await app.close();
  });

  it('a second refresh over the same fixtures records nothing more, leaves the row unchanged, and never re-downloads that run\'s artifact', async () => {
    const agent = await insertAgent(workspaceId);
    const installation = await insertInstallation(workspaceId, agent.id);
    const run = workflowRun({ headSha: 'commit-good-2' });
    const { app, github } = await makeApp({
      workflowRuns: [run],
      artifactEntries: { [run.id]: artifactFor(installation.repo, 'commit-good-2') },
    });

    const first = await app.inject({ method: 'POST', url: '/ci/refresh' });
    expect(first.json().recorded).toBe(1);
    const rowsAfterFirst = await ciRunsFor(installation.id);
    expect(rowsAfterFirst).toHaveLength(1);
    expect(github.downloadCalls.filter((id) => id === run.id)).toHaveLength(1);

    const second = await app.inject({ method: 'POST', url: '/ci/refresh' });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json();
    expect(secondBody.recorded).toBe(0);
    expect(secondBody.skipped_existing).toBeGreaterThanOrEqual(1);

    const rowsAfterSecond = await ciRunsFor(installation.id);
    expect(rowsAfterSecond).toHaveLength(1);
    expect(rowsAfterSecond[0]!.id).toBe(rowsAfterFirst[0]!.id);
    expect(rowsAfterSecond[0]!.status).toBe('recorded');

    // The artifact was fetched exactly once total — never again on the refresh
    // that found the run already terminal.
    expect(github.downloadCalls.filter((id) => id === run.id)).toHaveLength(1);

    await app.close();
  });

  // -------------------------------------------------------------------------
  // in_progress → recorded upgrade of the SAME row
  // -------------------------------------------------------------------------

  it('an unfinished run records in_progress with null verdict/counts; the next refresh, with the run now finished, upgrades that same row rather than adding one', async () => {
    const agent = await insertAgent(workspaceId);
    const installation = await insertInstallation(workspaceId, agent.id);
    const runId = `run-${seq++}`;
    const ghOpts: MockGitHubOptions = {
      workflowRuns: [
        {
          id: runId,
          runNumber: 1,
          headSha: 'commit-inprogress',
          finished: false,
          conclusion: null,
          htmlUrl: 'https://github.com/acme/widgets/actions/runs/inprogress',
          createdAt: '2026-08-28T00:00:00.000Z',
          prNumbers: [42],
        },
      ],
      artifactEntries: {},
    };
    const { app, github } = await makeApp(ghOpts);

    const first = await app.inject({ method: 'POST', url: '/ci/refresh' });
    expect(first.statusCode).toBe(200);
    const rowsAfterFirst = await ciRunsFor(installation.id);
    expect(rowsAfterFirst).toHaveLength(1);
    expect(rowsAfterFirst[0]!.status).toBe('in_progress');
    expect(rowsAfterFirst[0]!.verdict).toBeNull();
    expect(rowsAfterFirst[0]!.findingsCount).toBeNull();
    expect(github.downloadCalls).toHaveLength(0); // never fetched — not finished

    // Now the run finishes.
    ghOpts.workflowRuns = [{ ...ghOpts.workflowRuns![0]!, finished: true, conclusion: 'success' }];
    ghOpts.artifactEntries = { [runId]: artifactFor(installation.repo, 'commit-inprogress') };

    const second = await app.inject({ method: 'POST', url: '/ci/refresh' });
    expect(second.statusCode).toBe(200);
    const rowsAfterSecond = await ciRunsFor(installation.id);
    expect(rowsAfterSecond).toHaveLength(1);
    expect(rowsAfterSecond[0]!.id).toBe(rowsAfterFirst[0]!.id); // SAME row
    expect(rowsAfterSecond[0]!.status).toBe('recorded');
    expect(rowsAfterSecond[0]!.verdict).toBe('changes_requested');
    expect(rowsAfterSecond[0]!.findingsCount).toBe(1);

    await app.close();
  });

  // -------------------------------------------------------------------------
  // Missing artifact → unavailable, never a fabricated zero-findings row
  // -------------------------------------------------------------------------

  it('a finished run whose artifact is missing records "unavailable" with a reason and null counts, never findings_count: 0', async () => {
    const agent = await insertAgent(workspaceId);
    const installation = await insertInstallation(workspaceId, agent.id);
    const run = workflowRun({ headSha: 'commit-missing-artifact' });
    const { app } = await makeApp({
      workflowRuns: [run],
      artifactEntries: {}, // no entry for run.id — downloadRunArtifactEntry returns null
    });

    const res = await app.inject({ method: 'POST', url: '/ci/refresh' });
    expect(res.statusCode).toBe(200);

    const rows = await ciRunsFor(installation.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('unavailable');
    expect(rows[0]!.unavailableReason).not.toBeNull();
    expect(rows[0]!.unavailableReason!.length).toBeGreaterThan(0);
    expect(rows[0]!.findingsCount).toBeNull(); // not 0

    await app.close();
  });

  // -------------------------------------------------------------------------
  // AC-15: a result naming a different commit is rejected, records no row
  // -------------------------------------------------------------------------

  it('a result naming a different commit records no row and appears in rejected with the job url', async () => {
    const agent = await insertAgent(workspaceId);
    const installation = await insertInstallation(workspaceId, agent.id);
    const run = workflowRun({ headSha: 'commit-real', htmlUrl: 'https://github.com/acme/widgets/actions/runs/mismatch' });
    const { app } = await makeApp({
      workflowRuns: [run],
      // Artifact claims a DIFFERENT commit than the run actually reports.
      artifactEntries: { [run.id]: artifactFor(installation.repo, 'commit-totally-different') },
    });

    const res = await app.inject({ method: 'POST', url: '/ci/refresh' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.recorded).toBe(0);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0].job_url).toBe(run.htmlUrl);
    expect(body.rejected[0].reason.length).toBeGreaterThan(0);

    const rows = await ciRunsFor(installation.id);
    expect(rows).toHaveLength(0);

    await app.close();
  });

  // -------------------------------------------------------------------------
  // AC-23: GET /agents/:id/ci-runs scoping
  // -------------------------------------------------------------------------

  it('GET /agents/:id/ci-runs returns only that agent\'s runs', async () => {
    const agentA = await insertAgent(workspaceId);
    const agentB = await insertAgent(workspaceId);
    const installationA = await insertInstallation(workspaceId, agentA.id);
    const installationB = await insertInstallation(workspaceId, agentB.id);
    const runA = workflowRun({ headSha: 'commit-a' });
    const runB = workflowRun({ headSha: 'commit-b' });

    // `listWorkflowRuns` is fixture-driven per GitHubClient instance (it can't
    // distinguish which installation is being queried), so each installation
    // is refreshed through its OWN app/github pair to keep each installation's
    // run set honest, then both are read back through one shared app.
    const { app: appA } = await makeApp({
      workflowRuns: [runA],
      artifactEntries: { [runA.id]: artifactFor(installationA.repo, 'commit-a') },
    });
    await appA.inject({ method: 'POST', url: '/ci/refresh' });
    await appA.close();

    const { app: appB } = await makeApp({
      workflowRuns: [runB],
      artifactEntries: { [runB.id]: artifactFor(installationB.repo, 'commit-b') },
    });
    await appB.inject({ method: 'POST', url: '/ci/refresh' });

    const resA = await appB.inject({ method: 'GET', url: `/agents/${agentA.id}/ci-runs` });
    expect(resA.statusCode).toBe(200);
    const bodyA = resA.json() as { id: string; agent_id: string | null }[];
    expect(bodyA.length).toBeGreaterThan(0);
    expect(bodyA.every((r) => r.agent_id === agentA.id)).toBe(true);

    const resB = await appB.inject({ method: 'GET', url: `/agents/${agentB.id}/ci-runs` });
    expect(resB.statusCode).toBe(200);
    const bodyB = resB.json() as { id: string; agent_id: string | null }[];
    expect(bodyB.length).toBeGreaterThan(0);
    expect(bodyB.every((r) => r.agent_id === agentB.id)).toBe(true);
    expect(bodyB.some((r) => bodyA.some((a) => a.id === r.id))).toBe(false);

    await appB.close();
  });

  // -------------------------------------------------------------------------
  // Workspace scoping
  // -------------------------------------------------------------------------

  it('every CI route 404s or returns empty for another workspace', async () => {
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other-ci-ingest-ws' })
      .returning();
    const otherAgent = await insertAgent(otherWs!.id);
    const otherInstallation = await insertInstallation(otherWs!.id, otherAgent.id);

    // Directly insert a ci_runs row under the OTHER workspace (never reachable
    // through our own workspace's /ci/refresh, since that only lists this
    // workspace's installations).
    await pg.handle.db.insert(t.ciRuns).values({
      workspaceId: otherWs!.id,
      ciInstallationId: otherInstallation.id,
      agentId: otherAgent.id,
      providerRunId: `other-run-${seq++}`,
      prNumber: 42,
      headSha: 'other-commit',
      ranAt: new Date(),
      status: 'recorded',
      verdict: 'approved',
      findingsCount: 0,
      criticalCount: 0,
      warningCount: 0,
      suggestionCount: 0,
      githubUrl: 'https://github.com/other/repo/actions/runs/1',
    });

    const { app } = await makeApp({});

    const listRes = await app.inject({ method: 'GET', url: '/ci/runs' });
    expect(listRes.statusCode).toBe(200);
    const list = listRes.json() as { ci_installation_id: string | null }[];
    expect(list.some((r) => r.ci_installation_id === otherInstallation.id)).toBe(false);

    const agentRunsRes = await app.inject({ method: 'GET', url: `/agents/${otherAgent.id}/ci-runs` });
    expect(agentRunsRes.statusCode).toBe(404);

    await app.close();
  });

  // -------------------------------------------------------------------------
  // AC-14: the studio never accepts a result it did not retrieve — static guard
  // -------------------------------------------------------------------------

  it('modules/ci/routes.ts has no CODE reference to CiResultArtifact (no route accepts one as a body) — only its own explanatory doc comment names it', () => {
    // A literal `grep`-style substring check trips on the file's OWN doc
    // comment ("No route here accepts a `CiResultArtifact` body — ...")
    // explaining this exact guarantee in prose — the same collision class
    // server/insights.md's Recurring Errors & Fixes (2026-08-07,
    // "A plan's literal grep ... static guard matches doc comments too")
    // already documents for a different module. Stripping comments before
    // matching verifies the REAL guarantee (no import, no type annotation,
    // no `.parse()`/`.safeParse()` call against the contract) without being
    // defeated — or falsely tripped — by prose that talks ABOUT the absence.
    const routesSource = readFileSync(
      new URL('../src/modules/ci/routes.ts', import.meta.url),
      'utf8',
    );
    const withoutComments = routesSource
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments (incl. /** ... */ doc comments)
      .replace(/\/\/.*$/gm, ''); // line comments
    expect(withoutComments).not.toMatch(/CiResultArtifact/);
  });

  // -------------------------------------------------------------------------
  // T20 / AC-24: a CI run must NOT move GET /agents/stats' run_count/avg_cost
  // -------------------------------------------------------------------------

  it('a recorded CI run leaves GET /agents/stats run_count/avg_cost_usd unchanged for that agent (delta), while its ci_runs and agent_runs rows both exist; a directly-inserted "local" agent_runs row DOES bump run_count by one', async () => {
    const agent = await insertAgent(workspaceId);
    const installation = await insertInstallation(workspaceId, agent.id);
    const run = workflowRun({ headSha: 'commit-stats' });
    const { app } = await makeApp({
      workflowRuns: [run],
      artifactEntries: { [run.id]: artifactFor(installation.repo, 'commit-stats', { cost_usd: 0.0099 }) },
    });

    const before = await app.inject({ method: 'GET', url: '/agents/stats' });
    expect(before.statusCode).toBe(200);
    const beforeStats = (before.json() as { agent_id: string; run_count: number; avg_cost_usd: number | null }[]).find(
      (s) => s.agent_id === agent.id,
    );
    expect(beforeStats).toBeDefined();

    const refreshRes = await app.inject({ method: 'POST', url: '/ci/refresh' });
    expect(refreshRes.json().recorded).toBe(1);

    // The CI run really was written.
    const ciRows = await ciRunsFor(installation.id);
    expect(ciRows).toHaveLength(1);
    const agentRunsRows = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(and(eq(t.agentRuns.agentId, agent.id), eq(t.agentRuns.source, 'ci')));
    expect(agentRunsRows).toHaveLength(1);

    const afterCi = await app.inject({ method: 'GET', url: '/agents/stats' });
    const afterCiStats = (afterCi.json() as { agent_id: string; run_count: number; avg_cost_usd: number | null }[]).find(
      (s) => s.agent_id === agent.id,
    );
    expect(afterCiStats).toBeDefined();
    // run_count/avg_cost_usd must be IDENTICAL before/after the CI run — the
    // CI-originated agent_runs row must be excluded from this rollup.
    expect(afterCiStats!.run_count).toBe(beforeStats!.run_count);
    expect(afterCiStats!.avg_cost_usd).toBe(beforeStats!.avg_cost_usd);

    // Negative-control: a directly-inserted 'local' agent_runs row DOES bump
    // run_count by exactly one — proves the predicate isn't just "always
    // excludes everything" but specifically excludes source: 'ci'.
    await pg.handle.db.insert(t.agentRuns).values({
      workspaceId,
      agentId: agent.id,
      source: 'local',
      status: 'done',
      costUsd: 0.01,
    });

    const afterLocal = await app.inject({ method: 'GET', url: '/agents/stats' });
    const afterLocalStats = (afterLocal.json() as { agent_id: string; run_count: number }[]).find(
      (s) => s.agent_id === agent.id,
    );
    expect(afterLocalStats!.run_count).toBe(afterCiStats!.run_count + 1);

    await app.close();
  });
});
