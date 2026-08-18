/** Constants for the brief module. */

/** Token budget for the assembled model input (T13). Enforced server-side —
 *  reviewer-core receives an already-budgeted string. */
export const BRIEF_INPUT_TOKEN_BUDGET = 8000;

/** Change-statistics cap (T12) — files beyond this rank are reported as
 *  `not_listed`, never truncated mid-file. */
export const CHANGE_STATS_FILE_LIMIT = 300;

/** Rate limit shared by both generating routes (`POST /pulls/:id/brief`,
 *  `POST /pulls/:id/brief/regenerate`) — mirrors `intent/routes.ts`. Inert
 *  under test by design: `@fastify/rate-limit` is only registered when
 *  `nodeEnv !== 'test'` (`app.ts`). */
export const BRIEF_RATE_LIMIT = { max: 20, timeWindow: '1 minute' } as const;

/** Named for the observability log line around the model call — the actual
 *  `completeStructured` schemaName is reviewer-core's own internal constant
 *  (`generateBrief`'s signature is frozen at `{ llm, model, input }`, so it
 *  cannot be threaded through from here). */
export const BRIEF_SCHEMA_NAME = 'RawBrief';

/** The pre-built, unused `risk_brief` feature-model id (registered in
 *  `vendor/shared/contracts/platform.ts`) — no registry edit needed. */
export const BRIEF_FEATURE_MODEL = 'risk_brief' as const;
