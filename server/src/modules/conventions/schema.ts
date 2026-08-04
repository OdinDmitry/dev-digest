import { z } from 'zod';
import { MAX_CANDIDATES } from './constants.js';

/**
 * Internal, LLM-facing shape for one extraction call — deliberately separate
 * from the public `ConventionCandidate` contract (no `id`/`status`/`repo_id`
 * yet; those are assigned once a candidate survives the grounding check and
 * gets persisted).
 */
export const RawConventionCandidate = z.object({
  category: z.string().min(1),
  rule: z.string().min(1),
  evidence: z.object({
    file: z.string().min(1),
    start_line: z.number().int().positive(),
    end_line: z.number().int().positive(),
    snippet: z.string().min(1),
  }),
  confidence: z.number().min(0).max(1),
});
export type RawConventionCandidate = z.infer<typeof RawConventionCandidate>;

export const RawConventionExtraction = z.object({
  candidates: z.array(RawConventionCandidate).max(MAX_CANDIDATES),
});
export type RawConventionExtraction = z.infer<typeof RawConventionExtraction>;
