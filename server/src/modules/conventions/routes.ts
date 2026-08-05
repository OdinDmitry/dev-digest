import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ConventionUpdateInput, ConventionMergePreviewRequest } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ConventionsService } from './service.js';
import { ConventionsRepository } from './repository.js';
import { RepoRepository } from '../repos/repository.js';

/**
 * Conventions module — repo-scoped extraction of candidate coding
 * conventions, reviewed by the user, then merged into a Skill via the
 * existing `POST /skills` (source: 'extracted').
 *   POST /repos/:id/conventions/extract        → run/re-run extraction (sync)
 *   GET  /repos/:id/conventions                → list candidates for a repo
 *   PUT    /conventions/:id                     → accept/reject/edit one candidate
 *   DELETE /conventions/:id                     → permanently remove one candidate
 *   POST   /repos/:id/conventions/merge-preview → draft a skill from given ids (no write)
 */
export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ConventionsService(app.container, {
    conventions: new ConventionsRepository(app.container.db),
    repos: new RepoRepository(app.container.db),
  });

  app.post('/repos/:id/conventions/extract', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.extract(workspaceId, req.params.id);
  });

  app.get('/repos/:id/conventions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId, req.params.id);
  });

  app.put(
    '/conventions/:id',
    { schema: { params: IdParams, body: ConventionUpdateInput } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const updated = await service.update(workspaceId, req.params.id, req.body);
      if (!updated) throw new NotFoundError('Convention not found');
      return updated;
    },
  );

  app.delete('/conventions/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.delete(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Convention not found');
    return { ok: true };
  });

  app.post(
    '/repos/:id/conventions/merge-preview',
    { schema: { params: IdParams, body: ConventionMergePreviewRequest } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.mergePreview(workspaceId, req.params.id, req.body.convention_ids);
    },
  );
}
