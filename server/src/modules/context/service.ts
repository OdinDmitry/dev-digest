import PQueue from 'p-queue';
import type {
  AssembledContextEntry,
  ContextAttachment,
  ContextAttachmentInput,
  ContextAttachmentSet,
  ContextDocument,
  ContextDocumentText,
  ContextListing,
  ContextOwnerKind,
} from '@devdigest/shared';
import type { Tokenizer } from '../../adapters/tokenizer/index.js';
import type { AgentsRepository } from '../agents/repository.js';
import type { RepoRepository, RepoRow } from '../repos/repository.js';
import { NotFoundError } from '../../platform/errors.js';
import { PROJECT_CONTEXT_TOKEN_BUDGET, READ_CONCURRENCY, TOKEN_CACHE_MAX } from './constants.js';
import { assembleEntries, folderOf, usageCounts } from './helpers.js';
import type { ContextRepository } from './repository.js';
import { listMarkdown, readDocument } from './scan.js';

/**
 * modules/context/service.ts — ring-2 use cases for Project Context. Takes
 * EXPLICIT deps (onion-architecture rule for new services), never `Container`
 * — the four grandfathered Container-taking services elsewhere are not a
 * precedent to copy. No fastify import, no ORM import, no filesystem import
 * here — all fs access goes through scan.ts.
 */
export interface ContextServiceDeps {
  repo: ContextRepository;
  agents: AgentsRepository;
  tokenizer: Tokenizer;
  cloneDir: string;
  repos: RepoRepository;
}

export class ContextService {
  /**
   * Token-count memo, keyed `${repoId}:${path}:${sizeBytes}:${mtimeMs}` so a
   * content change invalidates itself. Bounded at TOKEN_CACHE_MAX (evict
   * oldest — Map preserves insertion order). The service is constructed once
   * per Fastify plugin registration, so the cache lives for the app's
   * lifetime. Populated on the listDocuments hot path, where stat metadata
   * (size/mtime) is available from the walk; getDocumentText/
   * getOwnerAttachments count directly (bounded by attachment count, not the
   * 2,000-file NFR).
   */
  private tokenCache = new Map<string, number>();

  constructor(private deps: ContextServiceDeps) {}

  async listDocuments(workspaceId: string, repoId: string): Promise<ContextListing> {
    const repo = await this.requireRepo(workspaceId, repoId);
    if (repo.clonePath == null) {
      // AC-4 — the client must not show the empty-set message for this.
      return {
        documents: [],
        document_count: 0,
        total_tokens: 0,
        partial: false,
        not_listed: 0,
        last_synced_at: null,
        synced: false,
      };
    }
    const root = repo.clonePath;

    const { files, notListed } = await listMarkdown(root);

    const [directPairs, viaSkillPairs] = await Promise.all([
      this.deps.repo.attachmentAgentPairsForRepo(workspaceId, repoId),
      this.deps.repo.attachmentAgentPairsViaSkillsForRepo(workspaceId, repoId),
    ]);
    const usage = usageCounts([directPairs, viaSkillPairs]);

    const queue = new PQueue({ concurrency: READ_CONCURRENCY });
    const documents: ContextDocument[] = [];
    await Promise.all(
      files.map((file) =>
        queue.add(async () => {
          const text = await readDocument(root, file.path);
          if (text == null) return; // not readable — excluded from the discoverable set
          const tokenCount = this.countTokens(repoId, file.path, file.sizeBytes, file.mtimeMs, text);
          documents.push({
            path: file.path,
            folder: folderOf(file.path),
            size_bytes: file.sizeBytes,
            token_count: tokenCount,
            usage_count: usage.get(file.path) ?? 0,
          });
        }),
      ),
    );
    documents.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    return {
      documents,
      document_count: documents.length,
      total_tokens: documents.reduce((sum, d) => sum + d.token_count, 0),
      partial: notListed > 0,
      not_listed: notListed,
      last_synced_at: repo.lastPolledAt ? repo.lastPolledAt.toISOString() : null,
      synced: true,
    };
  }

