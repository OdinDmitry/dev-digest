import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ContextOwnerKind } from '@devdigest/shared';

/**
 * modules/context/repository.ts — the ONLY file touching `context_attachments`.
 * Workspace-scoped throughout.
 */

export type ContextAttachmentRow = typeof t.contextAttachments.$inferSelect;

/** One assembled-context candidate: which repo/path, stripped of owner info. */
export interface OwnerContextEntry {
  repoId: string;
  path: string;
}

/** One entry of an owner's ordered attachment set — row shape stripped down
 *  to what `service.ts` needs, so the raw `ContextAttachmentRow` never
 *  crosses the repository boundary (onion-architecture: row types die
 *  here, not in ring 2). */
export interface OwnerAttachmentEntry {
  repoId: string;
  path: string;
  order: number;
}

export interface AgentSkillGroup {
  skillId: string;
  entries: OwnerContextEntry[];
}

/** Raw material for `helpers.assembleEntries` — an agent's own attachments
 *  plus, for every skill it links (in link order), that skill's attachments. */
export interface AgentAssembledInput {
  skillGroups: AgentSkillGroup[];
  ownEntries: OwnerContextEntry[];
}

export interface AgentPathPair {
  path: string;
  agentId: string;
}

export class ContextRepository {
  constructor(private db: Db) {}

  private ownerColumn(kind: ContextOwnerKind) {
    return kind === 'agent' ? t.contextAttachments.agentId : t.contextAttachments.skillId;
  }

  /** An owner's attachments, ordered by `order` then `path` (never rely on an
   *  unstable tie — server/insights.md 2026-08-04). */
  async listForOwner(
    workspaceId: string,
    kind: ContextOwnerKind,
    ownerId: string,
  ): Promise<OwnerAttachmentEntry[]> {
    const rows = await this.db
      .select()
      .from(t.contextAttachments)
      .where(
        and(
          eq(t.contextAttachments.workspaceId, workspaceId),
          eq(this.ownerColumn(kind), ownerId),
        ),
      )
      .orderBy(asc(t.contextAttachments.order), asc(t.contextAttachments.path));
    return rows.map((r) => ({ repoId: r.repoId, path: r.path, order: r.order }));
  }

  /**
   * Replace an owner's whole ordered attachment set with `paths` (all under
   * `repoId`), inside one transaction so a concurrent read never observes a
   * half-empty set between the delete and the insert.
   */
  async replaceForOwner(
    workspaceId: string,
    kind: ContextOwnerKind,
    ownerId: string,
    repoId: string,
    paths: string[],
  ): Promise<void> {
    const ownerCol = this.ownerColumn(kind);
    await this.db.transaction(async (tx) => {
      await tx
        .delete(t.contextAttachments)
        .where(and(eq(t.contextAttachments.workspaceId, workspaceId), eq(ownerCol, ownerId)));
      if (paths.length === 0) return;
      await tx.insert(t.contextAttachments).values(
        paths.map((path, index) => ({
          workspaceId,
          repoId,
          path,
          order: index,
          ...(kind === 'agent' ? { agentId: ownerId } : { skillId: ownerId }),
        })),
      );
    });
  }

  /** Documents directly attached to an agent, for one repo. No `enabled`
   *  filter — the usage count deliberately includes disabled agents. */
  async attachmentAgentPairsForRepo(
    workspaceId: string,
    repoId: string,
  ): Promise<AgentPathPair[]> {
    const rows = await this.db
      .select({ path: t.contextAttachments.path, agentId: t.contextAttachments.agentId })
      .from(t.contextAttachments)
      .where(
        and(
          eq(t.contextAttachments.workspaceId, workspaceId),
          eq(t.contextAttachments.repoId, repoId),
          isNotNull(t.contextAttachments.agentId),
        ),
      );
    return rows.map((r) => ({ path: r.path, agentId: r.agentId! }));
  }

  /** Documents attached to a skill, projected onto every agent that links that
   *  skill (`context_attachments.skill_id → agent_skills.skill_id`). No
   *  `enabled` filter, same reason as above. */
  async attachmentAgentPairsViaSkillsForRepo(
    workspaceId: string,
    repoId: string,
  ): Promise<AgentPathPair[]> {
    return this.db
      .select({ path: t.contextAttachments.path, agentId: t.agentSkills.agentId })
      .from(t.contextAttachments)
      .innerJoin(t.agentSkills, eq(t.contextAttachments.skillId, t.agentSkills.skillId))
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .where(
        and(
          eq(t.contextAttachments.workspaceId, workspaceId),
          eq(t.contextAttachments.repoId, repoId),
          eq(t.agents.workspaceId, workspaceId),
          isNotNull(t.contextAttachments.skillId),
        ),
      );
  }

  /**
   * The agent's own attachments, plus for every skill it links (in link
   * order) that skill's attachments — the raw material for
   * `helpers.assembleEntries`. No `enabled` filter anywhere.
   */
  async listForAgentAndItsSkills(
    workspaceId: string,
    agentId: string,
  ): Promise<AgentAssembledInput> {
    const [ownRows, links] = await Promise.all([
      this.db
        .select()
        .from(t.contextAttachments)
        .where(
          and(
            eq(t.contextAttachments.workspaceId, workspaceId),
            eq(t.contextAttachments.agentId, agentId),
          ),
        )
        .orderBy(asc(t.contextAttachments.order), asc(t.contextAttachments.path)),
      this.db
        .select({ skillId: t.agentSkills.skillId, order: t.agentSkills.order })
        .from(t.agentSkills)
        .where(eq(t.agentSkills.agentId, agentId))
        .orderBy(asc(t.agentSkills.order)),
    ]);

    const skillIds = links.map((l) => l.skillId);
    const skillRows =
      skillIds.length === 0
        ? []
        : await this.db
            .select()
            .from(t.contextAttachments)
            .where(
              and(
                eq(t.contextAttachments.workspaceId, workspaceId),
                inArray(t.contextAttachments.skillId, skillIds),
              ),
            )
            .orderBy(asc(t.contextAttachments.order), asc(t.contextAttachments.path));

    const bySkill = new Map<string, OwnerContextEntry[]>();
    for (const row of skillRows) {
      const list = bySkill.get(row.skillId!) ?? [];
      list.push({ repoId: row.repoId, path: row.path });
      bySkill.set(row.skillId!, list);
    }

    const skillGroups: AgentSkillGroup[] = links.map((l) => ({
      skillId: l.skillId,
      entries: bySkill.get(l.skillId) ?? [],
    }));

    return {
      skillGroups,
      ownEntries: ownRows.map((r) => ({ repoId: r.repoId, path: r.path })),
    };
  }
}
