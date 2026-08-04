import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SkillSource, SkillType } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { SkillsRepository } from './repository.js';
import { SkillsService } from './service.js';
import { IMPORT_BODY_LIMIT_BYTES, MAX_UPLOAD_BASE64_CHARS } from './constants.js';

/**
 * Skills module — reusable, text-only prompt blocks shared across agents.
 *   GET    /skills                            → list (workspace-scoped)
 *   GET    /skills/stats                      → per-skill linked-agent rollup (rail)
 *   GET    /skills/:id                        → one skill
 *   POST   /skills                            → create
 *   PUT    /skills/:id                        → update (a body change versions the skill)
 *   DELETE /skills/:id                        → delete (versions + agent links cascade)
 *   GET    /skills/:id/versions               → body-version history (newest first, no body)
 *   GET    /skills/:id/versions/:version      → one historical snapshot (with body)
 *   POST   /skills/:id/versions/:version/restore → restore a snapshot as a NEW version
 *   POST   /skills/import/preview             → parse an upload; persists NOTHING
 *
 * Attaching a skill to an agent lives on the agents module
 * (`GET|POST /agents/:id/skills`), which owns the `agent_skills` link table.
 */

const CreateSkillBody = z.object({
  name: z.string().min(1),
  // Required, unlike the agent's description: a skill's description IS its
  // interface — it is what the agent reads to decide whether the skill applies.
  description: z.string().min(1),
  type: SkillType,
  source: SkillSource.optional(),
  body: z.string().min(1),
  enabled: z.boolean().optional(),
  evidence_files: z.array(z.string()).nullish(),
});

const UpdateSkillBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  type: SkillType.optional(),
  body: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  evidence_files: z.array(z.string()).nullish(),
  note: z.string().max(200).nullish(),
});

/** `/skills/:id/versions/:version` — id is a uuid, version a positive integer. */
const VersionParams = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

const RestoreVersionBody = z.object({ note: z.string().max(200).nullish() });

/**
 * An upload arrives as JSON rather than multipart: multipart bodies bypass the
 * zod type provider, which would make this the only hand-validating route in the
 * server. Markdown travels as plain `content` (readable in devtools); a zip
 * travels base64-encoded in `content_base64`.
 */
const ImportPreviewBody = z
  .object({
    filename: z.string().min(1),
    content: z.string().optional(),
    content_base64: z.string().max(MAX_UPLOAD_BASE64_CHARS).optional(),
  })
  .refine((b) => (b.content == null) !== (b.content_base64 == null), {
    message: 'Provide exactly one of content / content_base64',
  });

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService({ repo: new SkillsRepository(app.container.db) });

  app.get('/skills', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.post('/skills', { schema: { body: CreateSkillBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const body = req.body;
    const skill = await service.create(workspaceId, {
      name: body.name,
      description: body.description,
      type: body.type,
      body: body.body,
      ...(body.source !== undefined ? { source: body.source } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(body.evidence_files !== undefined ? { evidence_files: body.evidence_files } : {}),
    });
    reply.status(201);
    return skill;
  });

  /**
   * Registered before `/skills/:id` so the static segment can never be read as a
   * uuid. find-my-way prefers static segments anyway, but a fall-through would
   * surface as a confusing 422 from IdParams rather than a 404.
   */
  app.post(
    '/skills/import/preview',
    {
      // Base64 inflates by 4/3, and the app-wide limit is 1 MiB — raise it just
      // for this route so an oversize upload fails our validator (422), not
      // Fastify's raw 413.
      bodyLimit: IMPORT_BODY_LIMIT_BYTES,
      schema: { body: ImportPreviewBody },
    },
    async (req) => {
      await getContext(app.container, req);
      const body = req.body;
      const bytes =
        body.content !== undefined
          ? new Uint8Array(Buffer.from(body.content, 'utf8'))
          : decodeBase64(body.content_base64!);
      return service.previewImport({ filename: body.filename, bytes });
    },
  );

  /**
   * Per-skill rollup for the rail. Declared before `/skills/:id` so the static
   * segment can never be read as a uuid — find-my-way prefers static segments
   * anyway, but a fall-through would surface as a confusing 422 from IdParams
   * rather than the intended response (the same hazard documented at
   * `agents/routes.ts` for `GET /agents/stats`).
   */
  app.get('/skills/stats', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.statsBySkill(workspaceId);
  });

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.put('/skills/:id', { schema: { params: IdParams, body: UpdateSkillBody } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.update(workspaceId, req.params.id, req.body);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.delete(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Skill not found');
    return { ok: true };
  });

  app.get('/skills/:id/versions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const versions = await service.listVersions(workspaceId, req.params.id);
    if (!versions) throw new NotFoundError('Skill not found');
    return versions;
  });

  app.get(
    '/skills/:id/versions/:version',
    { schema: { params: VersionParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const version = await service.getVersion(workspaceId, req.params.id, req.params.version);
      if (!version) throw new NotFoundError('Skill version not found');
      return version;
    },
  );

  app.post(
    '/skills/:id/versions/:version/restore',
    { schema: { params: VersionParams, body: RestoreVersionBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      // undefined covers both "no such skill" and "no such version" — either
      // way the client gets a 404. Restoring the CURRENT version is NOT this
      // case: it 200s with the unchanged skill (see restoreVersion).
      const restored = await service.restoreVersion(
        workspaceId,
        req.params.id,
        req.params.version,
        req.body.note,
      );
      if (!restored) throw new NotFoundError('Skill or skill version not found');
      return restored;
    },
  );
}

/** Strict base64 decode — a malformed payload must not reach the zip reader. */
function decodeBase64(value: string): Uint8Array {
  const cleaned = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) {
    throw new ValidationError('content_base64 is not valid base64');
  }
  return new Uint8Array(Buffer.from(cleaned, 'base64'));
}
