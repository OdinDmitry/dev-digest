import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  doublePrecision,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { workspaces } from './core';
import { agentRuns } from './runs';

export const ciInstallations = pgTable(
  'ci_installations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    repo: text('repo').notNull(),
    targetType: text('target_type', { enum: ['gha', 'circle', 'jenkins', 'cli'] }).notNull(),
    installedAt: timestamp('installed_at', { withTimezone: true }).defaultNow().notNull(),
    // The marker version stamped into the last-committed workflow (AC-8/AC-9).
    // Null = unknown (never installed with a version marker, or reset) ⇒ never current.
    workflowVersion: text('workflow_version'),
    prUrl: text('pr_url'),
    ciFailOn: text('ci_fail_on', { enum: ['never', 'critical', 'warning', 'any'] })
      .notNull()
      .default('critical'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One installation row per (agent, repo) — install is an upsert, never a
    // second row for a re-publish.
    agentRepoUq: uniqueIndex('ci_installations_agent_repo_uq').on(t.agentId, t.repo),
    workspaceIdx: index('ci_installations_workspace_idx').on(t.workspaceId),
  }),
);

export const ciRuns = pgTable(
  'ci_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ciInstallationId: uuid('ci_installation_id').references(() => ciInstallations.id, {
      onDelete: 'set null',
    }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    agentRunId: uuid('agent_run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
    /** The platform's own run id, as a string (`CiWorkflowRunRef.id`). */
    providerRunId: text('provider_run_id').notNull(),
    prNumber: integer('pr_number'),
    headSha: text('head_sha'),
    ranAt: timestamp('ran_at', { withTimezone: true }),
    status: text('status').notNull().default('in_progress'),
    verdict: text('verdict'),
    unavailableReason: text('unavailable_reason'),
    findingsCount: integer('findings_count'),
    criticalCount: integer('critical_count'),
    warningCount: integer('warning_count'),
    suggestionCount: integer('suggestion_count'),
    costUsd: doublePrecision('cost_usd'),
    durationMs: integer('duration_ms'),
    githubUrl: text('github_url').notNull(),
    source: text('source'),
    manifestVersion: integer('manifest_version'),
    model: text('model'),
    runnerBuild: text('runner_build'),
  },
  (t) => ({
    installationProviderUq: uniqueIndex('ci_runs_installation_provider_uq').on(
      t.ciInstallationId,
      t.providerRunId,
    ),
    workspaceRanIdx: index('ci_runs_workspace_ran_idx').on(t.workspaceId, t.ranAt),
    agentIdx: index('ci_runs_agent_idx').on(t.agentId),
  }),
);
