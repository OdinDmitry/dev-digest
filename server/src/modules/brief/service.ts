import type { Container } from '../../platform/container.js';
import type { BriefEnvelope, GitHubClient, PrRunSummary, WebFetchClient } from '@devdigest/shared';
import { generateBrief } from '@devdigest/reviewer-core';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { NotFoundError } from '../../platform/errors.js';
import { RepoRepository } from '../repos/repository.js';
import type { ReviewRepository } from '../reviews/repository.js';
import type { IntentService } from '../intent/service.js';
import type { BlastService } from '../blast/service.js';
import type { ContextService } from '../context/service.js';
import { extractReferences } from '../intent/sources.js';
import { resolveReferences } from '../intent/references.js';
import { BriefRepository } from './repository.js';
import { assembleBriefInput, type BriefInputDocument } from './input.js';
import { blastSummaryLine, changeStats, endpointSet, toBriefEnvelope } from './helpers.js';
import { BRIEF_FEATURE_MODEL, BRIEF_SCHEMA_NAME } from './constants.js';

/**
 * Brief service — follows `IntentService`'s documented onion-architecture
 * concession: constructor takes `(container, deps)` because
 * `resolveFeatureModel(container, …)` and `container.llm(provider)` both
 * need the container; everything else arrives through `deps`.
 *
 * Constraint 8 (`server/insights.md` 2026-08-05, the `IntentService.ensure()`
 * cross-workspace leak): `requirePull(workspaceId, prId)` is the FIRST
 * statement of EVERY public method here, including the pure read and the
 * run-summary read — no branch is allowed to skip it.
 */

export interface BriefServiceDeps {
  briefs: BriefRepository;
  intent: Pick<IntentService, 'get'>;
  blast: Pick<BlastService, 'get'>;
  context: Pick<ContextService, 'assembleForRepo'>;
  repos: RepoRepository;
  pulls: Pick<ReviewRepository, 'getPull' | 'prFileSummaries'>;
  webfetch: WebFetchClient;
}

export type Logger = { info: (obj: unknown, msg?: string) => void };

export interface BriefOpts {
  logger?: Logger;
}

/** Deterministic AC-2 fallback `what`, built from the change statistics —
 *  never the model's own words, so it can never restate the title. */
function buildFallbackWhat(stats: ReturnType<typeof changeStats>, title: string): string {
  const top = stats.shown[0];
  return top
    ? `This change primarily modifies \`${top.path}\` (+${top.additions}/-${top.deletions}), among ${stats.shown.length + stats.notListed} changed file(s).`
    : `This change (PR: ${title}) touches no files with recorded statistics.`;
}

export class BriefService {
  constructor(
    private container: Container,
    private deps: BriefServiceDeps,
  ) {}

  /** Pure read — no LLM, no branch that skips `requirePull`. `absent` when
   *  nothing is stored for the PR's CURRENT head commit. */
  async get(workspaceId: string, prId: string): Promise<BriefEnvelope> {
    const pull = await this.requirePull(workspaceId, prId);
    const record = await this.deps.briefs.getForHead(prId, pull.headSha);
    return toBriefEnvelope(record);
  }

  /** Generate-if-absent-for-this-head-SHA: re-reads first, returns the
   *  stored brief unchanged if present, else generates exactly once. */
  async ensure(workspaceId: string, prId: string, opts: BriefOpts = {}): Promise<BriefEnvelope> {
    const pull = await this.requirePull(workspaceId, prId);
    const existing = await this.deps.briefs.getForHead(prId, pull.headSha);
    if (existing) return toBriefEnvelope(existing);
    return this.generate(workspaceId, prId, opts);
  }

  /** Always one new generation, replacing the whole stored brief. */
  async regenerate(workspaceId: string, prId: string, opts: BriefOpts = {}): Promise<BriefEnvelope> {
    await this.requirePull(workspaceId, prId);
    return this.generate(workspaceId, prId, opts);
  }

