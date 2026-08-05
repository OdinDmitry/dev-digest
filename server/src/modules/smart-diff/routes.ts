import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { SmartDiffService } from './service.js';
import { ReviewRepository } from '../reviews/repository.js';

/**
 * smart-diff module (course lesson L03, second half) — deterministic,
 * no-LLM classification of a PR's already-imported `pr_files` rows into
 * core/wiring/boilerplate, with per-line finding refs and a split
 * suggestion.
 *   GET /pulls/:id/smart-diff → SmartDiff (pure read, no LLM, no GitHub)
 *
 * Ring 4 only: parse params → delegate to the service → return its DTO. No
 * Drizzle, no business logic here.
 */
export default async function smartDiffRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new SmartDiffService({ reviews: new ReviewRepository(container.db) });

  // No rate limit: this call cannot spend money (default global limiter applies).
  app.get('/pulls/:id/smart-diff', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.get(workspaceId, req.params.id);
  });
}
