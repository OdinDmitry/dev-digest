/**
 * blast/constants.ts — the free-text `reason` strings this module produces
 * on the wire (`PrBlastRadius.reason`). Not an enum on the contract side (see
 * `vendor/shared/contracts/blast.ts`'s doc comment on `reason`), but each
 * value this module itself decides to emit is still a single named constant
 * here rather than an inline literal, per `repo-intel/types.ts`'s
 * `DegradedReason` union that these mirror/extend.
 */

/** state === 'partial' — the index exists but is incomplete; results are
 *  still returned alongside this reason (§3 step 6). */
export const PARTIAL_INDEX_REASON = 'index_partial';

/**
 * Fallback reason for the "belt and braces" branch (§3 step 5): repoIntel's
 * `getIndexState` said the index was usable, but `getBlastRadius` still came
 * back `degraded: true` without a `reason`. Should be rare in practice —
 * `getIndexState` is the primary gate — but the contract's `reason` field is
 * never left null on a degraded state.
 */
export const DEFAULT_DEGRADED_REASON = 'index_failed';
