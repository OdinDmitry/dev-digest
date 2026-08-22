import type { FastifyInstance } from 'fastify';
import type { EvalRun } from '@devdigest/shared';

/**
 * Polls `GET /eval-runs/:id` until the run reaches a terminal `state`
 * (`completed`/`failed`). Mirrors `waitForPrRuns` (`test/helpers/runs.ts`):
 * NEVER returns a partial/still-in-flight run on timeout — it throws, with
 * the last observed state, the case-level progress (`cases_done`/
 * `cases_total`, derived from `per_trace` since the run DTO does not expose
 * `casesDone` directly) and every case's own status, so a caller sees WHERE
 * a run got stuck instead of a generic assertion failure three lines later
 * (`server/insights.md` 2026-08-07 on `waitForPrRuns`).
 */
const TERMINAL = new Set(['completed', 'failed']);

export async function waitForEvalRun(
  app: FastifyInstance,
  runId: string,
  opts: { timeoutMs?: number } = {},
): Promise<EvalRun> {
  const { timeoutMs = 20_000 } = opts;
  const start = Date.now();
  for (;;) {
    const res = await app.inject({ method: 'GET', url: `/eval-runs/${runId}` });
    if (res.statusCode !== 200) {
      throw new Error(
        `waitForEvalRun: GET /eval-runs/${runId} returned ${res.statusCode}: ${res.payload}`,
      );
    }
    const run = res.json() as EvalRun;
    if (TERMINAL.has(run.state)) return run;

    if (Date.now() - start > timeoutMs) {
      const casesDone = run.per_trace.filter((t) => t.status !== 'pending').length;
      const statuses = run.per_trace.map((t) => `${t.name || t.case_id}:${t.status}`).join(', ') || 'none';
      throw new Error(
        `waitForEvalRun timed out after ${timeoutMs}ms for run ${runId}: state=${run.state}, ` +
          `cases_done=${casesDone}/${run.traces_total}, per_trace=[${statuses}]`,
      );
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}
