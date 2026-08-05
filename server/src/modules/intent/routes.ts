import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { IntentService } from './service.js';
import { PrIntentRepository } from './repository.js';
import { RepoRepository } from '../repos/repository.js';
import { ReviewRepository } from '../reviews/repository.js';

/**
 * intent module (course lesson L03) — derives a PR's intent/scope with one
 * cheap, separate LLM call before review.
 *   GET  /pulls/:id/intent            → PrIntentRecord | null (pure read, no LLM)
 *   POST /pulls/:id/intent            → PrIntentRecord (compute if absent, else return existing)
 *   POST /pulls/:id/intent/recompute  → PrIntentRecord (always recompute + upsert)
 *
 * Ring 4 only: parse params → delegate to the service → return its DTO. No
 * Drizzle, no business logic here.
 */
export default async function intentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new IntentService(container, {
    intents: new PrIntentRepository(container.db),
    repos: new RepoRepository(container.db),
    pulls: new ReviewRepository(container.db),
    webfetch: container.webfetch,
  });

  app.get('/pulls/:id/intent', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.get(workspaceId, req.params.id);
  });

  // Rate-limited: each call can compute a fresh LLM call and spend money
  // (same reasoning as POST /pulls/:id/review, modules/reviews/routes.ts:29).
  app.post(
    '/pulls/:id/intent',
    { schema: { params: IdParams }, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.ensure(workspaceId, req.params.id, { logger: req.log });
    },
  );

  app.post(
    '/pulls/:id/intent/recompute',
    { schema: { params: IdParams }, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.recompute(workspaceId, req.params.id, { logger: req.log });
    },
  );
}
