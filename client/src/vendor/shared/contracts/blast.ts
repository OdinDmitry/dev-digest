import { z } from 'zod';

/**
 * Blast radius (L04) — "what else might this diff touch?" over the
 * `repo-intel` Postgres index. Deliberately a NEW file, NOT an edit to
 * `contracts/brief.ts`: `brief.ts` already exports `BlastRadius`,
 * `BlastCaller`, `ChangedSymbol`, `DownstreamImpact` for the never-built
 * PR-brief composition — they lack a degraded/state flag and don't match
 * this facade's real shape. Reusing/renaming those names would both break
 * `test/contracts.test.ts` (which parses `BlastRadius` in its current shape)
 * and collide at the barrel (`src/vendor/shared/index.ts` is `export *`).
 * See `specs/0005-blast-radius.md` §6.
 *
 * snake_case on the wire, matching every other contract in this folder; the
 * facade's camelCase (`repo-intel/types.ts`) is mapped in `blast/helpers.ts`.
 */

export const PrBlastState = z.enum(['ok', 'partial', 'degraded']);
export type PrBlastState = z.infer<typeof PrBlastState>;

export const PrBlastSymbol = z.object({
  file: z.string(),
  name: z.string(),
  kind: z.string(),
  /** 1-based declaration line; null when the indexer recorded none. */
  line: z.number().int().nullable(),
});
export type PrBlastSymbol = z.infer<typeof PrBlastSymbol>;

export const PrBlastCaller = z.object({
  file: z.string(),
  symbol: z.string(),
  via_symbol: z.string(),
  line: z.number().int(),
  rank: z.number(),
  /** file_rank.percentile of the caller file (0 in the degraded/ripgrep path). */
  percentile: z.number().int(),
});
export type PrBlastCaller = z.infer<typeof PrBlastCaller>;

export const PrBlastEndpoint = z.object({
  endpoint: z.string(),
  file: z.string(),
  hops: z.number().int(),
});
export type PrBlastEndpoint = z.infer<typeof PrBlastEndpoint>;

export const PrBlastRadius = z.object({
  pr_id: z.string(),
  repo_id: z.string(),
  state: PrBlastState,
  /**
   * Free-text reason, NOT an enum. The values come from the server-internal
   * `DegradedReason` union (`repo-intel/types.ts`), which may grow — mirroring
   * it here as a second enum would create a second source of truth across the
   * package boundary. The client renders this through a lookup map with a
   * generic fallback, so an unknown reason degrades to prose instead of
   * throwing. `null` when `state === 'ok'`. This is a deliberate trade against
   * the `zod` skill's `schema-use-enums` rule, documented here on purpose.
   */
  reason: z.string().nullable(),
  changed_files: z.array(z.string()),
  changed_symbols: z.array(PrBlastSymbol),
  callers: z.array(PrBlastCaller),
  /** Caller count BEFORE the per-symbol + global caps. */
  callers_total: z.number().int(),
  callers_truncated: z.boolean(),
  /** Structured endpoint rows (not the flat legacy `string[]` form). */
  impacted_endpoints: z.array(PrBlastEndpoint),
  endpoints_truncated: z.boolean(),
});
export type PrBlastRadius = z.infer<typeof PrBlastRadius>;
