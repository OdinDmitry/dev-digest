import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SkillSource, SkillType } from '@devdigest/shared';
import { INITIAL_SKILL_VERSION } from './constants.js';
import { isBodyChange } from './helpers.js';

/**
 * Skills data-access. Owns `skills` and `skill_versions`; the `agent_skills`
 * link table's agent side stays with the agents repository (link/reorder for one
 * agent) — this module only reads it for the per-agent skill count.
 * Workspace-scoped throughout.
 */

import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
export type { SkillRow, SkillVersionRow };

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled?: boolean;
  evidenceFiles?: string[] | null;
}

export interface UpdateSkill {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
  evidenceFiles?: string[] | null;
  /**
   * Author's "what changed?" note for the version snapshot this update would
   * create. Named distinctly from `skills.*` fields (there is no `note` column
   * on `skills` itself) so it can never be accidentally spread into the
   * `skills` UPDATE — it is forwarded ONLY to `snapshotVersion`, and only when
   * the body actually changed (see `update()`).
   */
  versionNote?: string | null;
}

/** Skills linked per agent, for the agent cards' "N skills" badge. */
export interface SkillCountRow {
  agentId: string;
  skillCount: number;
}

/** Agents linked per skill, for the skill rail's "N agents" footer. */
export interface AgentCountRow {
  skillId: string;
  agentCount: number;
}

export class SkillsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<SkillRow[]> {
    return this.db
      .select()
      .from(t.skills)
      .where(eq(t.skills.workspaceId, workspaceId))
      .orderBy(t.skills.name);
  }

  async getById(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  /** Delete a skill (scoped to workspace). Versions and agent links cascade.
   *  Returns false when no such skill existed in the workspace. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  /** Insert a skill AND record version 1 in skill_versions (immutable snapshot). */
  async insert(values: InsertSkill): Promise<SkillRow> {
    const [row] = await this.db
      .insert(t.skills)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description,
        type: values.type,
        source: values.source,
        body: values.body,
        enabled: values.enabled ?? true,
        version: INITIAL_SKILL_VERSION,
        evidenceFiles: values.evidenceFiles ?? null,
      })
      .returning();
    // v1 never carries a note — there is no prior version for the author to
    // describe a change against.
    await this.snapshotVersion(row!.id, INITIAL_SKILL_VERSION, row!.body, null);
    return row!;
  }

  /**
   * Update a skill. A body change bumps the version and snapshots the NEW body
   * into skill_versions; renames, retypes and enable/disable do not — see
   * `isBodyChange` for why.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkill,
  ): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    const bodyChanged = isBodyChange(existing, patch);
    const nextVersion = bodyChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.skills)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.evidenceFiles !== undefined ? { evidenceFiles: patch.evidenceFiles } : {}),
        ...(bodyChanged ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();

    // A note attached to a patch that does NOT change the body has nothing to
    // snapshot and is discarded here by design — the UI only shows the note
    // field while the body is dirty, so this should never be reachable from
    // the client, but the repository stays correct either way.
    if (bodyChanged && row) {
      await this.snapshotVersion(row.id, nextVersion, row.body, patch.versionNote ?? null);
    }
    return row;
  }

  private async snapshotVersion(
    skillId: string,
    version: number,
    body: string,
    note: string | null,
  ): Promise<void> {
    await this.db
      .insert(t.skillVersions)
      .values({ skillId, version, body, note })
      .onConflictDoNothing();
  }

  /** All body snapshots for a skill, newest version first. */
  async listVersions(skillId: string): Promise<SkillVersionRow[]> {
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
  }

  /** A single body snapshot, or undefined if that version was never recorded. */
  async getVersion(skillId: string, version: number): Promise<SkillVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skillVersions)
      .where(and(eq(t.skillVersions.skillId, skillId), eq(t.skillVersions.version, version)));
    return row;
  }

  /**
   * Linked-skill count per agent for the whole workspace — ONE grouped query, so
   * the agents list never fans out into a per-card request. Agents with no linked
   * skills are absent from the result; callers default them to 0.
   */
  async countsByAgent(workspaceId: string): Promise<SkillCountRow[]> {
    const rows = await this.db
      .select({
        agentId: t.agentSkills.agentId,
        // postgres-js returns count() as a string — cast in SQL AND coerce below.
        skillCount: sql<number>`count(*)::int`,
      })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .where(eq(t.agents.workspaceId, workspaceId))
      .groupBy(t.agentSkills.agentId);
    return rows.map((r) => ({ agentId: r.agentId, skillCount: Number(r.skillCount) }));
  }

  /**
   * Linked-agent count per skill for the whole workspace — ONE grouped query,
   * mirroring `countsByAgent` above but grouped the other way. Skills with no
   * linked agent are absent from the result; callers default them to 0.
   */
  async countsBySkill(workspaceId: string): Promise<AgentCountRow[]> {
    const rows = await this.db
      .select({
        skillId: t.agentSkills.skillId,
        // postgres-js returns count() as a string — cast in SQL AND coerce below.
        agentCount: sql<number>`count(*)::int`,
      })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(eq(t.skills.workspaceId, workspaceId))
      .groupBy(t.agentSkills.skillId);
    return rows.map((r) => ({ skillId: r.skillId, agentCount: Number(r.agentCount) }));
  }
}
