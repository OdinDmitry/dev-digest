import type { Container } from '../../platform/container.js';
import type {
  ConventionCandidate,
  ConventionExtractResult,
  ConventionMergePreview,
  ConventionStatus,
} from '@devdigest/shared';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { RepoRepository, type RepoRow } from '../repos/repository.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { ConventionsRepository, type InsertConvention } from './repository.js';
import { buildConventionSamples } from './samples.js';
import { verifyEvidence } from './grounding.js';
import { toConventionDto, buildMergeBody, defaultMergeName, defaultMergeDescription } from './helpers.js';
import { RawConventionExtraction } from './schema.js';
import { EXTRACTION_SCHEMA_NAME, EXTRACTION_SYSTEM_PROMPT, MAX_CANDIDATES } from './constants.js';

/**
 * Conventions service — repo-scoped extraction of candidate coding
 * conventions, reviewed by the user, then merged into a Skill.
 *
 * Extraction is a single synchronous `completeStructured` call over
 * code-selected samples (no LLM file-selection step, no async run-executor/
 * SSE machinery — this is one cheap-model call, not a multi-agent review).
 */

export interface ConventionsServiceDeps {
  conventions: ConventionsRepository;
  repos: RepoRepository;
}

export interface ConventionUpdateInput {
  rule?: string;
  category?: string | null;
  status?: ConventionStatus;
}

export class ConventionsService {
  constructor(
    private container: Container,
    private deps: ConventionsServiceDeps,
  ) {}

  async list(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    await this.requireRepo(workspaceId, repoId);
    const rows = await this.deps.conventions.listByRepo(workspaceId, repoId);
    return rows.map(toConventionDto);
  }

  /**
   * Run (or re-run) extraction for a repo. Re-scan semantics: existing
   * `pending` rows are replaced by the fresh result; `accepted`/`rejected`
   * rows (real user decisions) are left untouched. Candidates whose evidence
   * fails the grounding check are silently dropped — never persisted, never
   * surfaced as an error.
   */
  async extract(workspaceId: string, repoId: string): Promise<ConventionExtractResult> {
    const repo = await this.requireRepo(workspaceId, repoId);
    if (!repo.clonePath) {
      throw new ValidationError('Repo is not cloned yet — wait for it to finish indexing');
    }

    const samples = await buildConventionSamples(this.container, repo);
    if (samples.scannedFiles.length === 0) {
      // Nothing readable to sample — clear stale pending candidates rather
      // than leaving them to imply a scan that never actually ran.
      await this.deps.conventions.deletePendingForRepo(workspaceId, repoId);
      return { candidates: [], scanned_files: [] };
    }

    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'conventions');
    const llm = await this.container.llm(provider);

    const result = await llm.completeStructured({
      model,
      schema: RawConventionExtraction,
      schemaName: EXTRACTION_SCHEMA_NAME,
      temperature: 0.2,
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: samples.text },
      ],
    });

    const scannedSha = await this.container.git
      .currentHead({ owner: repo.owner, name: repo.name })
      .catch(() => null);

    const verified: InsertConvention[] = [];
    for (const candidate of result.data.candidates.slice(0, MAX_CANDIDATES)) {
      const ok = await verifyEvidence(repo.clonePath, candidate.evidence);
      if (!ok) continue;
      verified.push({
        workspaceId,
        repoId,
        category: candidate.category,
        rule: candidate.rule,
        evidencePath: candidate.evidence.file,
        evidenceStartLine: candidate.evidence.start_line,
        evidenceEndLine: candidate.evidence.end_line,
        evidenceSnippet: candidate.evidence.snippet,
        confidence: candidate.confidence,
        scannedSha,
      });
    }

    // Only clear the old pending set once the new one is ready to replace it —
    // an LLM/grounding failure above throws before reaching here, so a failed
    // re-scan never wipes out a prior successful one.
    await this.deps.conventions.deletePendingForRepo(workspaceId, repoId);
    const rows = await this.deps.conventions.insertMany(verified);
    return { candidates: rows.map(toConventionDto), scanned_files: samples.scannedFiles };
  }

  async update(
    workspaceId: string,
    id: string,
    patch: ConventionUpdateInput,
  ): Promise<ConventionCandidate | undefined> {
    const row = await this.deps.conventions.update(workspaceId, id, patch);
    return row ? toConventionDto(row) : undefined;
  }

  /** Permanently remove one candidate (any status) — the user's manual "clear it" escape hatch. */
  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.deps.conventions.deleteById(workspaceId, id);
  }

  /**
   * Draft a skill body from the given conventions (normally the repo's
   * `accepted` set). Writes NOTHING — the client shows the draft for
   * confirmation/editing and creates the skill via the existing
   * `POST /skills` (source: 'extracted'), same "preview, don't persist" shape
   * the skill-import flow already uses.
   */
  async mergePreview(
    workspaceId: string,
    repoId: string,
    conventionIds: string[],
  ): Promise<ConventionMergePreview> {
    const repo = await this.requireRepo(workspaceId, repoId);
    const rows = await this.deps.conventions.getByIds(workspaceId, conventionIds);
    const scoped = rows.filter((r) => r.repoId === repoId);
    if (scoped.length === 0) throw new NotFoundError('No matching conventions found');

    const evidenceFiles = [...new Set(scoped.map((r) => r.evidencePath).filter((p): p is string => !!p))];
    return {
      name: defaultMergeName(repo.name),
      description: defaultMergeDescription(scoped.length, repo.fullName),
      type: 'convention',
      body: buildMergeBody(scoped),
      evidence_files: evidenceFiles,
    };
  }

  private async requireRepo(workspaceId: string, repoId: string): Promise<RepoRow> {
    const repo = await this.deps.repos.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return repo;
  }
}
