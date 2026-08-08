/**
 * blast/service.ts — "what else might this diff touch?" over the existing
 * repo-intel Postgres index. No ORM imports, no table-schema imports, no DI
 * container — explicit deps only (`onion-architecture`). All graph
 * traversal and SQL live in `repo-intel` (facade + repository); this module
 * owns HTTP shaping and workspace scoping, nothing else (constraint 2).
 */
import { NotFoundError } from '../../platform/errors.js';
import type { PrBlastRadius } from '@devdigest/shared';
import type { ReviewRepository } from '../reviews/repository.js';
import type { RepoIntel } from '../repo-intel/types.js';
import { toPrBlastRadius } from './helpers.js';
import { DEFAULT_DEGRADED_REASON, PARTIAL_INDEX_REASON } from './constants.js';

/**
 * Explicit dependency interface, never the raw DI container (constraint 4 —
 * the four grandfathered container-taking services are a closed set; this is
 * a new module). `reviews` is narrowed to exactly the two reads this service
 * makes.
 */
export interface BlastServiceDeps {
  reviews: Pick<ReviewRepository, 'pullRepoId' | 'prFileSummaries'>;
  repoIntel: RepoIntel;
}

export class BlastService {
  constructor(private deps: BlastServiceDeps) {}

  /**
   * Fixed algorithm (§3 of the plan — do not re-derive):
   *  1. Workspace-scoped `repoId` lookup FIRST and unconditionally — no
   *     branch below can be reached without it succeeding (§9 / A01 IDOR).
   *  2. Empty diff -> `state: 'ok'`, empty arrays. Not a degradation.
   *  3. Gate on `getIndexState()` BEFORE ever calling `getBlastRadius` — a
   *     degraded/failed index returns `state: 'degraded'` WITHOUT calling
   *     `getBlastRadius` at all, because that method falls through to a
   *     live-clone ripgrep/AST scan for the unindexed case, which would
   *     rebuild the AST/import graph during the request. Gating first makes
   *     that fallback structurally unreachable from this route.
   *  4. Otherwise call `getBlastRadius`; a belt-and-braces `degraded: true`
   *     on the result still maps to `state: 'degraded'`.
   *  5. `partial` index status -> `state: 'partial'` WITH results present.
   */
  async get(workspaceId: string, prId: string): Promise<PrBlastRadius> {
    const repoId = await this.deps.reviews.pullRepoId(workspaceId, prId);
    if (repoId === null) throw new NotFoundError('Pull request not found');

    const files = await this.deps.reviews.prFileSummaries(prId);
    const changedFiles = files.map((f) => f.path);

    if (changedFiles.length === 0) {
      return toPrBlastRadius({
        prId,
        repoId,
        state: 'ok',
        reason: null,
        changedFiles,
        blast: null,
      });
    }

    const indexState = await this.deps.repoIntel.getIndexState(repoId);
    if (
      indexState.status === 'degraded' ||
      indexState.status === 'failed' ||
      indexState.degraded === true
    ) {
      return toPrBlastRadius({
        prId,
        repoId,
        state: 'degraded',
        reason: indexState.degradedReason ?? indexState.status,
        changedFiles,
        blast: null,
      });
    }

    const blast = await this.deps.repoIntel.getBlastRadius(repoId, changedFiles);
    if (blast.degraded) {
      return toPrBlastRadius({
        prId,
        repoId,
        state: 'degraded',
        reason: blast.reason ?? DEFAULT_DEGRADED_REASON,
        changedFiles,
        blast,
      });
    }

    const state = indexState.status === 'partial' ? 'partial' : 'ok';
    const reason = state === 'partial' ? PARTIAL_INDEX_REASON : null;
    return toPrBlastRadius({ prId, repoId, state, reason, changedFiles, blast });
  }
}
