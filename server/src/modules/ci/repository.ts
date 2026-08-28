import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { CiFailOn, CiRun, CiTarget, CiVerdict } from '@devdigest/shared';

/**
 * CI data-access (ring 3). The ONLY place that touches `ci_installations`
 * and `ci_runs`. Every query is scoped by `workspaceId` (tenancy guard).
 */

import type { CiInstallationRow, CiRunRow } from '../../db/rows.js';
export type { CiInstallationRow, CiRunRow };

export interface UpsertCiInstallation {
  workspaceId: string;
  agentId: string;
  repo: string;
  targetType: CiTarget;
  workflowVersion: string | null;
  prUrl: string | null;
  ciFailOn: CiFailOn;
}

export class CiRepository {
  constructor(private db: Db) {}

  async getInstallation(
    workspaceId: string,
    agentId: string,
    repo: string,
  ): Promise<CiInstallationRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.ciInstallations)
      .where(
        and(
          eq(t.ciInstallations.workspaceId, workspaceId),
          eq(t.ciInstallations.agentId, agentId),
          eq(t.ciInstallations.repo, repo),
        ),
      );
    return row;
  }

  /** All installations for an agent, newest first (`id` is a unique final
   *  tiebreaker for rows sharing the same `installed_at` — server/insights.md,
   *  Recurring Errors 2026-08-04). */
  async listForAgent(workspaceId: string, agentId: string): Promise<CiInstallationRow[]> {
    return this.db
      .select()
      .from(t.ciInstallations)
      .where(
        and(
          eq(t.ciInstallations.workspaceId, workspaceId),
          eq(t.ciInstallations.agentId, agentId),
        ),
      )
      .orderBy(desc(t.ciInstallations.installedAt), desc(t.ciInstallations.id));
  }

  /**
   * Insert-or-refresh the single installation for `(agent, repo)` — a
   * re-publish never creates a second row (AC-7/AC-8). `installedAt` is left
   * untouched on conflict; `updatedAt` bumps.
   */
  async upsertInstallation(values: UpsertCiInstallation): Promise<CiInstallationRow> {
    const [row] = await this.db
      .insert(t.ciInstallations)
      .values({
        workspaceId: values.workspaceId,
        agentId: values.agentId,
        repo: values.repo,
        targetType: values.targetType,
        workflowVersion: values.workflowVersion,
        prUrl: values.prUrl,
        ciFailOn: values.ciFailOn,
      })
      .onConflictDoUpdate({
        target: [t.ciInstallations.agentId, t.ciInstallations.repo],
        set: {
          targetType: values.targetType,
          workflowVersion: values.workflowVersion,
          prUrl: values.prUrl,
          ciFailOn: values.ciFailOn,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row!;
  }

  /** Every installation in the workspace (across all agents) — the fan-out
   *  root for `CiService.refresh`. */
  async listInstallationsForWorkspace(workspaceId: string): Promise<CiInstallationRow[]> {
    return this.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.workspaceId, workspaceId));
  }

  /**
   * Of the given provider run ids for `installationId`, the subset already
   * stored in a TERMINAL status (`recorded` or `unavailable`) — refresh skips
   * these before fetching anything (AC-14/AC-15's "no re-download" rule).
   */
  async terminalProviderRunIds(
    installationId: string,
    providerRunIds: string[],
  ): Promise<Set<string>> {
    if (providerRunIds.length === 0) return new Set();
    const rows = await this.db
      .select({ providerRunId: t.ciRuns.providerRunId })
      .from(t.ciRuns)
      .where(
        and(
          eq(t.ciRuns.ciInstallationId, installationId),
          inArray(t.ciRuns.providerRunId, providerRunIds),
          inArray(t.ciRuns.status, ['recorded', 'unavailable']),
        ),
      );
    return new Set(rows.map((r) => r.providerRunId));
  }

  /**
   * Insert-or-refresh the single `ci_runs` row for
   * `(ciInstallationId, providerRunId)` — a re-refresh of the same run never
   * creates a second row.
   */
  async upsertRun(values: UpsertCiRun): Promise<CiRunRow> {
    const shared = {
      workspaceId: values.workspaceId,
      ciInstallationId: values.ciInstallationId,
      agentId: values.agentId,
      agentRunId: values.agentRunId,
      prNumber: values.prNumber,
      headSha: values.headSha,
      ranAt: values.ranAt,
      status: values.status,
      verdict: values.verdict,
      unavailableReason: values.unavailableReason,
      findingsCount: values.findingsCount,
      criticalCount: values.criticalCount,
      warningCount: values.warningCount,
      suggestionCount: values.suggestionCount,
      costUsd: values.costUsd,
      durationMs: values.durationMs,
      githubUrl: values.githubUrl,
      manifestVersion: values.manifestVersion,
      model: values.model,
      runnerBuild: values.runnerBuild,
    };
    const [row] = await this.db
      .insert(t.ciRuns)
      .values({ ...shared, providerRunId: values.providerRunId })
      .onConflictDoUpdate({
        target: [t.ciRuns.ciInstallationId, t.ciRuns.providerRunId],
        set: shared,
      })
      .returning();
    return row!;
  }

  /** Every CI run in the workspace, newest first — `ran_at DESC NULLS LAST,
   *  id DESC` (a unique final tiebreaker — server/insights.md, Recurring
   *  Errors 2026-08-04). */
  async listRunsForWorkspace(workspaceId: string): Promise<CiRun[]> {
    const rows = await this.runsWithAgentAndRepo(eq(t.ciRuns.workspaceId, workspaceId));
    return rows.map(({ run, agentName, repo }) => ciRunToDto(run, agentName, repo));
  }

  /** Every CI run for one agent in the workspace, same ordering. */
  async listRunsForAgent(workspaceId: string, agentId: string): Promise<CiRun[]> {
    const rows = await this.runsWithAgentAndRepo(
      and(eq(t.ciRuns.workspaceId, workspaceId), eq(t.ciRuns.agentId, agentId)),
    );
    return rows.map(({ run, agentName, repo }) => ciRunToDto(run, agentName, repo));
  }

  /** `ci_runs` LEFT JOIN `agents` (for the display name) LEFT JOIN
   *  `ci_installations` (for the repo full name — not stored on `ci_runs`
   *  itself). Both joins are LEFT: `agent_id`/`ci_installation_id` are
   *  nullable (`onDelete: 'set null'`), so a run must still list even after
   *  its agent or installation is removed. */
  private async runsWithAgentAndRepo(
    where: SQL | undefined,
  ): Promise<{ run: CiRunRow; agentName: string | null; repo: string | null }[]> {
    return this.db
      .select({ run: t.ciRuns, agentName: t.agents.name, repo: t.ciInstallations.repo })
      .from(t.ciRuns)
      .leftJoin(t.agents, eq(t.agents.id, t.ciRuns.agentId))
      .leftJoin(t.ciInstallations, eq(t.ciInstallations.id, t.ciRuns.ciInstallationId))
      .where(where)
      .orderBy(sql`${t.ciRuns.ranAt} DESC NULLS LAST`, desc(t.ciRuns.id));
  }

  /**
   * The CI module owns its own `agent_runs` insert — `createAgentRun` in
   * `modules/reviews/` requires a `pr_id` a CI run does not have and
   * hardcodes `source: 'local'`. Records a completed ('done') CI run.
   */
  async insertCiAgentRun(values: {
    workspaceId: string;
    agentId: string;
    provider: string | null;
    model: string | null;
    durationMs: number;
    costUsd: number | null;
    findingsCount: number;
    blockers: number;
    warningCount: number;
    suggestionCount: number;
  }): Promise<string> {
    const [row] = await this.db
      .insert(t.agentRuns)
      .values({
        workspaceId: values.workspaceId,
        agentId: values.agentId,
        prId: null,
        provider: values.provider,
        model: values.model,
        status: 'done',
        source: 'ci',
        durationMs: values.durationMs,
        costUsd: values.costUsd,
        findingsCount: values.findingsCount,
        blockers: values.blockers,
        warningCount: values.warningCount,
        suggestionCount: values.suggestionCount,
      })
      .returning({ id: t.agentRuns.id });
    return row!.id;
  }
}

