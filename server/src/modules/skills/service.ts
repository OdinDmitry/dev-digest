import type {
  Skill,
  SkillImportPreview,
  SkillListStats,
  SkillSource,
  SkillType,
  SkillVersion,
  SkillVersionDetail,
} from '@devdigest/shared';
import { SkillsRepository, type SkillCountRow } from './repository.js';
import { parseSkillUpload, type SkillUpload } from './import.js';
import { mergeSkillStats, toSkillDto, toSkillVersionDetailDto, toSkillVersionDto } from './helpers.js';

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
  /** Author's "what changed?" note; forwarded to the repo ONLY when the body
   *  actually changes (see `SkillsRepository.update`). */
  note?: string | null;
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
      ...(patch.note !== undefined ? { versionNote: patch.note } : {}),
    });
    return row ? toSkillDto(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.deps.repo.deleteById(workspaceId, id);
  }

  /**
   * Body-version history (newest first) — versions are immutable snapshots.
   * Bodies are deliberately NOT included: `skill_versions` grows one row per
   * save with no bound, and bodies are uncapped, so returning them here would
   * make every Versions-tab mount pay for the skill's entire edit history.
   * Fetch a body on demand via `getVersion`.
   */
  async listVersions(workspaceId: string, id: string): Promise<SkillVersion[] | undefined> {
    const skill = await this.deps.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const rows = await this.deps.repo.listVersions(id); // newest first
    // rows[i+1] is each row's predecessor; the oldest (last) diffs against ''.
    return rows.map((r, i) => toSkillVersionDto(r, rows[i + 1]?.body ?? ''));
  }

  /** A single historical body snapshot. Undefined if the skill isn't in this
   *  workspace, or that version was never recorded (route → 404 either way). */
  async getVersion(
    workspaceId: string,
    id: string,
    version: number,
  ): Promise<SkillVersionDetail | undefined> {
    const skill = await this.deps.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const rows = await this.deps.repo.listVersions(id); // newest first
    const index = rows.findIndex((r) => r.version === version);
    if (index === -1) return undefined;
    return toSkillVersionDetailDto(rows[index]!, rows[index + 1]?.body ?? '');
  }

  /**
   * Restore a historical body by writing it as a NEW version — history stays
   * append-only (the immutable-snapshot promise the Versions tab makes), and
   * `skills.version` never moves backwards. Restoring the CURRENT version is a
   * genuine no-op: `update()` only versions on an actual body change, so this
   * returns the unchanged skill with no new snapshot.
   */
  async restoreVersion(
    workspaceId: string,
    id: string,
    version: number,
    note?: string | null,
  ): Promise<Skill | undefined> {
    const skill = await this.deps.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const snapshot = await this.deps.repo.getVersion(id, version);
    if (!snapshot) return undefined;
    return this.update(workspaceId, id, { body: snapshot.body, note: note ?? null });
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

  /** Linked-agent count per skill, for the skills rail's "N agents" footer. */
  async statsBySkill(workspaceId: string): Promise<SkillListStats[]> {
    const [skills, counts] = await Promise.all([
      this.deps.repo.list(workspaceId),
      this.deps.repo.countsBySkill(workspaceId),
    ]);
    return mergeSkillStats(skills, counts);
  }
}
