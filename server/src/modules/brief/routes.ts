import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { BriefEnvelope, PrRunSummary } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BriefService } from './service.js';
import { BriefRepository } from './repository.js';
import { BRIEF_RATE_LIMIT } from './constants.js';
import { RepoRepository } from '../repos/repository.js';
import { ReviewRepository } from '../reviews/repository.js';
import { IntentService } from '../intent/service.js';
import { PrIntentRepository } from '../intent/repository.js';
import { BlastService } from '../blast/service.js';
import { ContextService } from '../context/service.js';
import { ContextRepository } from '../context/repository.js';

/**
 * brief module (SPEC-02) — a short, cached synthesis of what a PR changes and
 * why, cached against the PR's head commit SHA.
 *   GET  /pulls/:id/brief             → BriefEnvelope (pure read, zero model calls)
 *   POST /pulls/:id/brief             → BriefEnvelope (generate-if-absent-for-this-head-SHA)
 *   POST /pulls/:id/brief/regenerate  → BriefEnvelope (always one new generation)
 *   GET  /pulls/:id/run-summary       → PrRunSummary | null (no model call)
 *
 * Ring 4 only: parse params → delegate to the service → return its DTO. No
 * Drizzle, no business logic here (`modules/brief/*` is the canonical file
 * set — this module must not copy the grandfathered "query from routes.ts"
 * pattern; that list is closed).
 */
export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  const service = new BriefService(container, {
    briefs: new BriefRepository(container.db),
    intent: new IntentService(container, {
      intents: new PrIntentRepository(container.db),
      repos: new RepoRepository(container.db),
      pulls: new ReviewRepository(container.db),
      webfetch: container.webfetch,
    }),
    blast: new BlastService({
      reviews: new ReviewRepository(container.db),
      repoIntel: container.repoIntel,
    }),
    context: new ContextService({
      repo: new ContextRepository(container.db),
      agents: container.agentsRepo,
      tokenizer: container.tokenizer,
      cloneDir: container.config.cloneDir,
      repos: new RepoRepository(container.db),
    }),
    repos: new RepoRepository(container.db),
    pulls: new ReviewRepository(container.db),
    webfetch: container.webfetch,
  });

  app.get(
    '/pulls/:id/brief',
    { schema: { params: IdParams } },
    async (req): Promise<BriefEnvelope> => {
      const { workspaceId } = await getContext(container, req);
      return service.get(workspaceId, req.params.id);
    },
  );

  // Rate-limited: each call can spend money on a model call (same reasoning
  // as intent/routes.ts's POSTs). Inert under test by design — see T18/plan
  // Constraint list: `@fastify/rate-limit` is only registered when
  // `nodeEnv !== 'test'` (`app.ts`).
  app.post(
    '/pulls/:id/brief',
    { schema: { params: IdParams }, config: { rateLimit: BRIEF_RATE_LIMIT } },
    async (req): Promise<BriefEnvelope> => {
      const { workspaceId } = await getContext(container, req);
      return service.ensure(workspaceId, req.params.id, { logger: req.log });
    },
  );

  app.post(
    '/pulls/:id/brief/regenerate',
    { schema: { params: IdParams }, config: { rateLimit: BRIEF_RATE_LIMIT } },
    async (req): Promise<BriefEnvelope> => {
      const { workspaceId } = await getContext(container, req);
      return service.regenerate(workspaceId, req.params.id, { logger: req.log });
    },
  );

  app.get(
    '/pulls/:id/run-summary',
    { schema: { params: IdParams } },
    async (req): Promise<PrRunSummary | null> => {
      const { workspaceId } = await getContext(container, req);
      return service.runSummary(workspaceId, req.params.id);
    },
  );
}