  /**
   * Scopes `GET /pulls/:id/run-summary` — `BriefRepository.runSummary` takes
   * no `workspaceId` and ring 4 may not reach the repository directly, so
   * THIS method's `requirePull` call is the only thing standing between a
   * request and another workspace's verdict/score (Constraint 8).
   */
  async runSummary(workspaceId: string, prId: string): Promise<PrRunSummary | null> {
    await this.requirePull(workspaceId, prId);
    return this.deps.briefs.runSummary(prId);
  }

  private async requirePull(workspaceId: string, prId: string) {
    const pull = await this.deps.pulls.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    return pull;
  }

  private async generate(
    workspaceId: string,
    prId: string,
    opts: BriefOpts,
  ): Promise<BriefEnvelope> {
    const pull = await this.requirePull(workspaceId, prId);

    // Read-only — NEVER `ensure`, so a brief generation can never itself
    // trigger an intent model call. Reachable on the ordinary first open of a
    // PR: IntentCard and BriefCard both auto-start from their own mount, so
    // on a PR with no persisted intent yet, this can legitimately be `null`
    // mid-flight. Stop before assembling anything — no model call, no stored
    // row; the NEXT open (by then intent exists) generates normally.
    const intent = await this.deps.intent.get(workspaceId, prId);
    if (!intent) {
      return { status: 'unavailable', brief: null, reason: 'intent_absent' };
    }

    const blast = await this.deps.blast.get(workspaceId, prId);
    const files = await this.deps.pulls.prFileSummaries(prId);
    const stats = changeStats(files);

    const repoRow = await this.deps.repos.getById(workspaceId, pull.repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');

    // GitHub is optional here, mirroring `IntentService.computeAndPersist`:
    // no configured token degrades a linked-issue ref to a MissingRef rather
    // than failing the whole generation.
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

    // The referenced issue only — over PR title + body text (never the diff/
    // file headers the intent module also considers). `resolveReferences`
    // never throws (every failure becomes a `MissingRef`); doc-path/URL
    // references it also resolves are discarded here — the brief's input
    // only has a slot for ONE issue reference, not arbitrary doc/url refs.
    const extracted = extractReferences(`${pull.title}\n\n${pull.body ?? ''}`);
    const { resolved } = await resolveReferences(
      { owner: repoRow.owner, name: repoRow.name },
      extracted,
      repoRow.clonePath,
      { github, webfetch: this.deps.webfetch },
    );
    const issueText = resolved.find((r) => r.kind === 'issue')?.text ?? null;

    const documents = await this.deps.context.assembleForRepo(workspaceId, pull.repoId);
    const attachedDocuments: BriefInputDocument[] = documents.map((d) => ({
      path: d.path,
      text: d.text,
    }));

    const assembled = assembleBriefInput(
      {
        title: pull.title,
        intentText: intent.intent,
        blastSummaryLine: blastSummaryLine(blast),
        changeStats: stats,
        endpoints: [...endpointSet(blast)],
        documents: attachedDocuments,
        issueText,
        body: pull.body ?? null,
        fallbackWhat: buildFallbackWhat(stats, pull.title),
      },
      this.container.tokenizer,
    );

    if (assembled.overBudget) {
      return { status: 'unavailable', brief: null, reason: 'input_budget' };
    }

    const { provider, model } = await resolveFeatureModel(
      this.container,
      workspaceId,
      BRIEF_FEATURE_MODEL,
    );
    const llm = await this.container.llm(provider);

    const t0 = Date.now();
    const outcome = await generateBrief({ llm, model, input: assembled });
    const durationMs = Date.now() - t0;

    const record = await this.deps.briefs.upsert(prId, pull.headSha, outcome.doc);

    opts.logger?.info(
      {
        prId,
        feature: BRIEF_FEATURE_MODEL,
        schemaName: BRIEF_SCHEMA_NAME,
        provider,
        model,
        durationMs,
        riskLevel: outcome.doc.risk_level,
        risks: outcome.doc.risks.length,
        reviewFocus: outcome.doc.review_focus.length,
      },
      'brief: generated PR brief',
    );

    return { status: 'ready', brief: record, reason: null };
  }
}
