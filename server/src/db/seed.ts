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
import { cutFragment } from '../modules/eval/helpers.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * SPEC-03 eval pipeline (T13) — the seeded `pr_files` rows shipped with no
 * `patch` (`server/insights.md`-cited gap: no fragment can be cut for any
 * finding on this PR as the database ships). These two real patches cover
 * the two seeded findings' exact line ranges so "turn into eval case" is
 * reachable in dev and in e2e without a live GitHub token.
 */
const CONFIG_TS_PATCH = [
  '@@ -9,3 +9,7 @@',
  ' const config = {',
  '   port: process.env.PORT || 3000,',
  "   apiVersion: 'v2',",
  "+  stripeSecretKey: 'sk_live_51Hxxxxxxxxxxxxxxxxxxxxxxxx',",
  '+  rateLimit: { windowMs: 60_000, max: 100 },',
  '+  retries: 3,',
  '+  timeout: 5000,',
].join('\n');

const USERS_TS_PATCH = [
  '@@ -43,7 +43,12 @@',
  ' async function listUsers(req, res) {',
  '   const ids = await getUserIds();',
  '-  const users = [];',
  '-  for (const id of ids) {',
  "+  const users = await db.query('SELECT * FROM users WHERE id IN (?)', [ids]);",
  '+  // Preserve original per-id ordering.',
  '+  const byId = new Map(users.map((u) => [u.id, u]));',
  '+  const ordered = ids.map((id) => byId.get(id));',
  '+  if (!ordered.length) {',
  '+    return res.json([]);',
  '+  }',
  "     const user = await db.query('SELECT * FROM users WHERE id = ?', [id]);",
  '     users.push(user);',
  '   }',
].join('\n');

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
  // Populated only on a fresh seed (inside the `if (!pr)` branch below) —
  // feeds the SPEC-03 eval-case/eval-run seed further down (T13(c)/(d)).
  let configFindingId: string | undefined;
  let usersFindingId: string | undefined;
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

    // pr_files (subset). src/config.ts and src/api/users.ts carry a real
    // `patch` (SPEC-03 T13) covering the two seeded findings below, so their
    // fragments can be cut for an eval case.
    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
      { prId: pr!.id, path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
      { prId: pr!.id, path: 'src/config.ts', additions: 4, deletions: 0, patch: CONFIG_TS_PATCH },
      { prId: pr!.id, path: 'src/api/users.ts', additions: 7, deletions: 2, patch: USERS_TS_PATCH },
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

    // SPEC-03 T13(b), field renamed under SPEC-04 (AC-40/AC-41): decide both
    // seeded findings so the eval-case draft's derived expectation kind is
    // demonstrable in both directions — accepted → must_find, dismissed →
    // must_not_flag.
    const insertedFindings = await db
      .insert(t.findings)
      .values([
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
          acceptedAt: new Date(),
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
          dismissedAt: new Date(),
        },
      ])
      .returning();
    configFindingId = insertedFindings[0]!.id;
    usersFindingId = insertedFindings[1]!.id;
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

  // ---- SPEC-03 eval pipeline (T13(c)/(d)): two eval cases for Security
  // Reviewer (one must_find, one must_not_flag) plus two completed
  // eval_suite_runs with different agent_version/metric/cost values, so both
  // AC-6 decision directions AND the AC-38/AC-39 comparison surface are
  // demonstrable with zero model calls. Only runs on a fresh seed (guarded by
  // the fresh-PR finding ids captured above), same limitation as the rest of
  // this fixed-target PR #482 dataset.
  if (configFindingId && usersFindingId) {
    const [securityAgent] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Security Reviewer')));
    const [testQualitySkill] = await db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, SEED_SKILLS[0]!.name)));

    if (securityAgent && testQualitySkill) {
      const configFragment = cutFragment('src/config.ts', CONFIG_TS_PATCH, 12, 12);
      const usersFragment = cutFragment('src/api/users.ts', USERS_TS_PATCH, 45, 52);

      // SPEC-04: severity/category copied from the finding each case was born
      // from (AC-44), and a `latest_result` in each direction (AC-52/AC-53)
      // so the case-row copy has both a passed and a failed case on screen.
      const [mustFindCase] = await db
        .insert(t.evalCases)
        .values({
          workspaceId,
          ownerKind: 'agent',
          ownerId: securityAgent.id,
          name: 'Flags a hardcoded Stripe secret key',
          inputDiff: configFragment ?? '',
          sourceFindingId: configFindingId,
          file: 'src/config.ts',
          startLine: 12,
          endLine: 12,
          severity: 'CRITICAL',
          category: 'security',
          latestResult: {
            completed: true,
            passed: true,
            error: null,
            findings: [
              {
                file: 'src/config.ts',
                start_line: 12,
                end_line: 12,
                grounded: true,
                severity: 'CRITICAL',
                title: 'Hardcoded Stripe secret key in commit',
              },
            ],
            matched_count: 1,
            ran_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
          },
        })
        .returning();
      await db.insert(t.evalCaseExpectations).values({
        caseId: mustFindCase!.id,
        kind: 'must_find',
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
      });

      const [mustNotFlagCase] = await db
        .insert(t.evalCases)
        .values({
          workspaceId,
          ownerKind: 'agent',
          ownerId: securityAgent.id,
          name: 'Does not flag the N+1 query as a security issue',
          inputDiff: usersFragment ?? '',
          sourceFindingId: usersFindingId,
          file: 'src/api/users.ts',
          startLine: 45,
          endLine: 52,
          severity: 'WARNING',
          category: 'perf',
          // Failed: the agent flagged the range a must_not_flag case forbids.
          latestResult: {
            completed: true,
            passed: false,
            error: null,
            findings: [
              {
                file: 'src/api/users.ts',
                start_line: 45,
                end_line: 52,
                grounded: true,
                severity: 'WARNING',
                title: 'N+1 query in user list endpoint',
              },
            ],
            matched_count: 1,
            ran_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
          },
        })
        .returning();
      await db.insert(t.evalCaseExpectations).values({
        caseId: mustNotFlagCase!.id,
        kind: 'must_not_flag',
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
      });

      // A THIRD case for the same agent with severity/category/latest_result
      // all left NULL — the "created before this round / never run" state
      // AC-54 and the severity edge case describe. No `sourceFindingId`: it
      // doesn't need to trace back to a decided finding to demonstrate the
      // unavailable-not-defaulted state on screen.
      const neverRunFragment = cutFragment('src/api/users.ts', USERS_TS_PATCH, 46, 49);
      const [neverRunCase] = await db
        .insert(t.evalCases)
        .values({
          workspaceId,
          ownerKind: 'agent',
          ownerId: securityAgent.id,
          name: 'Preserves original per-id ordering after the batch query',
          inputDiff: neverRunFragment ?? '',
          sourceFindingId: null,
          file: 'src/api/users.ts',
          startLine: 46,
          endLine: 49,
        })
        .returning();
      await db.insert(t.evalCaseExpectations).values({
        caseId: neverRunCase!.id,
        kind: 'must_find',
        file: 'src/api/users.ts',
        startLine: 46,
        endLine: 49,
      });

      type SeedReturnedFinding = {
        file: string;
        start_line: number;
        end_line: number;
        grounded: boolean;
        severity: string;
        title: string;
      };

      // Older → newer, agent_version 1 → 2, showing a regression (recall and
      // precision both drop) so run-history/compare have something real to
      // render — the run's OWN skill snapshot also differs (skill_version
      // 1 → 2) even though nothing about the seeded `skills` row changed,
      // exactly the "recorded at invocation time" contract AC-38 needs.
      const runDefs: Array<{
        startedAt: Date;
        agentVersion: number;
        skillVersion: number;
        recall: number;
        precision: number;
        citationAccuracy: number;
        costUsd: number;
        casesPassed: number;
        mustFindOutput: SeedReturnedFinding[];
        mustNotFlagOutput: SeedReturnedFinding[];
      }> = [
        {
          startedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 6), // 6 days ago
          agentVersion: 1,
          skillVersion: 1,
          recall: 1,
          precision: 1,
          citationAccuracy: 1,
          costUsd: 0.007,
          casesPassed: 2,
          mustFindOutput: [
            {
              file: 'src/config.ts',
              start_line: 12,
              end_line: 12,
              grounded: true,
              severity: 'CRITICAL',
              title: 'Hardcoded Stripe secret key in commit',
            },
          ],
          mustNotFlagOutput: [],
        },
        {
          startedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2), // 2 days ago
          agentVersion: 2,
          skillVersion: 2,
          recall: 0,
          precision: 0,
          citationAccuracy: 1,
          costUsd: 0.0075,
          casesPassed: 0,
          mustFindOutput: [],
          mustNotFlagOutput: [
            {
              file: 'src/api/users.ts',
              start_line: 45,
              end_line: 52,
              grounded: true,
              severity: 'WARNING',
              title: 'N+1 query in user list endpoint',
            },
          ],
        },
      ];

      for (const def of runDefs) {
        const completedAt = new Date(def.startedAt.getTime() + 1000 * 30);
        const [suiteRun] = await db
          .insert(t.evalSuiteRuns)
          .values({
            workspaceId,
            agentId: securityAgent.id,
            agentVersion: def.agentVersion,
            status: 'completed',
            startedAt: def.startedAt,
            completedAt,
            casesTotal: 2,
            casesCompleted: 2,
            casesPassed: def.casesPassed,
            casesFailedToComplete: 0,
            recall: def.recall,
            precision: def.precision,
            citationAccuracy: def.citationAccuracy,
            costUsd: def.costUsd,
          })
          .returning();

        await db.insert(t.evalRuns).values([
          {
            caseId: mustFindCase!.id,
            suiteRunId: suiteRun!.id,
            ranAt: def.startedAt,
            actualOutput: def.mustFindOutput,
            pass: def.mustFindOutput.length > 0,
            costUsd: def.costUsd / 2,
          },
          {
            caseId: mustNotFlagCase!.id,
            suiteRunId: suiteRun!.id,
            ranAt: def.startedAt,
            actualOutput: def.mustNotFlagOutput,
            pass: def.mustNotFlagOutput.length === 0,
            costUsd: def.costUsd / 2,
          },
        ]);

        // Different eval_run_skills rows across the two runs — same skill
        // id, two different skill_version values (AC-38/AC-39).
        await db.insert(t.evalRunSkills).values({
          suiteRunId: suiteRun!.id,
          skillId: testQualitySkill.id,
          skillVersion: def.skillVersion,
          skillName: testQualitySkill.name,
          linkOrder: 0,
        });
      }
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
