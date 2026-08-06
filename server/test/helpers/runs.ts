import * as t from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { PgFixture } from './pg.js';

/**
 * `runReview` is fire-and-forget: the POST returns runIds immediately and each
 * agent's review is persisted in the background (the client subscribes to SSE).
 * Tests that assert on persisted reviews/findings/traces must first wait for the
 * background runs to finish. This polls `agent_runs` until every row for the PR
 * reaches a terminal status (done / failed / cancelled).
 */
const TERMINAL = new Set(['done', 'failed', 'cancelled']);

export async function waitForPrRuns(
  db: PgFixture['handle']['db'],
  prId: string,
  opts: { expected?: number; timeoutMs?: number } = {},
): Promise<Array<typeof t.agentRuns.$inferSelect>> {
  const { expected, timeoutMs = 10_000 } = opts;
  const start = Date.now();
  for (;;) {
    const runs = await db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, prId));
    const terminal = runs.filter((r) => TERMINAL.has(r.status ?? ''));
    // With an explicit `expected`, wait until that many runs finish (ignores any
    // extra rows, e.g. a trifecta scan). Otherwise wait for all rows to settle.
    const done =
      expected != null
        ? terminal.length >= expected
        : runs.length > 0 && terminal.length === runs.length;
    if (done) return runs;
    // Throw rather than return partial results: a silent timeout used to
    // surface three frames later as `Cannot read properties of undefined`
    // on `reviews[0]`, which hid the real cause (a slow pre-review step).
    if (Date.now() - start > timeoutMs) {
      const seen = runs.map((r) => r.status ?? 'null').join(', ') || 'none';
      throw new Error(
        `waitForPrRuns timed out after ${timeoutMs}ms for pr ${prId}: ` +
          `${runs.length} run(s) [${seen}], expected ${expected ?? 'all'} terminal.`,
      );
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}
