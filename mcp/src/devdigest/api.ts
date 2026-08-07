import type {
  WireAgent,
  WireConvention,
  WireFinding,
  WirePr,
  WireRepo,
  WireReview,
  WireRun,
  WireRunStart,
} from './wire.js';

/**
 * Ring 1 (port). The DevDigestApi surface — exactly these seven methods, one
 * per existing Fastify endpoint (Development Plan §1). Two implementations:
 * `HttpDevDigestApi` (ring 3, `http.ts`) and the in-memory test fake
 * (`test/helpers/fake-api.ts`) — that's what keeps `resolve.ts`/`tools/*`
 * hermetically testable without a running API.
 */
export interface DevDigestApi {
  listRepos(): Promise<WireRepo[]>;
  listPulls(repoId: string): Promise<WirePr[]>;
  listAgents(): Promise<WireAgent[]>;
  startReview(prId: string, agentId: string): Promise<WireRunStart>;
  listRuns(prId: string): Promise<WireRun[]>;
  listReviews(prId: string): Promise<WireReview[]>;
  listConventions(repoId: string): Promise<WireConvention[]>;
}

// Re-exported so callers only need `./api.js` for both the port and its
// payload shapes.
export type { WireAgent, WireConvention, WireFinding, WirePr, WireRepo, WireReview, WireRun, WireRunStart };

/** One request failed with a structured (or unstructured) HTTP error from the
 * DevDigest API itself — as opposed to `ApiUnreachableError`, which means the
 * request never got a response at all (§3). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The DevDigest API could not be reached at all — connection refused, DNS
 * failure, timeout, or abort (§3). Distinct from `ApiError` so callers can
 * give the "start it with ./scripts/dev.sh" guidance specifically. */
export class ApiUnreachableError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ApiUnreachableError';
  }
}
