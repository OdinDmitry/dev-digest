import type { Intent, PrIntentRecord } from '@devdigest/shared';
import type { MissingRef } from './sources.js';
import { LOW_CONFIDENCE_PREFIX, missingRefCaveat } from './constants.js';

/** Pure helpers for the intent module — no I/O. */

/** `RawIntent`/`Intent` (already contract-shaped) + the `pr_id` it scopes → the
 *  public `PrIntentRecord` response/persistence shape. */
export function toIntentRecord(intent: Intent, prId: string): PrIntentRecord {
  return { ...intent, pr_id: prId };
}

/**
 * Deterministic caveat prefix(es), composed by the SERVER — never reported by
 * the model — so "low confidence" / "a reference could not be read" are
 * honest and visible without a contract shape change (plan §3). Prefixes are
 * prepended, in order, before the model's own intent sentence.
 */
export function composeCaveat(
  intentText: string,
  opts: { lowConfidence: boolean; missingRefs: MissingRef[] },
): string {
  const prefixes: string[] = [];
  if (opts.lowConfidence) prefixes.push(LOW_CONFIDENCE_PREFIX);
  for (const ref of opts.missingRefs) prefixes.push(missingRefCaveat(ref.label));
  return prefixes.length === 0 ? intentText : `${prefixes.join(' ')} ${intentText}`;
}
