/**
 * blast/helpers.ts — pure mapper from the `repo-intel` facade's camelCase
 * `BlastResult` (+ the state/reason `BlastService` already decided) into the
 * wire's snake_case `PrBlastRadius` contract. No Drizzle, no row types, no
 * HTTP — ring 2, per `onion-architecture`.
 */
import type { PrBlastEndpoint, PrBlastRadius, PrBlastState } from '@devdigest/shared';
import type { BlastResult } from '../repo-intel/types.js';

export interface BlastRadiusInput {
  prId: string;
  repoId: string;
  state: PrBlastState;
  /** `null` only when `state === 'ok'`. */
  reason: string | null;
  changedFiles: string[];
  /**
   * `null` when there is nothing from `repoIntel` to shape — the empty-diff
   * case (§3 step 2) and the "gate fired before `getBlastRadius` was ever
   * called" degraded case (§3 step 4). Every array on the result is `[]` in
   * that case; the `[]` is never mistaken for "no impact" because `state`
   * and `reason` still carry the real signal.
   */
  blast: BlastResult | null;
}

/** camelCase -> snake_case, preserving `hops`, propagating the truncation
 *  flags and pre-cap total exactly as `repo-intel` computed them. */
export function toPrBlastRadius(input: BlastRadiusInput): PrBlastRadius {
  const b = input.blast;
  return {
    pr_id: input.prId,
    repo_id: input.repoId,
    state: input.state,
    reason: input.reason,
    changed_files: input.changedFiles,
    changed_symbols: (b?.changedSymbols ?? []).map((s) => ({
      file: s.file,
      name: s.name,
      kind: s.kind,
      line: s.line,
    })),
    callers: (b?.callers ?? []).map((c) => ({
      file: c.file,
      symbol: c.symbol,
      via_symbol: c.viaSymbol,
      line: c.line,
      rank: c.rank,
      percentile: c.percentile,
    })),
    callers_total: b?.callersTotal ?? 0,
    callers_truncated: b?.callersTruncated ?? false,
    impacted_endpoints: mapEndpoints(b),
    endpoints_truncated: b?.endpointsTruncated ?? false,
  };
}

/**
 * The persistent path always populates `impactedEndpointRows` (§4); this
 * only falls back to mapping the flat legacy `impactedEndpoints: string[]`
 * when a `BlastResult` reaches here WITHOUT rows — which today can't happen
 * on this route (the §3 step 4 gate makes the degraded ripgrep fallback
 * unreachable from `BlastService`), but the mapper stays defensive rather
 * than assuming a caller always supplies rows.
 */
function mapEndpoints(b: BlastResult | null): PrBlastEndpoint[] {
  if (!b) return [];
  if (b.impactedEndpointRows) {
    return b.impactedEndpointRows.map((r) => ({ endpoint: r.endpoint, file: r.file, hops: r.hops }));
  }
  return b.impactedEndpoints.map((endpoint) => ({ endpoint, file: '', hops: 1 }));
}
