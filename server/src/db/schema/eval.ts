import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  doublePrecision,
  index,
  uniqueIndex,
  primaryKey,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { now } from './_shared';
import { workspaces } from './core';
import { pullRequests } from './pulls';
import { agents } from './agents';

// ============================================================ Eval / Conformance / Compose

/**
 * SPEC-03 eval pipeline. `eval_cases` (pre-existing, extended below) is a
 * frozen input+expectation record; `eval_case_expectations` is its child
 * table (fixed shape, cross-row invariant — see `eval_case_finding_uq` and
 * the service-level overlap check, not a DB constraint). `eval_suite_runs` is
 * the NEW per-suite run row (the shipped `eval_runs` below stays per-case and
 * links to it via `suite_run_id`). `eval_run_skills` snapshots the skill set
 * a run actually invoked and deliberately carries NO foreign key to `skills`
 * — a cascade would erase exactly the evidence AC-39 compares against, once
 * that skill is later deleted.
 */
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
    // Holds the frozen diff fragment (AC-9). Empty in the pre-SPEC-03 shipped
    // shape; the table is empty in every environment, so SET NOT NULL is safe.
    inputDiff: text('input_diff').notNull(),
    inputFiles: jsonb('input_files'),
    inputMeta: jsonb('input_meta'),
    expectedOutput: jsonb('expected_output'),
    notes: text('notes'),
    // The finding this case was born from. NO foreign key, on purpose — the
    // case must survive the finding's deletion.
    sourceFindingId: uuid('source_finding_id'),
    file: text('file').notNull(),
    startLine: integer('start_line').notNull(),
    endLine: integer('end_line').notNull(),
    createdAt: now(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    // SPEC-04. All three NULLABLE: the table has live rows in this workspace,
    // and a case created before this round states them as unavailable rather
    // than defaulting (AC-44, AC-52/AC-54 edge case) — never backfilled.
    severity: text('severity'),
    category: text('category'),
    // EvalCaseLatestResult jsonb; the case's most recent outcome from either a
    // suite run or a single-case verification (AC-48). The pointer that moves.
    latestResult: jsonb('latest_result'),
  },
  (t) => ({
    // AC-10: at most one non-deleted case per (workspace, finding).
    findingUq: uniqueIndex('eval_case_finding_uq')
      .on(t.workspaceId, t.sourceFindingId)
      .where(sql`${t.sourceFindingId} is not null and ${t.deletedAt} is null`),
    ownerCreatedIdx: index('eval_cases_owner_created_idx').on(t.ownerId, t.createdAt, t.id),
  }),
);

export const evalCaseExpectations = pgTable(
  'eval_case_expectations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => evalCases.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['must_find', 'must_not_flag'] }).notNull(),
    file: text('file').notNull(),
    startLine: integer('start_line').notNull(),
    endLine: integer('end_line').notNull(),
  },
  (t) => ({
    caseIdx: index('eval_case_expectations_case_idx').on(t.caseId),
    kindCheck: check(
      'eval_case_expectations_kind_check',
      sql`${t.kind} in ('must_find','must_not_flag')`,
    ),
    endLineCheck: check(
      'eval_case_expectations_end_line_check',
      sql`${t.endLine} >= ${t.startLine}`,
    ),
  }),
);

/** A run over one agent's whole case set (the spec's "eval run"). The
 *  shipped `eval_runs` below stays the per-CASE row and links here via
 *  `suite_run_id`. */
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
    // Plain int, NO composite FK to agent_versions — a run must outlive a
    // deleted config version.
    agentVersion: integer('agent_version').notNull(),
    status: text('status', { enum: ['running', 'completed', 'failed'] }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    casesTotal: integer('cases_total').notNull(),
    casesCompleted: integer('cases_completed').notNull().default(0),
    casesPassed: integer('cases_passed'),
    casesFailedToComplete: integer('cases_failed_to_complete').notNull().default(0),
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    costUsd: doublePrecision('cost_usd'),
  },
  (t) => ({
    // AC-16: at most one `running` suite run per agent — the DB is the source
    // of truth so two concurrent POSTs cannot both win.
    oneRunningPerAgent: uniqueIndex('eval_one_running_per_agent')
      .on(t.agentId)
      .where(sql`${t.status} = 'running'`),
    workspaceStartedIdx: index('eval_suite_runs_workspace_started_idx').on(
      t.workspaceId,
      t.startedAt,
      t.id,
    ),
    agentStartedIdx: index('eval_suite_runs_agent_started_idx').on(t.agentId, t.startedAt, t.id),
    statusCheck: check(
      'eval_suite_runs_status_check',
      sql`${t.status} in ('running','completed','failed')`,
    ),
  }),
);

/**
 * One skill as a suite run actually invoked (AC-38): its identity, the
 * `skills.version` (body-tracking) current at invocation time, and a `name`
 * snapshot so a deleted skill still renders a label. Deliberately carries NO
 * foreign key to `skills` — see the module header comment above.
 */
export const evalRunSkills = pgTable(
  'eval_run_skills',
  {
    suiteRunId: uuid('suite_run_id')
      .notNull()
      .references(() => evalSuiteRuns.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id').notNull(),
    skillVersion: integer('skill_version').notNull(),
    skillName: text('skill_name').notNull(),
    // Named link_order, not `order`: `order` is a reserved word and would
    // need quoting.
    linkOrder: integer('link_order').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.suiteRunId, t.skillId] }),
    suiteRunIdx: index('eval_run_skills_suite_run_idx').on(t.suiteRunId),
  }),
);

export const evalRuns = pgTable(
  'eval_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => evalCases.id, { onDelete: 'cascade' }),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    actualOutput: jsonb('actual_output'),
    pass: boolean('pass'),
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    durationMs: integer('duration_ms'),
    costUsd: doublePrecision('cost_usd'),
    suiteRunId: uuid('suite_run_id').references(() => evalSuiteRuns.id, { onDelete: 'cascade' }),
    // Non-null == the invocation did not complete (AC-20/21/22).
    error: text('error'),
  },
  (t) => ({
    suiteRunIdx: index('eval_runs_suite_run_idx').on(t.suiteRunId),
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