  async getDocumentText(
    workspaceId: string,
    repoId: string,
    path: string,
  ): Promise<ContextDocumentText> {
    const repo = await this.requireRepo(workspaceId, repoId);
    const text = repo.clonePath ? await readDocument(repo.clonePath, path) : null;
    if (text == null) throw new NotFoundError('Document not found');
    return { path, text };
  }

  async getOwnerAttachments(
    workspaceId: string,
    kind: ContextOwnerKind,
    ownerId: string,
  ): Promise<ContextAttachmentSet> {
    const rows = await this.deps.repo.listForOwner(workspaceId, kind, ownerId);

    const repoIds = [...new Set(rows.map((r) => r.repoId))];
    const repoPairs = await Promise.all(
      repoIds.map(async (id): Promise<[string, RepoRow | undefined]> => [
        id,
        await this.deps.repos.getById(workspaceId, id),
      ]),
    );
    const reposById = new Map(repoPairs);

    const attachments: ContextAttachment[] = await Promise.all(
      rows.map(async (row): Promise<ContextAttachment> => {
        const repoRow = reposById.get(row.repoId);
        const text = repoRow?.clonePath ? await readDocument(repoRow.clonePath, row.path) : null;
        return {
          owner_kind: kind,
          owner_id: ownerId,
          repo_id: row.repoId,
          path: row.path,
          order: row.order,
          missing: text == null,
          token_count: text == null ? 0 : this.deps.tokenizer.count(text),
        };
      }),
    );

    const totalTokens = attachments.reduce((sum, a) => sum + a.token_count, 0);
    return {
      attachments,
      total_tokens: totalTokens,
      budget: PROJECT_CONTEXT_TOKEN_BUDGET,
      over_budget: totalTokens > PROJECT_CONTEXT_TOKEN_BUDGET,
    };
  }

  async setOwnerAttachments(
    workspaceId: string,
    kind: ContextOwnerKind,
    ownerId: string,
    input: ContextAttachmentInput,
  ): Promise<ContextAttachmentSet> {
    // Agent ownership is verifiable here (deps.agents); skill ownership is
    // verified by the route handler before this is called (ContextService
    // deliberately carries no SkillsRepository dep — see routes.ts).
    if (kind === 'agent') {
      const agent = await this.deps.agents.getById(workspaceId, ownerId);
      if (!agent) throw new NotFoundError('Agent not found');
    }
    const repo = await this.requireRepo(workspaceId, input.repo_id);
    await this.deps.repo.replaceForOwner(workspaceId, kind, ownerId, repo.id, input.paths);
    return this.getOwnerAttachments(workspaceId, kind, ownerId);
  }

  async assembleForAgent(workspaceId: string, agentId: string): Promise<AssembledContextEntry[]> {
    const agent = await this.deps.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    const { skillGroups, ownEntries } = await this.deps.repo.listForAgentAndItsSkills(
      workspaceId,
      agentId,
    );
    return assembleEntries(skillGroups, ownEntries);
  }

  private async requireRepo(workspaceId: string, repoId: string): Promise<RepoRow> {
    const repo = await this.deps.repos.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return repo;
  }

  private countTokens(
    repoId: string,
    path: string,
    sizeBytes: number,
    mtimeMs: number,
    text: string,
  ): number {
    const key = `${repoId}:${path}:${sizeBytes}:${mtimeMs}`;
    const cached = this.tokenCache.get(key);
    if (cached !== undefined) return cached;

    const count = this.deps.tokenizer.count(text);
    if (this.tokenCache.size >= TOKEN_CACHE_MAX) {
      const oldest = this.tokenCache.keys().next().value;
      if (oldest !== undefined) this.tokenCache.delete(oldest);
    }
    this.tokenCache.set(key, count);
    return count;
  }
}
