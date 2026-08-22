import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { EvalCaseInput, EvalCaseUpdate, EvalExpectation } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { RepoRepository } from '../repos/repository.js';
import { ContextService } from '../context/service.js';
import { ContextRepository } from '../context/repository.js';
import { EvalRepository } from './repository/index.js';
import { EvalService } from './service.js';
import { EvalSuiteRunner } from './runner.js';

const EvalCompareQuery = z.object({ a: z.string().uuid(), b: z.string().uuid() });

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
 * (Phase A) plus suite runs / compare / dashboard / preview (Phase B).
 *   GET    /agents/:id/eval-cases                 (AC-34's `last_outcome`, Phase B)
 *   POST   /agents/:id/eval-cases         (AC-47)
 *   PUT    /eval-cases/:id                (AC-8, AC-9)
 *   DELETE /eval-cases/:id
 *   GET    /findings/:id/eval-case-seed   (AC-3, AC-4)
 *   POST   /findings/:id/eval-case        (AC-5, AC-46)
 *   POST   /agents/:id/eval-runs                  (AC-21, AC-23)
 *   GET    /agents/:id/eval-runs                  (AC-36, AC-38)
 *   GET    /agents/:id/eval-runs/active            (AC-23, AC-24)
 *   GET    /agents/:id/eval-compare                (AC-40, AC-41, AC-42, AC-54)
 *   GET    /eval-runs/:id                          (AC-24, AC-26, AC-29)
 *   POST   /eval-cases/:id/preview                 (AC-33)
 *   GET    /evals/dashboard                        (AC-35, AC-32)
 *   POST   /evals/run-all                          (AC-31)
 *
 * No route here declares a feature-specific request-throttling config — the
 * spec forbids one (`server/insights.md` 2026-08-07: phrase this without the
 * literal grepped substring, or the plan's own static guard flags this
 * comment instead of an actual import).
 */
export default async function evalsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const repo = new EvalRepository(container.db);
  const buildContext = () =>
    new ContextService({
      repo: new ContextRepository(container.db),
      agents: container.agentsRepo,
      tokenizer: container.tokenizer,
      cloneDir: container.config.cloneDir,
      repos: new RepoRepository(container.db),
    });
  const runner = new EvalSuiteRunner({
    repo,
    agents: container.agentsRepo,
    buildContext,
    llm: (provider) => container.llm(provider),
    logger: app.log,
  });
  const service = new EvalService({
    repo,
    agents: container.agentsRepo,
    repos: new RepoRepository(container.db),
    reviews: container.reviewRepo,
    container,
    runner,
    buildContext,
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

  // ---- suite runs (Phase B) ------------------------------------------------

  app.post('/agents/:id/eval-runs', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(container, req);
    const run = await service.startSuiteRun(workspaceId, req.params.id);
    return reply.status(201).send(run);
  });

  // Declared BEFORE `GET /agents/:id/eval-runs` so the static `active`
  // segment can never be read as a uuid by a hypothetical
  // `/agents/:id/eval-runs/:runId` sibling (`server/insights.md` 2026-08-04).
  app.get('/agents/:id/eval-runs/active', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const active = await service.getActiveRun(workspaceId, req.params.id);
    return active;
  });

  app.get('/agents/:id/eval-runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listRuns(workspaceId, req.params.id);
  });

  app.get(
    '/agents/:id/eval-compare',
    { schema: { params: IdParams, querystring: EvalCompareQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.compareRuns(workspaceId, req.params.id, req.query.a, req.query.b);
    },
  );

  app.get('/eval-runs/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.getRun(workspaceId, req.params.id);
  });

  app.post('/eval-cases/:id/preview', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.previewCase(workspaceId, req.params.id);
  });

  // Declared BEFORE `POST /evals/run-all` so the static `dashboard` segment
  // reads the same way (no `:id`-shaped sibling under `/evals` today, but
  // the ordering is cheap insurance against a future one — same rule as
  // `/agents/:id/eval-runs/active` above).
  app.get('/evals/dashboard', async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.dashboard(workspaceId);
  });

  app.post('/evals/run-all', async (req) => {
    const { workspaceId } = await getContext(container, req);
    const runs = await service.runAllAgents(workspaceId);
    return { runs };
  });
}
