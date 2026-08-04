import type { Skill, SkillImportPreview, SkillSource, SkillType } from '@devdigest/shared';
import { SkillsRepository, type SkillCountRow } from './repository.js';
import { parseSkillUpload, type SkillUpload } from './import.js';
import { toSkillDto } from './helpers.js';

/**
 * Skills service — the reusable prompt blocks agents attach to.
 *
 * A Skill is TEXT ONLY: a name, a directive description (its interface — what
 * the agent reads to decide whether the skill applies), a type, and a markdown
 * body. It has no tools, no code and no execution path; the body is inserted
 * into the assembled prompt verbatim and nothing else.
 *
 * Body edits are versioned via `skill_versions` (repository).
 */

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  source?: SkillSource;
  body: string;
  enabled?: boolean;
  evidence_files?: string[] | null;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
  evidence_files?: string[] | null;
}

export interface SkillsServiceDeps {
  repo: SkillsRepository;
}

export class SkillsService {
  constructor(private deps: SkillsServiceDeps) {}

  async list(workspaceId: string): Promise<Skill[]> {
    const rows = await this.deps.repo.list(workspaceId);
    return rows.map(toSkillDto);
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.deps.repo.getById(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const row = await this.deps.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      type: input.type,
      source: input.source ?? 'manual',
      body: input.body,
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.evidence_files !== undefined ? { evidenceFiles: input.evidence_files } : {}),
    });
    return toSkillDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    const row = await this.deps.repo.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.evidence_files !== undefined ? { evidenceFiles: patch.evidence_files } : {}),
    });
    return row ? toSkillDto(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.deps.repo.deleteById(workspaceId, id);
  }

  /** Body-version history (newest first) — versions are immutable snapshots. */
  async listVersions(
    workspaceId: string,
    id: string,
  ): Promise<Array<{ version: number; created_at: string }> | undefined> {
    const skill = await this.deps.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const rows = await this.deps.repo.listVersions(id);
    return rows.map((r) => ({ version: r.version, created_at: r.createdAt.toISOString() }));
  }

  /**
   * Parse an upload into a preview. Writes NOTHING — the client shows the parsed
   * skill plus everything the importer refused to read, and only then calls
   * `create` with the confirmed values.
   */
  previewImport(upload: SkillUpload): SkillImportPreview {
    return parseSkillUpload(upload);
  }

  /** Linked-skill count per agent, for the agent cards. */
  async countsByAgent(workspaceId: string): Promise<SkillCountRow[]> {
    return this.deps.repo.countsByAgent(workspaceId);
  }
}