export interface UpsertCiRun {
  workspaceId: string;
  ciInstallationId: string;
  agentId: string | null;
  agentRunId: string | null;
  providerRunId: string;
  prNumber: number | null;
  headSha: string | null;
  ranAt: Date | null;
  status: 'in_progress' | 'recorded' | 'unavailable';
  verdict: CiVerdict | null;
  unavailableReason: string | null;
  findingsCount: number | null;
  criticalCount: number | null;
  warningCount: number | null;
  suggestionCount: number | null;
  costUsd: number | null;
  durationMs: number | null;
  githubUrl: string;
  manifestVersion: number | null;
  model: string | null;
  runnerBuild: string | null;
}

/**
 * Map a `ci_runs` row (+ its agent's name and its installation's repo, both
 * left-joined) to the API DTO. `repo` falls back to `''` only when the
 * installation itself has been deleted — should not happen in practice
 * since `ci_installations` rows are never removed by this phase.
 */
export function ciRunToDto(row: CiRunRow, agentName: string | null, repo: string | null): CiRun {
  return {
    id: row.id,
    ci_installation_id: row.ciInstallationId,
    agent_id: row.agentId,
    agent_name: agentName,
    repo: repo ?? '',
    pr_number: row.prNumber,
    head_sha: row.headSha,
    status: row.status as CiRun['status'],
    verdict: row.verdict as CiVerdict | null,
    unavailable_reason: row.unavailableReason,
    findings_count: row.findingsCount,
    critical: row.criticalCount,
    warning: row.warningCount,
    suggestion: row.suggestionCount,
    cost_usd: row.costUsd,
    duration_ms: row.durationMs,
    ran_at: row.ranAt ? row.ranAt.toISOString() : null,
    job_url: row.githubUrl,
    model: row.model,
    manifest_version: row.manifestVersion,
    runner_build: row.runnerBuild,
  };
}
