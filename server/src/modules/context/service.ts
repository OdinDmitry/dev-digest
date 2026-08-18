import PQueue from 'p-queue';
import type {
  AssembledContextEntry,
  AssembledRunContext,
  ContextAttachment,
  ContextAttachmentInput,
  ContextAttachmentSet,
  ContextDocument,
  ContextDocumentText,
  ContextExclusion,
  ContextListing,
  ContextOwnerKind,
} from '@devdigest/shared';
import type { Tokenizer } from '../../adapters/tokenizer/index.js';
import type { AgentsRepository } from '../agents/repository.js';
import type { RepoRepository, RepoRow } from '../repos/repository.js';
import { NotFoundError } from '../../platform/errors.js';
import { PROJECT_CONTEXT_TOKEN_BUDGET, READ_CONCURRENCY, TOKEN_CACHE_MAX } from './constants.js';
import { applyBudget, assembleEntries, folderOf, usageCounts } from './helpers.js';
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

  /**
   * Resolve one agent's project context for one run against `prRepoId` (the
   * PR's repo): start from the assembled entries (skill-inherited first, own
   * second, de-duplicated — `assembleForAgent`), exclude anything from a
   * different repo (`other_repo`), read every remaining document's full text
   * from that repo's working copy and exclude what comes back absent
   * (`absent`), then apply the token budget (`over_budget`). The returned
   * `excluded` list follows the assembled order throughout, regardless of
   * which stage excluded an entry.
   */
  async assembleForRun(
    workspaceId: string,
    agentId: string,
    prRepoId: string,
  ): Promise<AssembledRunContext> {
    const entries = await this.assembleForAgent(workspaceId, agentId);
    const repo = await this.requireRepo(workspaceId, prRepoId);
    const root = repo.clonePath;

    type Staged =
      | { path: string; kind: 'present'; text: string }
      | { path: string; kind: 'excluded'; reason: ContextExclusion['reason'] };

    const staged: Staged[] = [];
    for (const entry of entries) {
      if (entry.repo_id !== prRepoId) {
        staged.push({ path: entry.path, kind: 'excluded', reason: 'other_repo' });
        continue;
      }
      const text = root ? await readDocument(root, entry.path) : null;
      if (text == null) {
        staged.push({ path: entry.path, kind: 'excluded', reason: 'absent' });
      } else {
        staged.push({ path: entry.path, kind: 'present', text });
      }
    }

    // Budget applies only over the survivors so far, in assembled order.
    const survivors = staged
      .filter((s): s is Extract<Staged, { kind: 'present' }> => s.kind === 'present')
      .map((s) => ({ path: s.path, text: s.text, tokens: this.deps.tokenizer.count(s.text) }));
    const { excluded: overBudgetExclusions } = applyBudget(survivors, PROJECT_CONTEXT_TOKEN_BUDGET);
    const overBudgetPaths = new Set(overBudgetExclusions.map((e) => e.path));

    // Merge back, preserving the assembled order across every exclusion reason.
    const documents: { path: string; text: string }[] = [];
    const excluded: ContextExclusion[] = [];
    for (const s of staged) {
      if (s.kind === 'excluded') {
        excluded.push({ path: s.path, reason: s.reason });
      } else if (overBudgetPaths.has(s.path)) {
        excluded.push({ path: s.path, reason: 'over_budget' });
      } else {
        documents.push({ path: s.path, text: s.text });
      }
    }

    return { documents, excluded };
  }

  /**
   * The brief's (SPEC-02) project-context input: the union of what the
   * WORKSPACE'S ENABLED AGENTS carry for this repo — directly and through
   * their skills — not every attachment row in the workspace. Lists enabled
   * agents (`agents.listEnabled`), orders them `name ASC, id ASC` (a second,
   * unique tiebreaker — an unordered/non-unique sort returns a different row
   * order per query, `server/insights.md` 2026-08-04), and for EACH calls the
   * EXISTING `assembleForAgent` (never modified — it is shared with the
   * shipped SPEC-01 run-injection path; changing it here would change that
   * behaviour too). Concatenates in agent order, de-duplicates by path
   * (keeping the first occurrence), drops entries from a different repo, then
   * reads each survivor's full text and skips anything that comes back
   * `null`. Adds no new scanner, no new cache, no new repository query.
   *
   * Two consequences are DELIBERATE, not bugs: a document attached only to a
   * skill no agent uses is unreachable here (SPEC-01 line 318 — usage count
   * zero, never injected into any run, so never into a brief either); a
   * DISABLED agent's attachments are excluded, even though SPEC-01's usage
   * count deliberately counts disabled owners — that count answers "who
   * carries this document", the brief asks "what context reviews this PR".
   */
  async assembleForRepo(workspaceId: string, repoId: string): Promise<{ path: string; text: string }[]> {
    const repo = await this.requireRepo(workspaceId, repoId);
    const agents = await this.deps.agents.listEnabled(workspaceId);
    const ordered = [...agents].sort((a, b) => {
      if (a.name !== b.name) return a.name < b.name ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    const seen = new Set<string>();
    const survivors: { path: string; repo_id: string }[] = [];
    for (const agent of ordered) {
      const entries = await this.assembleForAgent(workspaceId, agent.id);
      for (const entry of entries) {
        if (seen.has(entry.path)) continue;
        seen.add(entry.path);
        survivors.push({ path: entry.path, repo_id: entry.repo_id });
      }
    }

    const root = repo.clonePath;
    const documents: { path: string; text: string }[] = [];
    for (const s of survivors) {
      if (s.repo_id !== repoId) continue;
      const text = root ? await readDocument(root, s.path) : null;
      if (text == null) continue;
      documents.push({ path: s.path, text });
    }
    return documents;
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
