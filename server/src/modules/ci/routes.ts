import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CiExportInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { CiService } from './service.js';
import { CiRepository } from './repository.js';
import { RepoRepository } from '../repos/repository.js';

/** `POST /ci/workflow/validate` — no `:id`, just the candidate workflow text. */
const ValidateWorkflowBody = z.object({ contents: z.string() });

/**
 * Export-to-CI module (this phase).
 *   POST /agents/:id/ci-export/preview   → preview the generated bundle, no side effect
 *   POST /ci/workflow/validate           → validate a hand-edited workflow (AC-3)
 *   POST /agents/:id/ci-export/install   → commit the bundle + open the PR + record it
 *   GET  /agents/:id/ci-installations    → this agent's CI installations (AC-9)
 *   POST /ci/refresh                     → pull + ingest workflow runs (AC-14/15/16/24)
 *   GET  /ci/runs                        → this workspace's CI runs (AC-16)
 *   GET  /agents/:id/ci-runs             → this agent's CI runs (AC-23)
 *
 * Every route resolves `workspaceId` via `getContext` and 404s an agent or
 * repo from another workspace — enforced inside `CiService`, not here.
 *
 * No route here accepts a `CiResultArtifact` body — the studio only ever
 * records what it retrieved itself via `POST /ci/refresh` (AC-14).
 */
export default async function ciRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new CiService({
    repo: new CiRepository(app.container.db),
    agents: app.container.agentsRepo,
    repos: new RepoRepository(app.container.db),
    skills: app.container.skillsRepo,
    github: () => app.container.github(),
    config: app.container.config,
  });

  app.post(
    '/agents/:id/ci-export/preview',
    { schema: { params: IdParams, body: CiExportInput } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.preview(workspaceId, req.params.id, req.body);
    },
  );

  app.post('/ci/workflow/validate', { schema: { body: ValidateWorkflowBody } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.validateWorkflow(workspaceId, req.body.contents);
  });

  app.post(
    '/agents/:id/ci-export/install',
    {
      schema: { params: IdParams, body: CiExportInput },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.install(workspaceId, req.params.id, req.body);
    },
  );

  app.get('/agents/:id/ci-installations', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listInstallations(workspaceId, req.params.id);
  });

  app.post(
    '/ci/refresh',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.refresh(workspaceId);
    },
  );

  app.get('/ci/runs', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listRuns(workspaceId);
  });

  app.get('/agents/:id/ci-runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listRunsForAgent(workspaceId, req.params.id);
  });
}
