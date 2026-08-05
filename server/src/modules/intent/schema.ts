import { z } from 'zod';

/**
 * Internal, LLM-facing shape for the intent classifier call — deliberately
 * separate from the public `Intent` contract (same reasoning as
 * `conventions/schema.ts`'s `RawConventionExtraction`): no `pr_id` yet, and
 * this is the shape the model is asked to fill, not the persisted/response
 * shape.
 */
export const RawIntent = z.object({
  intent: z.string().min(1),
  in_scope: z.array(z.string()).max(20),
  out_of_scope: z.array(z.string()).max(20),
});
export type RawIntent = z.infer<typeof RawIntent>;
