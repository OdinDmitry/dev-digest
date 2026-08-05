import type { Container } from '../../platform/container.js';
import type { GitHubClient, Intent, PrIntentRecord, UnifiedDiff, WebFetchClient } from '@devdigest/shared';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { NotFoundError } from '../../platform/errors.js';
import { RepoRepository } from '../repos/repository.js';
import type { ReviewRepository } from '../reviews/repository.js';
import { PrIntentRepository } from './repository.js';
import {
  buildClassifierInput,
  extractReferences,
  hunkHeadersFromDiff,
  hunkHeadersFromPatches,
} from './sources.js';
import { resolveReferences } from './references.js';
import { composeCaveat, toIntentRecord } from './helpers.js';
import { RawIntent } from './schema.js';
import { CLASSIFIER_SCHEMA_NAME, CLASSIFIER_SYSTEM_PROMPT } from './constants.js';

/**
 * Intent service — derives a PR's intent/scope with one cheap, separate LLM
 * call, persisted per PR (`pr_intent`). Mirrors `ConventionsService`'s
 * documented onion-architecture concession: constructor takes
 * `(container, deps)` because `resolveFeatureModel(container, …)` and
 * `container.llm(provider)` need the container; everything else the service
 * actually touches comes through `deps`.
 */

export interface IntentServiceDeps {
  intents: PrIntentRepository;
  repos: RepoRepository;
  /** PR + pr_files lookup — the same repository the reviews module already owns. */
  pulls: Pick<ReviewRepository, 'getPull' | 'getRepo' | 'getPrFiles'>;
  webfetch: WebFetchClient;
}

/** Minimal pino-compatible logger — the one place the intent call's
 *  observability line (§7) is emitted from. */
export type Logger = { info: (obj: unknown, msg?: string) => void };

export interface ComputeOpts {
  /** Already-loaded diff (review path) — skips a second `pr_files` read. */
  diff?: UnifiedDiff;
  logger?: Logger;
}

export class IntentService {
  constructor(
    private container: Container,
    private deps: IntentServiceDeps,
  ) {}

  /** Pure read — no LLM. `null` when nothing has been computed yet. */
  async get(workspaceId: string, prId: string): Promise<PrIntentRecord | null> {
    await this.requirePull(workspaceId, prId);
    const intent = await this.deps.intents.getByPrId(prId);
    return intent ? toIntentRecord(intent, prId) : null;
  }

  /**
   * Compute-if-absent: re-reads the persisted row first (inside this call,
   * before spending a token) and returns it if present; otherwise computes
   * and persists. A double-fire costs at most one wasted call — the upsert
   * is `onConflictDoUpdate` on the `pr_id` PK, never a duplicate row.
   */
  async ensure(workspaceId: string, prId: string, opts: ComputeOpts = {}): Promise<PrIntentRecord> {
    await this.requirePull(workspaceId, prId);
    const existing = await this.deps.intents.getByPrId(prId);
    if (existing) return toIntentRecord(existing, prId);
    return this.computeAndPersist(workspaceId, prId, opts);
  }

  /** Always recomputes + upserts, regardless of any persisted row. */
  async recompute(workspaceId: string, prId: string, opts: ComputeOpts = {}): Promise<PrIntentRecord> {
    return this.computeAndPersist(workspaceId, prId, opts);
  }

  private async requirePull(workspaceId: string, prId: string) {
    const pull = await this.deps.pulls.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    return pull;
  }

  private async computeAndPersist(
    workspaceId: string,
    prId: string,
    opts: ComputeOpts,
  ): Promise<PrIntentRecord> {
    const pull = await this.requirePull(workspaceId, prId);
    const repoRow = await this.deps.repos.getById(workspaceId, pull.repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');

    // GitHub is optional here: no configured token degrades a linked-issue ref
    // to a MissingRef rather than failing the whole classification.
    let github: Pick<GitHubClient, 'getIssue'>;
    try {
      github = await this.container.github();
    } catch (err) {
      const message = (err as Error).message;
      github = {
        getIssue: async () => {
          throw new Error(message);
        },
      };
    }

    const extracted = extractReferences(pull.body);
    const { resolved, missing } = await resolveReferences(
      { owner: repoRow.owner, name: repoRow.name },
      extracted,
      repoRow.clonePath,
      { github, webfetch: this.deps.webfetch },
    );

    const fileHeaders = opts.diff
      ? hunkHeadersFromDiff(opts.diff)
      : hunkHeadersFromPatches(await this.deps.pulls.getPrFiles(prId));

    const { userMessage, sources } = buildClassifierInput({
      title: pull.title,
      body: pull.body,
      fileHeaders,
      resolved,
      missing,
    });

    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'review_intent');
    const llm = await this.container.llm(provider);
    const estTokens = this.container.tokenizer.count(userMessage);

    const t0 = Date.now();
    const result = await llm.completeStructured({
      model,
      schema: RawIntent,
      schemaName: CLASSIFIER_SCHEMA_NAME,
      temperature: 0.1,
      maxRetries: 2,
      messages: [
        { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    });
    const durationMs = Date.now() - t0;

    const lowConfidence = !pull.body || pull.body.trim().length === 0;
    const intent: Intent = {
      intent: composeCaveat(result.data.intent, { lowConfidence, missingRefs: missing }),
      in_scope: result.data.in_scope,
      out_of_scope: result.data.out_of_scope,
    };

    await this.deps.intents.upsert({
      prId,
      intent: intent.intent,
      inScope: intent.in_scope,
      outOfScope: intent.out_of_scope,
    });

    // The ONE observability line for this call — never a secret, never diff/
    // body content, only deterministic paths/urls/counts/sizes (§7).
    opts.logger?.info(
      {
        prId,
        feature: 'review_intent',
        provider,
        model,
        sources,
        refsResolved: resolved.length,
        refsMissing: missing.length,
        promptChars: userMessage.length,
        estTokens,
        lowConfidence,
        durationMs,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costUsd: result.costUsd,
      },
      'intent: classified PR intent',
    );

    return toIntentRecord(intent, prId);
  }
}
