import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { PrBlastRadius } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastService } from './service.js';
import { ReviewRepository } from '../reviews/repository.js';

/**
 * blast module (L04) — "what else might this diff touch?": which symbols are
 * declared in the PR's changed files, who imports/calls those symbols, and
 * which HTTP endpoints are reachable through the import graph. A pure read
 * over the existing repo-intel Postgres index — no LLM, no AST/ripgrep scan
 * on this path.
 *
 *   GET /pulls/:id/blast -> PrBlastRadius
 *
 * Ring 4 only: parse params -> `getContext` -> delegate to the service ->
 * return its DTO. No Drizzle, no business logic here (`smart-diff/routes.ts`
 * is the reference shape this mirrors).
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new BlastService({
    reviews: new ReviewRepository(container.db),
    repoIntel: container.repoIntel,
  });

  // No rate limit of its own: pure read, cannot spend money (global limiter
  // applies) — same reasoning as smart-diff/repo-intel. No `response` zod
  // schema either (constraint 7): the handler's TS return type is the
  // contract itself.
  app.get(
    '/pulls/:id/blast',
    { schema: { params: IdParams } },
    async (req): Promise<PrBlastRadius> => {
      const { workspaceId } = await getContext(container, req);
      return service.get(workspaceId, req.params.id);
    },
  );
}
