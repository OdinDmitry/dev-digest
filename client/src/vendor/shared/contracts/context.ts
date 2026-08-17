import { z } from 'zod';

/**
 * Project Context — browse, preview and attach markdown documents from an
 * imported repository's working copy. See docs/specs/cross/SPEC-01-project-context.md.
 *
 * Token counting is server-side and authoritative (no model call); the client
 * only ever renders the number the server returns.
 */

// ---- Discoverable documents ----
export const ContextDocument = z.object({
  path: z.string(),
  /** Containing folder, repository-relative. '' for a repo-root document. */
  folder: z.string(),
  size_bytes: z.number().int(),
  token_count: z.number().int(),
  /** Distinct agents whose assembled project context would include this document. */
  usage_count: z.number().int(),
});
export type ContextDocument = z.infer<typeof ContextDocument>;

export const ContextListing = z.object({
  documents: z.array(ContextDocument),
  document_count: z.number().int(),
  total_tokens: z.number().int(),
  /** True when the discovery limit truncated the set. */
  partial: z.boolean(),
  /** Count of documents past the discovery limit, not included above. */
  not_listed: z.number().int(),
  last_synced_at: z.string().nullable(),
  /** False when the repository has not completed a working-copy sync yet. */
  synced: z.boolean(),
});
export type ContextListing = z.infer<typeof ContextListing>;

export const ContextDocumentText = z.object({
  path: z.string(),
  text: z.string(),
});
export type ContextDocumentText = z.infer<typeof ContextDocumentText>;

// ---- Attachments ----
export const ContextOwnerKind = z.enum(['agent', 'skill']);
export type ContextOwnerKind = z.infer<typeof ContextOwnerKind>;

export const ContextAttachment = z.object({
  owner_kind: ContextOwnerKind,
  owner_id: z.string(),
  repo_id: z.string(),
  path: z.string(),
  order: z.number().int(),
  /** True when the document is absent from the working copy right now. */
  missing: z.boolean(),
  token_count: z.number().int(),
});
export type ContextAttachment = z.infer<typeof ContextAttachment>;

export const ContextAttachmentSet = z.object({
  attachments: z.array(ContextAttachment),
  total_tokens: z.number().int(),
  budget: z.number().int(),
  over_budget: z.boolean(),
});
export type ContextAttachmentSet = z.infer<typeof ContextAttachmentSet>;

/** Body for PUT /agents/:id/context and PUT /skills/:id/context. */
export const ContextAttachmentInput = z.object({
  repo_id: z.string().uuid(),
  paths: z.array(z.string()),
});
export type ContextAttachmentInput = z.infer<typeof ContextAttachmentInput>;

// ---- Assembled project context (run-time; consumed by plan 2) ----
export const AssembledContextEntry = z.object({
  repo_id: z.string(),
  path: z.string(),
  via: ContextOwnerKind,
});
export type AssembledContextEntry = z.infer<typeof AssembledContextEntry>;

// ---- Run-time resolution (plan 2: assembling + injecting a run's context) ----
export const ContextExclusionReason = z.enum(['absent', 'other_repo', 'over_budget']);
export type ContextExclusionReason = z.infer<typeof ContextExclusionReason>;

/** One attachment that did not make it into a run's assembled context, with why. */
export const ContextExclusion = z.object({
  path: z.string(),
  reason: ContextExclusionReason,
});
export type ContextExclusion = z.infer<typeof ContextExclusion>;

/** The result of resolving one agent's project context for one run: the
 *  documents that survived (full text, ready to inject) and every excluded
 *  attachment with its reason. */
export const AssembledRunContext = z.object({
  documents: z.array(z.object({ path: z.string(), text: z.string() })),
  excluded: z.array(ContextExclusion),
});
export type AssembledRunContext = z.infer<typeof AssembledRunContext>;
