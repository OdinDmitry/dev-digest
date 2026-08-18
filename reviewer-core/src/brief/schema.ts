import { z } from 'zod';
import { RiskSeverity } from '@devdigest/shared';

/**
 * Internal, LLM-facing shape for the PR-brief generation call — deliberately
 * separate from the public `BriefDoc`/`BriefRisk`/`BriefFocusItem` contracts
 * (same reasoning as `modules/intent/schema.ts`'s `RawIntent`): this is the
 * shape the model is asked to fill, not the grounded/persisted shape. Kept
 * LOCAL to reviewer-core — never exported into the shared contracts.
 *
 * A ref's line range and endpoint are `.nullable()`, never `.optional()`:
 * both providers send `response_format: json_schema` with `strict: true`
 * (`llm/openrouter.ts:76`), and strict structured outputs require EVERY
 * property to appear in `required`. `.optional()` drops the key from
 * `required`, which the API rejects — the `openai/helpers/zod` converter
 * warns about exactly this before the request is even sent. So the model must
 * emit the key and may set it to `null`. Downstream is unaffected:
 * `normalizeRef` uses `?? null` and `groundRefs` tests `!= null`, both of
 * which already treated `undefined` and `null` alike, and the persisted
 * `BriefFileRef` has always been `.nullable().default(null)`.
 */

export const RawBriefRef = z.object({
  path: z.string(),
  start_line: z.number().int().nullable(),
  end_line: z.number().int().nullable(),
  endpoint: z.string().nullable(),
});
export type RawBriefRef = z.infer<typeof RawBriefRef>;

export const RawBriefRisk = z.object({
  kind: z.string(),
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  refs: z.array(RawBriefRef),
});
export type RawBriefRisk = z.infer<typeof RawBriefRisk>;

export const RawBriefFocusItem = z.object({
  refs: z.array(RawBriefRef),
  reason: z.string(),
});
export type RawBriefFocusItem = z.infer<typeof RawBriefFocusItem>;

export const RawBrief = z.object({
  what: z.string(),
  why: z.string(),
  risk_level: RiskSeverity,
  risks: z.array(RawBriefRisk),
  review_focus: z.array(RawBriefFocusItem),
});
export type RawBrief = z.infer<typeof RawBrief>;
