import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HttpDevDigestApi } from '../src/devdigest/http.js';
import { ApiError, ApiUnreachableError } from '../src/devdigest/api.js';
import { createLogger } from '../src/logging.js';

const BASE_URL = 'http://localhost:3001';
const REPO_UUID = 'f0d5652c-cf88-4eb6-baca-018c7b9fabe9';
const PR_UUID = '261788c9-900c-49c6-9b54-d700774cf812';
const AGENT_UUID = 'ea99af07-b039-4139-a404-8d5a684dd7cf';

function makeApi(): HttpDevDigestApi {
  return new HttpDevDigestApi(BASE_URL, createLogger(false));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// ---- Contract-drift fixtures — literals copied from a real, running local
// DevDigest API (2026-08-06), each annotated with the source contract it
// mirrors. Must keep parsing against `wire.ts` (§2/§16). ----------------

/** `Repo` — server/src/vendor/shared/contracts/platform.ts:140. */
const REPO_FIXTURE = {
  id: REPO_UUID,
  workspace_id: '560724b1-2d96-4aca-a210-14241899ca57',
  owner: 'acme',
  name: 'payments-api',
  full_name: 'acme/payments-api',
  default_branch: 'main',
  clone_path: null,
  last_polled_at: null,
  created_by: '8ac57087-61d1-4070-817c-ad51d89336bb',
};

/** `Agent` — server/src/vendor/shared/contracts/knowledge.ts:285. Includes
 * the real (multi-KB) `system_prompt` — proof it never reaches `WireAgent`. */
const AGENT_FIXTURE = {
  id: AGENT_UUID,
  name: 'General Reviewer',
  description: 'Reviews a PR diff for bugs, correctness, and clarity.',
  provider: 'openrouter',
  model: 'deepseek/deepseek-v4-flash',
  system_prompt: '# Role\nYou are a pragmatic senior engineer reviewing a pull-request diff…',
  output_schema: null,
  enabled: true,
  version: 1,
  strategy: 'single-pass',
  ci_fail_on: 'critical',
  repo_intel: true,
};

/** `PrMeta` row — server/src/vendor/shared/contracts/platform.ts:157 —
 * `GET /repos/:id/pulls`. */
const PR_FIXTURE = {
  id: PR_UUID,
  number: 482,
  title: 'Add rate limiting to public API endpoints',
  author: 'marisa.koch',
  branch: 'feat/rate-limit-public',
  base: 'main',
  head_sha: 'a1b2c3d4e5f6',
  additions: 247,
  deletions: 38,
  files_count: 9,
  status: 'reviewed',
  opened_at: null,
  updated_at: null,
  score: 100,
  cost_usd: 0.0003302208,
  findings_by_severity: { critical: 1, warning: 1, suggestion: 0 },
};

/** `RunSummary` — server/src/vendor/shared/contracts/trace.ts:98 —
 * `GET /pulls/:id/runs`. */
const RUN_FIXTURE = {
  run_id: 'ed929c3a-15b7-4ade-8b6e-ecb3986bd3de',
  agent_id: AGENT_UUID,
  agent_name: 'General Reviewer',
  provider: 'openrouter',
  model: 'deepseek/deepseek-v4-flash',
  status: 'done',
  error: null,
  duration_ms: 4689,
  tokens_in: 2934,
  tokens_out: 405,
  cost_usd: 0.0003302208,
  findings_count: 0,
  grounding: '0/0 passed',
  ran_at: '2026-08-06T19:42:21.298Z',
  score: 100,
  blockers: 0,
  warning_count: 0,
  suggestion_count: 0,
};

/** `PrBlastRadius` — server/src/vendor/shared/contracts/blast.ts:44 —
 * `GET /pulls/:id/blast`. Includes `pr_id`/`repo_id` (real wire fields,
 * dropped entirely by `WireBlast` — proof extra/unused keys don't break
 * parsing, mcp/CLAUDE.md's strip-not-strict convention). */
const BLAST_FIXTURE = {
  pr_id: PR_UUID,
  repo_id: REPO_UUID,
  state: 'ok',
  reason: null,
  changed_files: ['src/payments/retry.ts'],
  changed_symbols: [
    { file: 'src/payments/retry.ts', name: 'retryPayment', kind: 'function', line: 18 },
  ],
  callers: [
    {
      file: 'src/payments/handler.ts',
      symbol: 'handlePayment',
      via_symbol: 'retryPayment',
      line: 42,
      rank: 0.87,
      percentile: 76,
    },
  ],
  callers_total: 1,
  callers_truncated: false,
  impacted_endpoints: [{ endpoint: 'POST /payments', file: 'src/routes/payments.ts', hops: 1 }],
  endpoints_truncated: false,
};

/** `ReviewDto` — server/src/modules/reviews/helpers.ts:18 —
 * `GET /pulls/:id/reviews`. The live capture had zero findings; the finding
 * literal below is reconstructed from `findingRowToDto`
 * (`reviews/helpers.ts:34`) rather than a live capture. */
const REVIEW_FIXTURE = {
  id: 'a5fb65d3-0a56-4824-be4a-b5c37de5516e',
  pr_id: PR_UUID,
  agent_id: AGENT_UUID,
  run_id: 'ed929c3a-15b7-4ade-8b6e-ecb3986bd3de',
  agent_name: 'General Reviewer',
  kind: 'review',
  verdict: 'approve',
  summary: 'Diff is empty. No code changes introduced; no issues to report.',
  score: 100,
  model: 'deepseek/deepseek-v4-flash',
  created_at: '2026-08-06T19:42:25.998Z',
  findings: [
    {
      id: 'f-0001',
      severity: 'WARNING',
      category: 'bug',
      title: 'Off-by-one in retry loop',
      file: 'src/payments/retry.ts',
      start_line: 10,
      end_line: 12,
      rationale: 'The loop retries one fewer time than the configured max.',
      suggestion: 'Use `<=` instead of `<`.',
      confidence: 0.8,
      kind: 'finding',
      trifecta_components: null,
      evidence: null,
      review_id: 'a5fb65d3-0a56-4824-be4a-b5c37de5516e',
      accepted_at: null,
      dismissed_at: null,
    },
  ],
};

describe('HttpDevDigestApi', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GET /repos — correct method, path, redirect policy and timeout signal', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([REPO_FIXTURE]));
    const api = makeApi();
    const repos = await api.listRepos();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe(`${BASE_URL}/repos`);
    expect(init.method).toBe('GET');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(repos).toEqual([{ id: REPO_FIXTURE.id, full_name: REPO_FIXTURE.full_name }]);
  });

  it('GET /repos/:id/pulls — the id is embedded in the path via encodeURIComponent', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    const api = makeApi();
    await api.listPulls(REPO_UUID);
    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(String(url)).toBe(`${BASE_URL}/repos/${encodeURIComponent(REPO_UUID)}/pulls`);
  });

  it('POST /pulls/:id/review — sends a JSON body with { agentId }', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        pr_id: PR_UUID,
        runs: [{ run_id: RUN_FIXTURE.run_id, agent_id: AGENT_UUID, agent_name: 'General Reviewer' }],
      }),
    );
    const api = makeApi();
    const started = await api.startReview(PR_UUID, AGENT_UUID);

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe(`${BASE_URL}/pulls/${PR_UUID}/review`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ agentId: AGENT_UUID });
    expect(started.runs[0]?.run_id).toBe(RUN_FIXTURE.run_id);
  });

  it('GET /pulls/:id/blast — correct method, path (uuid-encoded)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(BLAST_FIXTURE));
    const api = makeApi();
    await api.getBlastRadius(PR_UUID);

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe(`${BASE_URL}/pulls/${encodeURIComponent(PR_UUID)}/blast`);
    expect(init.method).toBe('GET');
  });

  it('rejects a non-uuid id before ever building a URL (defense in depth, §15)', async () => {
    const api = makeApi();
    await expect(api.listPulls('not-a-uuid')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid prId for getBlastRadius before ever building a URL', async () => {
    const api = makeApi();
    await expect(api.getBlastRadius('not-a-uuid')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('parses the ApiErrorBody envelope into an ApiError', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: 'not_found', message: 'Agent not found' } }, 404),
    );
    const api = makeApi();
    await expect(api.listAgents()).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
      message: 'Agent not found',
    });
  });

  it('an error response with no parseable envelope still becomes an ApiError', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }));
    const api = makeApi();
    await expect(api.listAgents()).rejects.toBeInstanceOf(ApiError);
  });

  it('a network failure becomes an ApiUnreachableError, not an ApiError', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const api = makeApi();
    await expect(api.listRepos()).rejects.toBeInstanceOf(ApiUnreachableError);
  });

  describe('contract-drift fixtures', () => {
    it('parses a real GET /repos row', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse([REPO_FIXTURE]));
      const api = makeApi();
      await expect(api.listRepos()).resolves.toEqual([
        { id: REPO_FIXTURE.id, full_name: REPO_FIXTURE.full_name },
      ]);
    });

    it('parses a real GET /agents row, and system_prompt never survives parsing', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse([AGENT_FIXTURE]));
      const api = makeApi();
      const agents = await api.listAgents();
      expect(agents[0]).not.toHaveProperty('system_prompt');
      expect(agents[0]).toMatchObject({ name: 'General Reviewer', enabled: true });
    });

    it('parses a real GET /repos/:id/pulls row', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse([PR_FIXTURE]));
      const api = makeApi();
      await expect(api.listPulls(REPO_UUID)).resolves.toEqual([
        { id: PR_FIXTURE.id, number: PR_FIXTURE.number, title: PR_FIXTURE.title },
      ]);
    });

    it('parses a real GET /pulls/:id/runs row', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse([RUN_FIXTURE]));
      const api = makeApi();
      const runs = await api.listRuns(PR_UUID);
      expect(runs[0]).toMatchObject({ run_id: RUN_FIXTURE.run_id, status: 'done' });
    });

    it('parses a real GET /pulls/:id/reviews row (with a reconstructed finding)', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse([REVIEW_FIXTURE]));
      const api = makeApi();
      const reviews = await api.listReviews(PR_UUID);
      expect(reviews[0]).toMatchObject({ verdict: 'approve', kind: 'review' });
      expect(reviews[0]?.findings[0]).toMatchObject({ severity: 'WARNING', file: 'src/payments/retry.ts' });
    });

    it('an unknown extra field on a known payload does not break parsing', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse([{ ...REPO_FIXTURE, some_future_field: 'x' }]));
      const api = makeApi();
      await expect(api.listRepos()).resolves.toHaveLength(1);
    });

    it('a missing required field fails loudly (as an ApiError, never a silent undefined)', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 'x' /* full_name missing */ }]));
      const api = makeApi();
      await expect(api.listRepos()).rejects.toBeInstanceOf(ApiError);
    });

    it('parses a real GET /pulls/:id/blast payload, dropping pr_id/repo_id entirely', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(BLAST_FIXTURE));
      const api = makeApi();
      const blast = await api.getBlastRadius(PR_UUID);

      expect(blast.state).toBe('ok');
      expect(blast.changed_symbols[0]).toMatchObject({ file: 'src/payments/retry.ts', name: 'retryPayment' });
      expect(blast.callers[0]).toMatchObject({ symbol: 'handlePayment', via_symbol: 'retryPayment', line: 42 });
      expect(blast.impacted_endpoints[0]).toMatchObject({ endpoint: 'POST /payments', hops: 1 });
      expect(blast).not.toHaveProperty('pr_id');
      expect(blast).not.toHaveProperty('repo_id');
    });
  });
});
