/**
 * Review module constants.
 */

/**
 * Studio review strategy. 'single-pass' = send the WHOLE diff in ONE LLM call.
 * We deliberately do NOT use 'auto'/map-reduce by default: map-reduce makes one
 * call PER FILE, which is slow and fragile (any single file's transient 5xx
 * fails the entire run) and unnecessary — the whole diff already fits the
 * model's context.
 */
export const REVIEW_STRATEGY = 'single-pass' as const;

/** Fallback column header when a multi-agent column's agent was deleted after
 *  the run (the `agent_runs.agent_id` FK is `ON DELETE SET NULL`). */
export const UNKNOWN_AGENT_NAME = 'Unknown agent' as const;

/**
 * Bound on how many agents in a multi-agent group run concurrently
 * (`run-executor.ts`'s fan-out). Cheap insurance against a provider 429,
 * which would otherwise surface as a `failed` column carrying a rate-limit
 * error — the exact "one agent's failure costs one column" outcome AC-11
 * exists to contain, but caused by us rather than by the provider.
 */
export const MULTI_AGENT_CONCURRENCY = 8;
