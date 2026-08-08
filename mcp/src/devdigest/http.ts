import { z } from 'zod';
import type { DevDigestApi } from './api.js';
import { ApiError, ApiUnreachableError } from './api.js';
import { WireAgent, WireBlast, WireConvention, WirePr, WireRepo, WireReview, WireRun, WireRunStart } from './wire.js';
import type { Logger } from '../logging.js';
import { apiUnreachableMessage, HTTP_TIMEOUT_MS, HTTP_TIMEOUT_SLOW_MS } from '../constants.js';

/** `{ error: { code, message, details? } }` —
 * `server/src/vendor/shared/contracts/platform.ts:285` (`ApiErrorBody`). */
const ApiErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

/** Defense-in-depth (§15): every id resolved from the API is re-validated as
 * a uuid before it is interpolated into a URL path, even though `resolve.ts`
 * already only ever hands this class ids it read from the API itself. */
function assertUuid(id: string, label: string): void {
  if (!z.string().uuid().safeParse(id).success) {
    throw new Error(`Internal error: expected a uuid for ${label}, got "${id}"`);
  }
}

/**
 * Ring 3 (adapter) — the ONLY file in this package that calls `fetch` (§1
 * hard rule, checkable by grep). One attempt per call, no retries (the API is
 * on localhost; a retry loop only multiplies latency and rate-limit
 * pressure — the run_agent_on_pr poll loop, §6, is the wait, not a retry).
 * Every response is `.parse()`d against `wire.ts` at the boundary (§2's
 * accepted trade-off: a renamed server field fails loudly here, never as a
 * silent `undefined` downstream).
 */
export class HttpDevDigestApi implements DevDigestApi {
  constructor(
    private readonly baseUrl: string,
    private readonly logger: Logger,
  ) {}

  // Every method below is `async` (rather than a bare `return this.request(...)`)
  // so a synchronous `assertUuid` failure becomes a rejected promise like
  // every other failure mode here, not a synchronous throw out of a
  // nominally-async API.

  async listRepos(): Promise<WireRepo[]> {
    return this.request('GET', '/repos', undefined, z.array(WireRepo));
  }

  async listPulls(repoId: string): Promise<WirePr[]> {
    assertUuid(repoId, 'repoId');
    // Live GitHub round-trip (constraint 10) — the slow timeout, not the
    // default. Never call GET /pulls/:id just to resolve a PR uuid (its
    // files[]+patches payload is huge) — this is the only pulls read here.
    return this.request(
      'GET',
      `/repos/${encodeURIComponent(repoId)}/pulls`,
      undefined,
      z.array(WirePr),
      HTTP_TIMEOUT_SLOW_MS,
    );
  }

  async listAgents(): Promise<WireAgent[]> {
    return this.request('GET', '/agents', undefined, z.array(WireAgent));
  }

  async startReview(prId: string, agentId: string): Promise<WireRunStart> {
    assertUuid(prId, 'prId');
    assertUuid(agentId, 'agentId');
    return this.request('POST', `/pulls/${encodeURIComponent(prId)}/review`, { agentId }, WireRunStart);
  }

  async listRuns(prId: string): Promise<WireRun[]> {
    assertUuid(prId, 'prId');
    return this.request('GET', `/pulls/${encodeURIComponent(prId)}/runs`, undefined, z.array(WireRun));
  }

  async listReviews(prId: string): Promise<WireReview[]> {
    assertUuid(prId, 'prId');
    return this.request('GET', `/pulls/${encodeURIComponent(prId)}/reviews`, undefined, z.array(WireReview));
  }

  async listConventions(repoId: string): Promise<WireConvention[]> {
    assertUuid(repoId, 'repoId');
    return this.request(
      'GET',
      `/repos/${encodeURIComponent(repoId)}/conventions`,
      undefined,
      z.array(WireConvention),
    );
  }

  async getBlastRadius(prId: string): Promise<WireBlast> {
    assertUuid(prId, 'prId');
    // Default timeout (not the slow one) — this is a Postgres read over the
    // repo-intel index, not a GitHub round-trip (specs/0005-blast-radius.md §10).
    return this.request('GET', `/pulls/${encodeURIComponent(prId)}/blast`, undefined, WireBlast);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    schema: z.ZodType<T>,
    timeoutMs: number = HTTP_TIMEOUT_MS,
  ): Promise<T> {
    // new URL(path, baseUrl) — never a template-concatenated string; every
    // interpolated id is already encodeURIComponent()'d by the caller above.
    const url = new URL(path, this.baseUrl);
    this.logger.debug('request', { method, url: url.toString() });

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        // A redirect can never move a call off localhost (§3, security).
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      this.logger.debug('unreachable', { method, url: url.toString(), err: (err as Error).message });
      throw new ApiUnreachableError(apiUnreachableMessage(this.baseUrl), err);
    }

    if (!res.ok) {
      const { code, message } = await this.readErrorBody(res);
      throw new ApiError(message, res.status, code);
    }

    const json = await res.json().catch(() => undefined);
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError(
        `Unexpected response shape from ${method} ${path}: ${parsed.error.message}`,
        res.status,
        'unexpected_response_shape',
      );
    }
    // Never log response bodies at the default level (§3) — they can contain
    // PR content. Only the request/response line, only under debug.
    this.logger.debug('response', { method, url: url.toString(), status: res.status });
    return parsed.data;
  }

  private async readErrorBody(res: Response): Promise<{ code: string; message: string }> {
    const json = await res.json().catch(() => undefined);
    const parsed = ApiErrorEnvelope.safeParse(json);
    if (parsed.success) {
      return { code: parsed.data.error.code, message: parsed.data.error.message };
    }
    return { code: 'unknown_error', message: res.statusText || 'Request failed' };
  }
}
