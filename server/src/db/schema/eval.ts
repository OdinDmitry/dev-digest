import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { repos } from './repos';
import { pullRequests } from './pulls';
import { findings } from './reviews';
import { agents } from './agents';

// ============================================================ Eval / Conformance / Compose

export const evalCases = pgTable(
  'eval_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    name: text('name').notNull(),
    inputDiff: text('input_diff').notNull().default(''),
    // Non-goal: the Files/PR-meta input tabs stay unused (root CLAUDE.md).
    inputFiles: jsonb('input_files'),
    inputMeta: jsonb('input_meta'),
    // Stores the `EvalExpectation[]` array (contracts/knowledge.ts). Column
    // name kept as `expected_output` — only the DTO field was renamed.
    expectedOutput: jsonb('expected_output').notNull().default(sql`'[]'::jsonb`),
    notes: text('notes'),
    // Repository association — SET NULL (not CASCADE) so a deleted repo lands
    // the case in the "no repository" state (AC-49/AC-50) instead of deleting it.
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'set null' }),
    // Seed-from-finding origin — SET NULL so a case created from an
    // accepted/dismissed finding survives that finding's own review being deleted.
    originFindingId: uuid('origin_finding_id').references(() => findings.id, {
      onDelete: 'set null',
    }),
    originPrId: uuid('origin_pr_id').references(() => pullRequests.id, { onDelete: 'set null' }),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ownerIdx: index('eval_cases_owner_idx').on(t.ownerId),
    workspaceIdx: index('eval_cases_workspace_idx').on(t.workspaceId),
  }),
);

// ---- eval_suite_runs / eval_case_results (the suite-run session + its frozen
// per-case results). eval_case_results freezes each case's name, diff,
// repository and expectations at run start — AC-30 and the "editing a case
// between two runs" edge case both require a frozen copy, not a live join.

export const evalSuiteRuns = pgTable(
  'eval_suite_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    state: text('state', { enum: ['pending', 'running', 'completed', 'failed'] })
      .notNull()
      .default('pending'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    systemPrompt: text('system_prompt').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    strategy: text('strategy').notNull(),
    // Captured linked skills at run start: [{name, body}].
    skills: jsonb('skills').notNull().default(sql`'[]'::jsonb`),
    capturedContext: jsonb('captured_context')
      .notNull()
      .default(sql`'{"documents":[],"excluded":[]}'::jsonb`),
    casesTotal: integer('cases_total').notNull().default(0),
    casesDone: integer('cases_done').notNull().default(0),
    passedCount: integer('passed_count').notNull().default(0),
    erroredCount: integer('errored_count').notNull().default(0),
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    // Never defaulted to 0 — "cost not reported" is presented as unavailable,
    // never as zero.
    costUsd: doublePrecision('cost_usd'),
    durationMs: integer('duration_ms'),
  },
  (t) => ({
    agentStartedIdx: index('eval_suite_runs_agent_started_idx').on(t.agentId, t.startedAt),
    workspaceIdx: index('eval_suite_runs_workspace_idx').on(t.workspaceId),
    // AC-23 as a database invariant, not a check-then-insert race between tabs.
    oneActivePerAgent: uniqueIndex('eval_suite_runs_one_active_per_agent')
      .on(t.agentId)
      .where(sql`${t.state} in ('pending','running')`),
  }),
);

export const evalCaseResults = pgTable(
  'eval_case_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => evalSuiteRuns.id, { onDelete: 'cascade' }),
    caseId: uuid('case_id').references(() => evalCases.id, { onDelete: 'set null' }),
    ordinal: integer('ordinal').notNull(),
    caseName: text('case_name').notNull(),
    caseRepoId: uuid('case_repo_id').references(() => repos.id, { onDelete: 'set null' }),
    caseInputDiff: text('case_input_diff').notNull(),
    caseExpectations: jsonb('case_expectations').notNull(),
    status: text('status', { enum: ['pending', 'passed', 'failed', 'errored'] })
      .notNull()
      .default('pending'),
    error: text('error'),
    findings: jsonb('findings').notNull().default(sql`'[]'::jsonb`),
    rawFindingsCount: integer('raw_findings_count').notNull().default(0),
    expectedCount: integer('expected_count').notNull().default(0),
    matchedCount: integer('matched_count').notNull().default(0),
    costUsd: doublePrecision('cost_usd'),
    durationMs: integer('duration_ms'),
    createdAt: now(),
  },
  (t) => ({
    runOrdinalUq: uniqueIndex('eval_case_results_run_ordinal_uq').on(t.runId, t.ordinal),
    caseIdx: index('eval_case_results_case_idx').on(t.caseId),
  }),
);

export const conformanceChecks = pgTable('conformance_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  specId: text('spec_id').notNull(),
  completenessPct: doublePrecision('completeness_pct'),
  items: jsonb('items'),
});

export const composedReviews = pgTable('composed_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  verdict: text('verdict'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  githubReviewId: text('github_review_id'),
});
