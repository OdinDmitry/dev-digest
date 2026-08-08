import type { DevDigestApi } from '../../src/devdigest/api.js';
import type {
  WireAgent,
  WireBlast,
  WireConvention,
  WirePr,
  WireRepo,
  WireReview,
  WireRun,
  WireRunStart,
} from '../../src/devdigest/wire.js';

/**
 * In-memory `DevDigestApi` fixture (§16). Records every call for assertions
 * (e.g. "no caching: two calls -> two API calls", "get_blast_radius makes
 * zero calls"), supports per-method injectable failures, and a settable
 * `runScript` so `listRuns` can simulate a run transitioning from `running`
 * to a terminal status across polls without any real waiting (tests drive
 * time with `vi.useFakeTimers()`).
 */
export class FakeDevDigestApi implements DevDigestApi {
  repos: WireRepo[] = [];
  pulls: Record<string, WirePr[]> = {};
  agents: WireAgent[] = [];
  runs: Record<string, WireRun[]> = {};
  reviews: Record<string, WireReview[]> = {};
  conventions: Record<string, WireConvention[]> = {};
  blast: Record<string, WireBlast> = {};

  calls: { method: keyof DevDigestApi; args: unknown[] }[] = [];
  failures: Partial<Record<keyof DevDigestApi, () => Error>> = {};

  /** Called each time `listRuns` is invoked for a pr, AFTER recording the
   * call — lets a test advance a run's status on, e.g., the 3rd poll. */
  runScript?: (prId: string, pollCount: number) => void;
  private pollCounts: Record<string, number> = {};

  private record(method: keyof DevDigestApi, args: unknown[]): void {
    this.calls.push({ method, args });
    const makeError = this.failures[method];
    if (makeError) throw makeError();
  }

  callCount(method: keyof DevDigestApi): number {
    return this.calls.filter((c) => c.method === method).length;
  }

  async listRepos(): Promise<WireRepo[]> {
    this.record('listRepos', []);
    return this.repos;
  }

  async listPulls(repoId: string): Promise<WirePr[]> {
    this.record('listPulls', [repoId]);
    return this.pulls[repoId] ?? [];
  }

  async listAgents(): Promise<WireAgent[]> {
    this.record('listAgents', []);
    return this.agents;
  }

  async startReview(prId: string, agentId: string): Promise<WireRunStart> {
    this.record('startReview', [prId, agentId]);
    const agent = this.agents.find((a) => a.id === agentId);
    const existing = this.runs[prId] ?? [];
    const runId = `run-${prId}-${agentId}-${existing.length + 1}`;
    const run: WireRun = {
      run_id: runId,
      agent_id: agentId,
      agent_name: agent?.name ?? null,
      status: 'running',
      error: null,
    };
    this.runs[prId] = [...existing, run];
    return {
      pr_id: prId,
      runs: [{ run_id: runId, agent_id: agentId, agent_name: agent?.name ?? null }],
    };
  }

  async listRuns(prId: string): Promise<WireRun[]> {
    this.record('listRuns', [prId]);
    const count = (this.pollCounts[prId] ?? 0) + 1;
    this.pollCounts[prId] = count;
    this.runScript?.(prId, count);
    return this.runs[prId] ?? [];
  }

  async listReviews(prId: string): Promise<WireReview[]> {
    this.record('listReviews', [prId]);
    return this.reviews[prId] ?? [];
  }

  async listConventions(repoId: string): Promise<WireConvention[]> {
    this.record('listConventions', [repoId]);
    return this.conventions[repoId] ?? [];
  }

  async getBlastRadius(prId: string): Promise<WireBlast> {
    this.record('getBlastRadius', [prId]);
    return this.blast[prId] ?? makeBlast();
  }
}

// ---- Fixture builders (small, explicit; not a full factory library) ------

let idCounter = 0;
export function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter.toString().padStart(4, '0')}`;
}

export function makeRepo(overrides: Partial<WireRepo> = {}): WireRepo {
  return { id: nextId('repo'), full_name: 'acme/payments-api', ...overrides };
}

export function makePr(overrides: Partial<WirePr> = {}): WirePr {
  return { id: nextId('pr'), number: 482, title: 'Add payment retries', ...overrides };
}

export function makeAgent(overrides: Partial<WireAgent> = {}): WireAgent {
  return {
    id: nextId('agent'),
    name: 'General',
    description: 'Reviews a PR diff for bugs, correctness, and clarity.',
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-flash',
    enabled: true,
    ...overrides,
  };
}

export function makeFinding(overrides: Partial<WireReview['findings'][number]> = {}) {
  return {
    severity: 'WARNING' as const,
    category: 'bug',
    title: 'Off-by-one in retry loop',
    file: 'src/payments/retry.ts',
    start_line: 10,
    end_line: 12,
    rationale: 'The loop retries one fewer time than the configured max.',
    suggestion: 'Use `<=` instead of `<`.',
    dismissed_at: null,
    ...overrides,
  };
}

export function makeReview(overrides: Partial<WireReview> = {}): WireReview {
  return {
    id: nextId('review'),
    run_id: nextId('run'),
    agent_id: null,
    agent_name: 'General',
    kind: 'review',
    verdict: 'comment',
    summary: 'A few small issues.',
    score: 82,
    created_at: '2026-08-01T00:00:00.000Z',
    findings: [makeFinding()],
    ...overrides,
  };
}

export function makeConvention(overrides: Partial<WireConvention> = {}): WireConvention {
  return {
    id: nextId('conv'),
    rule: 'Use `zod` schemas for all API request bodies.',
    category: 'validation',
    status: 'accepted',
    confidence: 0.9,
    evidence_path: 'src/routes/pulls.ts',
    evidence_start_line: 10,
    evidence_end_line: 20,
    ...overrides,
  };
}

export function makeBlast(overrides: Partial<WireBlast> = {}): WireBlast {
  return {
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
      },
    ],
    callers_total: 1,
    callers_truncated: false,
    impacted_endpoints: [{ endpoint: 'POST /payments', file: 'src/routes/payments.ts', hops: 1 }],
    endpoints_truncated: false,
    ...overrides,
  };
}
