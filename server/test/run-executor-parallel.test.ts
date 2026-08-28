/**
 * Hermetic unit test that `ReviewRunExecutor.executeRuns`'s per-agent fan-out
 * (T16, AC-16) is genuinely CONCURRENT, not a sequential `for … await` loop.
 * Two mock agents share ONE LLM provider whose `completeStructured` blocks on
 * a barrier that only releases once BOTH agents have entered it:
 *   - against a sequential loop, the second agent never enters before the
 *     first has already returned → the barrier never releases → this test
 *     times out.
 *   - against the real (PQueue-bounded) fan-out, both enter concurrently, the
 *     barrier releases, and the test settles well inside its timeout.
 *
 * No DB, no network — everything the executor touches beyond the two agent
 * rows and the provider is faked in-file.
 */
import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import { ReviewRunExecutor } from '../src/modules/reviews/run-executor.js';
import type { ReviewRepository, PullRow, FindingRow, ReviewRow } from '../src/modules/reviews/repository.js';
import type { AgentRow } from '../src/db/rows.js';
import * as schema from '../src/db/schema.js';
import { MockGitClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import type {
  LLMProvider,
  ModelInfo,
  CompletionRequest,
  CompletionResult,
  StructuredRequest,
  StructuredResult,
  Review,
} from '@devdigest/shared';

/**
 * A shared logical clock (a plain incrementing counter) rather than
 * `Date.now()` — this fixture runs entirely synchronously between awaits, so
 * two events can land in the same millisecond and a wall-clock comparison
 * would be flaky. `tick()` gives every recorded event a strictly unique,
 * monotonically increasing order, shared between the provider (entry times)
 * and the fake repository (finish times) below.
 */
function makeClock() {
  let n = 0;
  return () => n++;
}

/**
 * Blocks every `completeStructured` call until `expectedEntrants` distinct
 * calls have entered it — the shared gate that makes "both agents run at
 * once" observable instead of implied.
 */
class BarrierLLMProvider implements LLMProvider {
  readonly id: 'openai' | 'anthropic' = 'anthropic';
  /** Logical-clock tick each call entered (recorded BEFORE awaiting the gate). */
  readonly entryTimes: number[] = [];
  private entered = 0;
  private release!: () => void;
  private readonly gate: Promise<void>;

  constructor(
    private readonly expectedEntrants: number,
    private readonly tick: () => number,
  ) {
    this.gate = new Promise((resolve) => {
      this.release = resolve;
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    return [];
  }

  async complete(_req: CompletionRequest): Promise<CompletionResult> {
    throw new Error('BarrierLLMProvider.complete() is not used by single-pass review');
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.entryTimes.push(this.tick());
    this.entered += 1;
    if (this.entered >= this.expectedEntrants) this.release();
    // Blocks here until every expected agent has ALSO entered.
    await this.gate;

    const fixture: Review = { verdict: 'approve', summary: 'looks fine', score: 95, findings: [] };
    const parsed = (req.schema as z.ZodType<T>).safeParse(fixture);
    if (!parsed.success) {
      throw new Error(`BarrierLLMProvider fixture failed schema: ${parsed.error.message}`);
    }
    return {
      data: parsed.data,
      model: req.model,
      tokensIn: 10,
      tokensOut: 10,
      costUsd: 0.001,
      raw: JSON.stringify(fixture),
      attempts: 1,
    };
  }

  async embed(): Promise<number[][]> {
    return [];
  }
}

function agentRow(over: Partial<AgentRow>): AgentRow {
  return {
    id: over.id ?? 'agent-x',
    workspaceId: 'ws-1',
    name: over.name ?? 'Agent X',
    description: '',
    provider: 'anthropic',
    model: 'claude-mock',
    systemPrompt: 'Review this diff.',
    outputSchema: null,
    strategy: 'single-pass',
    ciFailOn: 'critical',
    // Off, so the executor never reaches into a real repo-intel facade.
    repoIntel: false,
    enabled: true,
    version: 1,
    createdBy: null,
    createdAt: new Date(),
    ...over,
  } as AgentRow;
}

const pull: PullRow = {
  id: 'pr-1',
  workspaceId: 'ws-1',
  repoId: 'repo-1',
  number: 482,
  title: 'Add rate limiting',
  author: 'marisa.koch',
  branch: 'feat/rl',
  base: 'main',
  headSha: 'a1b2c3d4',
  lastReviewedSha: null,
  additions: 1,
  deletions: 0,
  filesCount: 1,
  status: 'needs_review',
  body: null,
  openedAt: null,
  updatedAt: null,
} as PullRow;

const repoRow = {
  id: 'repo-1',
  workspaceId: 'ws-1',
  owner: 'acme',
  name: 'payments-api',
  fullName: 'acme/payments-api',
  defaultBranch: 'main',
  clonePath: null,
  lastPolledAt: null,
  createdBy: null,
  createdAt: new Date(),
} as typeof schema.repos.$inferSelect;

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** Records finish (persist) tick per runId, keyed off `completeAgentRun`. */
function buildFakeRepo(finishTimes: Map<string, number>, tick: () => number): ReviewRepository {
  let reviewSeq = 0;
  const fake = {
    // Only IntentService.requirePull is reached (via `ensure`); returning
    // undefined makes it throw NotFoundError, which executeRuns swallows —
    // the run batch degrades to NO intent, exactly like an intent failure.
    getPull: async (): Promise<PullRow | undefined> => undefined,
    getRepo: async () => undefined,
    getPrFiles: async () => [],

    insertReview: async (): Promise<ReviewRow> => {
      reviewSeq += 1;
      return {
        id: `review-${reviewSeq}`,
        workspaceId: 'ws-1',
        prId: 'pr-1',
        agentId: null,
        runId: null,
        kind: 'review',
        verdict: 'approve',
        summary: 'looks fine',
        score: 95,
        model: 'claude-mock',
        grounding: null,
        createdAt: new Date(),
      } as unknown as ReviewRow;
    },
    insertFindings: async (): Promise<FindingRow[]> => [],
    markReviewed: async (): Promise<void> => {},
    saveRunTrace: async (): Promise<void> => {},
    completeAgentRun: async (runId: string): Promise<void> => {
      finishTimes.set(runId, tick());
    },
  };
  return fake as unknown as ReviewRepository;
}

describe('ReviewRunExecutor.executeRuns — concurrent fan-out (AC-16)', () => {
  it(
    'settles for two agents sharing a barrier that only releases once BOTH have entered, and both reach a terminal status',
    async () => {
      const tick = makeClock();
      const finishTimes = new Map<string, number>();
      const repo = buildFakeRepo(finishTimes, tick);
      const provider = new BarrierLLMProvider(2, tick);

      const container = new Container(loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv), {} as never, {
        secrets: new MockSecretsProvider(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { anthropic: provider },
      });

      const agentsRepo = { linkedSkills: async () => [] } as unknown as Container['agentsRepo'];

      const executor = new ReviewRunExecutor(container, repo, agentsRepo);

      const jobs = [
        { agent: agentRow({ id: 'agent-1', name: 'Agent One' }), runId: 'run-1' },
        { agent: agentRow({ id: 'agent-2', name: 'Agent Two' }), runId: 'run-2' },
      ];

      // If executeRuns ran the jobs sequentially, agent-2 would never enter
      // completeStructured (it only starts after agent-1's ENTIRE call chain,
      // including persistence, has finished) — the barrier requires 2 entrants
      // and would never release, and this await would hang past the test
      // timeout below.
      await executor.executeRuns('ws-1', pull, repoRow, jobs);

      // Both agents actually entered the shared LLM call (no job was dropped
      // by the concurrency bound — MULTI_AGENT_CONCURRENCY=8, well above 2).
      expect(provider.entryTimes).toHaveLength(2);

      // Both runs reached a terminal status (persisted via completeAgentRun).
      expect(finishTimes.has('run-1')).toBe(true);
      expect(finishTimes.has('run-2')).toBe(true);

      // Concurrency, stated as data: the two agents' recorded intervals
      // overlap. Both entries into completeStructured happened BEFORE the
      // barrier released (by construction — the barrier can't release until
      // BOTH have entered), and every run's finish (recorded in
      // completeAgentRun) happens strictly AFTER the release — so each run's
      // start precedes the OTHER run's finish on the shared logical clock,
      // which could only be true if they were in flight at the same time.
      const [entry1, entry2] = provider.entryTimes;
      const finish1 = finishTimes.get('run-1')!;
      const finish2 = finishTimes.get('run-2')!;
      expect(entry2).toBeLessThan(finish1);
      expect(entry1).toBeLessThan(finish2);
    },
    10_000,
  );
});
