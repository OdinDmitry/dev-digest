import type { SmartDiff } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import type { ReviewRepository } from '../reviews/repository.js';
import { groupFiles } from './classify.js';
import { buildSplitSuggestion } from './split.js';
import { toSmartDiffFiles } from './helpers.js';

/**
 * Explicit deps, never `Container` — this is the structural proof that
 * `SmartDiffService` cannot reach the DI container's LLM or GitHub
 * accessors: no LLM/model call and no GitHub round-trip is made anywhere
 * in this feature.
 */
export interface SmartDiffServiceDeps {
  reviews: Pick<ReviewRepository, 'pullExists' | 'prFileSummaries' | 'latestFindingLocations'>;
}

export class SmartDiffService {
  constructor(private deps: SmartDiffServiceDeps) {}

  /** Pure, deterministic read — no LLM, no GitHub, nothing persisted. */
  async get(workspaceId: string, prId: string): Promise<SmartDiff> {
    // Workspace-scoped pull lookup FIRST (constraint 5) — a PR id from
    // another workspace must never reach the queries below. Only existence
    // is needed here, so the repository never hands this service a row.
    const exists = await this.deps.reviews.pullExists(workspaceId, prId);
    if (!exists) throw new NotFoundError('Pull request not found');

    const [prFiles, findingLocations] = await Promise.all([
      this.deps.reviews.prFileSummaries(prId),
      this.deps.reviews.latestFindingLocations(prId),
    ]);

    const files = toSmartDiffFiles(prFiles, findingLocations);
    const groups = groupFiles(files);
    const split_suggestion = buildSplitSuggestion(prFiles);

    return { groups, split_suggestion };
  }
}
