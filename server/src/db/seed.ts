import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
import { RunTrace, type BriefDoc } from '@devdigest/shared';
import { wrapUntrusted } from '@devdigest/reviewer-core';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
  API_CONTRACT_REVIEWER_PROMPT,
} from './seed-prompts.js';
import { SEED_SKILLS, API_CONTRACT_SKILLS, type SeedSkill } from './seed-skills.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, and the built-in agents (General + Security +
 * Performance + Test Quality + API Contract), all on the default
 * openrouter/deepseek-v4-flash provider+model. L02 also seeds two skill sets —
 * the three test-quality skills linked to the Test Quality Reviewer, and the
 * four API-contract skills linked to the API Contract Reviewer — each in order.
 *
 * Course lessons populate the remaining tables (conventions, memory, eval, …)
 * once their features are built — those start empty here.
 */

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- PR #482 (rate limiting) ----
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4e5f6',
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'needs_review',
        body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      })
      .returning();

    // pr_files (subset)
    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
      { prId: pr!.id, path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
      { prId: pr!.id, path: 'src/config.ts', additions: 4, deletions: 0 },
      { prId: pr!.id, path: 'src/api/users.ts', additions: 7, deletions: 2 },
      // L03 Smart Diff (plan §13): two `boilerplate`-classified rows so the
      // "lockfiles start collapsed" + large-file-highlight signals are both
      // demonstrable without a live GitHub token. `pnpm-lock.yaml` is also
      // over `LARGE_FILE_LINES` (client SmartDiffViewer constant), so it
      // exercises both signals at once.
      { prId: pr!.id, path: 'pnpm-lock.yaml', additions: 412, deletions: 87 },
      { prId: pr!.id, path: 'dist/bundle.min.js', additions: 1, deletions: 1 },
    ]);

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
        score: 61,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
    ]);
  }

  // ---- L03: seed a pr_intent row for PR #482 ----
  // Idempotent (upsert on the pr_id PK) — and REQUIRED so opening the seeded
  // PR's Overview tab never fires an auto-compute POST /pulls/:id/intent (no
  // persisted row = null = the card's once-per-mount auto-compute would fire).
  // This is what keeps e2e flows 02/04/05 (which all land on this PR's
  // Overview tab) model-free.
  await db
    .insert(t.prIntent)
    .values({
      prId: pr!.id,
      intent:
        'Add token-bucket rate limiting to the public API endpoints so unauthenticated ' +
        'clients cannot abuse them.',
      inScope: ['public API rate limiting', 'request throttling middleware', 'public endpoint configuration'],
      outOfScope: ['authentication/authorization changes', 'internal/admin API endpoints', 'billing or quota changes'],
    })
    .onConflictDoUpdate({
      target: t.prIntent.prId,
      set: {
        intent:
          'Add token-bucket rate limiting to the public API endpoints so unauthenticated ' +
          'clients cannot abuse them.',
        inScope: ['public API rate limiting', 'request throttling middleware', 'public endpoint configuration'],
        outOfScope: ['authentication/authorization changes', 'internal/admin API endpoints', 'billing or quota changes'],
      },
    });

  // ---- SPEC-02: seed a pr_brief row for PR #482 against its seeded head SHA ----
  // Idempotent (upsert on the pr_id PK) — and REQUIRED so opening the seeded
  // PR's Overview tab never fires an auto-generate POST /pulls/:id/brief (no
  // stored brief for the CURRENT head SHA = 'absent' = the card's
  // once-per-mount auto-start would fire). Mirrors the pr_intent seed
  // immediately above — keeps e2e flows 02/04/05/12 model-free.
  const seededHeadSha = 'a1b2c3d4e5f6';
  const briefDoc: BriefDoc = {
    what: 'Adds token-bucket rate limiting to the public API endpoints.',
    why:
      'Unauthenticated clients could call the public endpoints with no request throttling, ' +
      'risking abuse and cost overrun.',
    risk_level: 'high',
    risks: [
      {
        kind: 'security',
        title: 'Hardcoded Stripe secret key',
        explanation:
          'A live Stripe secret key is committed in plaintext in the rate-limit configuration.',
        severity: 'high',
        refs: [{ path: 'src/config.ts', start_line: 12, end_line: 12, endpoint: null }],
      },
      {
        kind: 'performance',
        title: 'N+1 query under the new limiter',
        explanation:
          'The user-list endpoint issues one query per user once the rate limiter wraps it, ' +
          'multiplying DB load under bursty traffic.',
        severity: 'medium',
        refs: [{ path: 'src/api/users.ts', start_line: null, end_line: null, endpoint: null }],
      },
    ],
    review_focus: [
      {
        refs: [
          { path: 'src/middleware/ratelimit.ts', start_line: null, end_line: null, endpoint: null },
        ],
        reason:
          'Verify the token-bucket algorithm resets correctly per client and cannot be bypassed ' +
          'by header spoofing.',
      },
      {
        refs: [{ path: 'src/config.ts', start_line: null, end_line: null, endpoint: null }],
        reason:
          'Confirm no secret material is committed and the rate-limit thresholds are sourced ' +
          'from configuration, not hardcoded.',
      },
      {
        // Same path referenced twice within one item — demonstrates the
        // duplicate-reference collapse in the UI (mockup 6).
        refs: [
          { path: 'src/api/public/webhooks.ts', start_line: null, end_line: null, endpoint: null },
          { path: 'src/api/public/webhooks.ts', start_line: null, end_line: null, endpoint: null },
        ],
        reason: 'Check the webhook handler applies the same limiter as the other public endpoints.',
      },
    ],
  };
  const briefJson = { ...briefDoc, pr_id: pr!.id, head_sha: seededHeadSha };
  await db
    .insert(t.prBrief)
    .values({ prId: pr!.id, headSha: seededHeadSha, json: briefJson })
    .onConflictDoUpdate({
      target: t.prBrief.prId,
      set: { headSha: seededHeadSha, json: briefJson, createdAt: new Date() },
    });

  // ---- built-in agents (the three starter presets) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Test Quality Reviewer',
      description: 'Checks tests for uncovered branches, missed corner cases, over-mocking and flakes.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: TEST_QUALITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'API Contract Reviewer',
      description: 'Catches breaking API changes — removed/renamed fields, response-shape drift, unversioned breaks, silent removals.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: API_CONTRACT_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) await db.insert(t.agents).values(a);
  }

  // ---- L02: skill sets + their links to a specific built-in agent ----
  // Idempotent on (workspaceId, name), like the agents above. Unlike the agents
  // we DO write the v1 `skill_versions` row here: the seed bypasses the
  // repository, and without it a seeded skill would have no version history and
  // the first body edit would jump from "no snapshot" to v2.
  //
  // Two worked examples of the same lesson (agent prompt holds role/output
  // conventions only, skills hold the concrete rules): the three test-quality
  // skills → Test Quality Reviewer, and the four API-contract skills →
  // API Contract Reviewer.
  const seedSkillSets: Array<{ agentName: string; skills: readonly SeedSkill[] }> = [
    { agentName: 'Test Quality Reviewer', skills: SEED_SKILLS },
    { agentName: 'API Contract Reviewer', skills: API_CONTRACT_SKILLS },
  ];

  for (const { agentName, skills } of seedSkillSets) {
    const skillIds: string[] = [];
    for (const s of skills) {
      let [skill] = await db
        .select()
        .from(t.skills)
        .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, s.name)));
      if (!skill) {
        [skill] = await db
          .insert(t.skills)
          .values({
            workspaceId,
            name: s.name,
            description: s.description,
            type: s.type,
            source: 'manual',
            body: s.body,
            enabled: true,
            version: 1,
          })
          .returning();
        await db
          .insert(t.skillVersions)
          .values({ skillId: skill!.id, version: 1, body: s.body })
          .onConflictDoNothing();
      }
      skillIds.push(skill!.id);
    }

    const [agent] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, agentName)));
    if (agent && skillIds.length > 0) {
      // Order is what the Skills tab drags and what decides block order in the
      // assembled prompt — seed it explicitly rather than relying on insert order.
      await db
        .insert(t.agentSkills)
        .values(skillIds.map((skillId, order) => ({ agentId: agent.id, skillId, order })))
        .onConflictDoNothing();
    }
  }

  // ---- Project context — run injection: seed one agent_runs + run_traces
  // pair on PR #482 carrying a project-context prompt-assembly block, so the
  // e2e trace-drawer flow (10-run-trace-project-context) has a deterministic
  // run to open. See docs/plans/2026-08-16-project-context-run-injection.md
  // (U9). NEW ROWS ONLY — the sample review/findings seeded above are never
  // touched. Idempotent via a fixed row id + onConflictDoNothing, the same
  // shape as the fixed-target upserts above. `ranAt` is pinned in the past
  // (rather than left at `defaultNow()`) so this run can never become PR
  // #482's NEWEST — FindingsTab/RunHistory both sort newest-first, and a
  // newer row here would change what flows 02/04/05 (which land on this PR's
  // Overview/Agent-runs tabs) see.
  const [seedRunAgent] = await db
    .select()
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'General Reviewer')));

  if (seedRunAgent) {
    const SEED_RUN_ID = 'a0000000-0000-4000-8000-000000000482';
    const seedRunRanAt = new Date(Date.now() - 1000 * 60 * 60 * 24 * 3); // 3 days ago

    await db
      .insert(t.agentRuns)
      .values({
        id: SEED_RUN_ID,
        workspaceId,
        agentId: seedRunAgent.id,
        prId: pr!.id,
        ranAt: seedRunRanAt,
        provider: seedRunAgent.provider,
        model: seedRunAgent.model,
        durationMs: 14200,
        tokensIn: 6420,
        tokensOut: 512,
        costUsd: 0.0087,
        status: 'done',
        error: null,
        source: 'local',
        findingsCount: 0,
        grounding: '0/0 passed',
        score: 100,
        blockers: 0,
        warningCount: 0,
        suggestionCount: 0,
      })
      .onConflictDoNothing();

    // Two attached documents (skill-inherited-or-own is irrelevant to the
    // seed — the run-time resolver already tested that ordering elsewhere)
    // plus one excluded-for-budget entry, so the trace drawer's Configuration
    // section has something to list under "excluded".
    const specsDocs = [
      {
        path: 'specs/security-baseline.md',
        text:
          '# Security baseline\n\n' +
          'All new endpoints must apply an authentication and rate-limiting check before ' +
          'touching customer data. Secrets must never be logged or committed to the repo.',
      },
      {
        path: 'specs/public-api.md',
        text:
          '# Public API guidelines\n\n' +
          'Public endpoints are unauthenticated by default — treat every input as hostile ' +
          'and enforce a per-IP rate limit on every handler.',
      },
    ];
    // Built through the SAME wrapUntrusted() the run-time resolver uses (U3),
    // so the seeded trace is byte-shape-identical to a real run's, not a
    // hand-rolled approximation of it.
    const specsBlock = wrapUntrusted(
      'project-context',
      specsDocs.map((d) => `### ${d.path}\n${d.text}`).join('\n\n'),
    );
    const user =
      "Review PR #482 'Add rate limiting to public API endpoints'\n\n" +
      `## Project context\n${specsBlock}\n\n` +
      '## Diff to review\n<untrusted source="diff">\n@@ -1,3 +1,9 @@\n+ratelimiter\n</untrusted>';

    const trace = RunTrace.parse({
      config: {
        agent: seedRunAgent.name,
        version: String(seedRunAgent.version),
        provider: seedRunAgent.provider,
        model: seedRunAgent.model,
        pr: 482,
        source: 'local',
      },
      stats: {
        duration_ms: 14200,
        tokens_in: 6420,
        tokens_out: 512,
        cost_usd: 0.0087,
        findings: 0,
        grounding: '0/0 passed',
      },
      prompt_assembly: {
        system: seedRunAgent.systemPrompt,
        skills: null,
        memory: null,
        specs: specsBlock,
        callers: null,
        repo_map: null,
        pr_description: null,
        user,
      },
      tool_calls: [{ tool: 'review_file', args: 'all files', meta: 'single-pass', ms: 14200 }],
      raw_output: '{"verdict":"approve","summary":"Clean — no findings.","score":100,"findings":[]}',
      memory_pulled: [],
      specs_read: specsDocs.map((d) => d.path),
      specs_excluded: [{ path: 'docs/architecture.md', reason: 'over_budget' }],
      log: [
        {
          t: '00.00',
          kind: 'info',
          msg: `Starting review with agent "${seedRunAgent.name}" (${seedRunAgent.provider}/${seedRunAgent.model})`,
        },
        { t: '00.10', kind: 'info', msg: 'project context: 2 document(s) attached, 1 excluded' },
        { t: '14.20', kind: 'result', msg: 'Persisted review with 0 finding(s)' },
      ],
    });

    await db
      .insert(t.runTraces)
      .values({ runId: SEED_RUN_ID, trace })
      .onConflictDoNothing();
  }

  return { workspaceId, userId };
}

// CLI entrypoint
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
