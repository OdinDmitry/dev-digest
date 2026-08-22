import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { EvalCaseInput, EvalCaseUpdate, EvalExpectation } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { RepoRepository } from '../repos/repository.js';
import { EvalRepository } from './repository/index.js';
import { EvalService } from './service.js';

/** Body for `POST /findings/:id/eval-case` — `owner_id`/`repo_id` are NOT
 *  accepted; both are derived server-side from the finding's own review/pull
 *  (AC-5, AC-46 / security A08). */
const CreateEvalCaseFromFindingBody = z.object({
  name: z.string().min(1),
  input_diff: z.string().min(1).optional(),
  expectations: z.array(EvalExpectation).optional(),
  notes: z.string().nullish(),
});

/**
 * modules/evals/routes.ts — eval-case CRUD + the finding seed/create routes
 * (this phase only; suite runs are Phase B).
 *   GET    /agents/:id/eval-cases
 *   POST   /agents/:id/eval-cases         (AC-47)
 *   PUT    /eval-cases/:id                (AC-8, AC-9)
 *   DELETE /eval-cases/:id
 *   GET    /findings/:id/eval-case-seed   (AC-3, AC-4)
 *   POST   /findings/:id/eval-case        (AC-5, AC-46)
 *
 * No route here declares `config.rateLimit` — the spec forbids a
 * feature-specific rate limit.
 */
export default async function evalsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new EvalService({
    repo: new EvalRepository(container.db),
    agents: container.agentsRepo,
    repos: new RepoRepository(container.db),
    reviews: container.reviewRepo,
    container,
  });

  app.get('/agents/:id/eval-cases', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listCases(workspaceId, req.params.id);
  });

  app.post(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, body: EvalCaseInput } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.createCase(workspaceId, req.params.id, req.body);
    },
  );

  app.put(
    '/eval-cases/:id',
    { schema: { params: IdParams, body: EvalCaseUpdate } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.updateCase(workspaceId, req.params.id, req.body);
    },
  );

  app.delete('/eval-cases/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(container, req);
    await service.deleteCase(workspaceId, req.params.id);
    return reply.status(204).send();
  });

  app.get(
    '/findings/:id/eval-case-seed',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.seedFromFinding(workspaceId, req.params.id);
    },
  );

  app.post(
    '/findings/:id/eval-case',
    { schema: { params: IdParams, body: CreateEvalCaseFromFindingBody } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.createFromFinding(workspaceId, req.params.id, req.body);
    },
  );
}
