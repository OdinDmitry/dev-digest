import { and, eq, desc } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AnnotationInput } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { AppError } from '../../platform/errors.js';

/**
 * Annotations module. Lets a reviewer pin a note to a finding so the team
 * can discuss it without leaving DevDigest.
 *   POST /repos/:id/annotations  → create an annotation on a finding
 *   GET  /repos/:id/annotations  → list annotations for a repo
 */
export default async function annotationsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  app.post('/repos/:id/annotations', { schema: { params: IdParams, body: AnnotationInput } }, async (req) => {
    const { workspaceId, userId } = await getContext(app.container, req);

    const membership = await app.container.db.query.workspaceMembers.findFirst({
      where: (m, { and, eq }) => and(eq(m.workspaceId, workspaceId), eq(m.userId, userId)),
    });
    if (!membership || (membership.role !== 'owner' && membership.role !== 'maintainer')) {
      throw new AppError('forbidden', 'Only owners and maintainers can annotate findings', 403);
    }

    const [row] = await app.container.db
      .insert(t.annotations)
      .values({
        repoId: req.params.id,
        findingId: req.body.findingId,
        authorId: userId,
        body: req.body.body,
      })
      .returning();

    return row;
  });

  app.get('/repos/:id/annotations', async (req) => {
    const { workspaceId } = await getContext(app.container, req);

    const rows = await app.container.db
      .select()
      .from(t.annotations)
      .where(and(eq(t.annotations.repoId, req.params.id), eq(t.annotations.workspaceId, workspaceId)))
      .orderBy(desc(t.annotations.createdAt));

    return rows.map((row) => ({
      id: row.id,
      findingId: row.findingId,
      authorId: row.authorId,
      body: row.body,
      createdAt: row.createdAt,
    }));
  });
}
