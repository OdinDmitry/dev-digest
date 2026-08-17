import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ContextAttachmentInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { RepoRepository } from '../repos/repository.js';
import { ContextRepository } from './repository.js';
import { ContextService } from './service.js';

const DocumentQuery = z.object({ path: z.string().min(1).max(1024) });

/**
 * modules/context/routes.ts — Project Context transport layer. No SQL and no
 * fs in this file; all persistence goes through ContextService/ContextRepository.
 *   GET /repos/:id/context/documents → discoverable set for a repo
 *   GET /repos/:id/context/document  → one document's text (?path=)
 *   GET|PUT /agents/:id/context      → an agent's attached set
 *   GET|PUT /skills/:id/context      → a skill's attached set
 */
export default async function contextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ContextService({
    repo: new ContextRepository(app.container.db),
    agents: app.container.agentsRepo,
    tokenizer: app.container.tokenizer,
    cloneDir: app.container.config.cloneDir,
    repos: new RepoRepository(app.container.db),
  });

  app.get(
    '/repos/:id/context/documents',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listDocuments(workspaceId, req.params.id);
    },
  );

  app.get(
    '/repos/:id/context/document',
    { schema: { params: IdParams, querystring: DocumentQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getDocumentText(workspaceId, req.params.id, req.query.path);
    },
  );

  app.get('/agents/:id/context', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const agent = await app.container.agentsRepo.getById(workspaceId, req.params.id);
    if (!agent) throw new NotFoundError('Agent not found');
    return service.getOwnerAttachments(workspaceId, 'agent', req.params.id);
  });

  app.put(
    '/agents/:id/context',
    { schema: { params: IdParams, body: ContextAttachmentInput } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const agent = await app.container.agentsRepo.getById(workspaceId, req.params.id);
      if (!agent) throw new NotFoundError('Agent not found');
      return service.setOwnerAttachments(workspaceId, 'agent', req.params.id, req.body);
    },
  );

  app.get('/skills/:id/context', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await app.container.skillsRepo.getById(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    return service.getOwnerAttachments(workspaceId, 'skill', req.params.id);
  });

  app.put(
    '/skills/:id/context',
    { schema: { params: IdParams, body: ContextAttachmentInput } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await app.container.skillsRepo.getById(workspaceId, req.params.id);
      if (!skill) throw new NotFoundError('Skill not found');
      return service.setOwnerAttachments(workspaceId, 'skill', req.params.id, req.body);
    },
  );
}
