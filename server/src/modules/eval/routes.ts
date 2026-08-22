import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { EvalCaseCreate, EvalCaseUpdate } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { EvalService } from './service.js';
import { EvalRepository } from './repository.js';

const RecentRunsQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });

/**
 * eval module (SPEC-03) — turn accepted/dismissed findings into a frozen,
 * labelled eval case set per agent; replay an agent over its whole set with
 * its own model/provider/linked skills; score mechanically with zero model
 * calls on the scoring path.
 *
 * Ring 4 only: parse params/body → delegate to the service → return its DTO.
 * No Drizzle, no business logic here (`modules/brief/routes.ts:30-56` is the
 * template — this module must not copy the grandfathered "query from
 * routes.ts" pattern; that list is closed).
 */
export default async function evalRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  const service = new EvalService({
    repo: new EvalRepository(container.db),
    agents: container.agentsRepo,
    reviews: container.reviewRepo,
    llm: (id) => container.llm(id),
  });

  app.get(
    '/findings/:id/eval-case-draft',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getDraft(workspaceId, req.params.id);
    },
  );

  app.post(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, body: EvalCaseCreate } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const { created, case: evalCase } = await service.createCase(workspaceId, req.params.id, req.body);
      reply.status(created ? 201 : 200);
      return evalCase;
    },
  );

  app.get(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.listCases(workspaceId, req.params.id);
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

  app.delete(
    '/eval-cases/:id',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const ok = await service.deleteCase(workspaceId, req.params.id);
      if (!ok) throw new NotFoundError('Eval case not found');
      return { ok: true };
    },
  );

  app.post(
    '/agents/:id/eval-runs',
    { schema: { params: IdParams } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const run = await service.startRun(workspaceId, req.params.id);
      reply.status(202);
      return run;
    },
  );

  app.get(
    '/agents/:id/eval-runs',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.listRuns(workspaceId, req.params.id);
    },
  );

  app.get(
    '/eval-runs/:id',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getRun(workspaceId, req.params.id);
    },
  );

  app.get(
    '/eval-runs',
    { schema: { querystring: RecentRunsQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.listRecentRuns(workspaceId, req.query.limit);
    },
  );

  // AC-46 — synchronous, one model call; writes only `eval_cases.latest_result`.
  app.post(
    '/eval-cases/:id/verify',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.verifyCase(workspaceId, req.params.id);
    },
  );

  // AC-63 — a distinct prefix on purpose, so it can never be matched as an
  // id by `/eval-runs/:id` (server/insights.md 2026-08-04).
  app.get('/eval-agents', async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listAgentSummaries(workspaceId);
  });
}
