import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { CiFailOn, CiTarget } from '@devdigest/shared';

/**
 * CI data-access (ring 3). The ONLY place that touches `ci_installations`
 * for this phase. Every query is scoped by `workspaceId` (tenancy guard).
 */

import type { CiInstallationRow } from '../../db/rows.js';
export type { CiInstallationRow };

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
}
