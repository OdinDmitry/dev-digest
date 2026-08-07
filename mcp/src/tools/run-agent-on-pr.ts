import type { DevDigestApi } from '../devdigest/api.js';
import { resolveAgent, resolvePr, resolveRepo, ToolError } from '../devdigest/resolve.js';
import { projectFindings, renderReviewText, toFindingOut, truncateText } from '../project.js';
import { AgentArg, PrArg, RepoArg, ReviewResult } from './schemas.js';
import {
  DEFAULT_FINDING_LIMIT,
  findingsTruncatedNextStep,
  MAX_SUMMARY_CHARS,
  noRunsStartedMessage,
  POLL_FAST_MS,
  POLL_FAST_WINDOW_MS,
  POLL_SLOW_MS,
  reviewMissingAfterDoneMessage,
  RUN_CANCELLED_MESSAGE,
  runFailedMessage,
  stillRunningNextStep,
} from '../constants.js';
import { defineTool, renderToolError } from './types.js';

const TOOL_NAME = 'run_agent_on_pr';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type RunOutcome =
  | { status: 'done' | 'failed' | 'cancelled'; error: string | null }
  | { status: 'running' };

/**
 * Poll `GET /pulls/:id/runs`, not the SSE stream (§6's "why polling"). Fast
 * interval for the first window, then slow, bounded by `budgetMs`. Never
 * throws for a still-running run — a budget-exceeded poll is a normal,
 * non-error outcome (the soft timeout, §6 step 7).
 */
async function pollUntilSettled(
  api: DevDigestApi,
  prId: string,
  runId: string,
  budgetMs: number,
): Promise<RunOutcome> {
  const start = Date.now();
  for (;;) {
    const runs = await api.listRuns(prId);
    const run = runs.find((r) => r.run_id === runId);
    const status = run?.status;
    if (status === 'done' || status === 'failed' || status === 'cancelled') {
      return { status, error: run?.error ?? null };
    }

    const elapsed = Date.now() - start;
    if (elapsed >= budgetMs) {
      return { status: 'running' };
    }
    const interval = elapsed < POLL_FAST_WINDOW_MS ? POLL_FAST_MS : POLL_SLOW_MS;
    await sleep(Math.min(interval, budgetMs - elapsed));
  }
}

/**
 * §6 — the only write tool. Exactly three flat required scalars; `agent` is
 * required (no "run all" mode — one run → one agent → one `{verdict,
 * findings[]}`, matching the codebase's own refusal to merge multi-agent
 * scores, `server/src/modules/pulls/routes.ts:119`).
 */
export const runAgentOnPrTool = defineTool({
  name: TOOL_NAME,
  title: 'Run a reviewer agent on a pull request',
  description:
    'Run a reviewer agent on a pull request and wait for the finished result; may take minutes. Use get_findings instead if the agent already reviewed it.',
  inputSchema: { repo: RepoArg, pr: PrArg, agent: AgentArg },
  outputSchema: ReviewResult.shape,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async handler(args, { api, runWaitBudgetMs }) {
    try {
      const repo = await resolveRepo(api, args.repo);
      const pr = await resolvePr(api, repo, args.pr);
      const agent = await resolveAgent(api, args.agent);

      const started = await api.startReview(pr.id, agent.id);
      const run = started.runs[0];
      if (!run) {
        throw new ToolError(noRunsStartedMessage(agent.name, pr.number));
      }

      const outcome = await pollUntilSettled(api, pr.id, run.run_id, runWaitBudgetMs);

      if (outcome.status === 'running') {
        const result: ReviewResult = {
          repo: repo.full_name,
          pr: pr.number,
          agent: agent.name,
          status: 'running',
          verdict: null,
          score: null,
          summary: null,
          findings_total: 0,
          findings: [],
          truncated: false,
          run_id: run.run_id,
          next_step: stillRunningNextStep(repo.full_name, pr.number, agent.name, run.run_id),
        };
        return { content: [{ type: 'text', text: renderReviewText(result) }], structuredContent: result };
      }
      if (outcome.status === 'failed') {
        throw new ToolError(runFailedMessage(outcome.error));
      }
      if (outcome.status === 'cancelled') {
        throw new ToolError(RUN_CANCELLED_MESSAGE);
      }

      // 'done' — the executor inserts the review row BEFORE flipping the run
      // to done (run-executor.ts:264 then :294), so it is guaranteed present.
      // If it is genuinely absent, that is a real inconsistency, not a retry.
      const reviews = await api.listReviews(pr.id);
      const review = reviews.find((r) => r.kind === 'review' && r.run_id === run.run_id);
      if (!review) {
        throw new ToolError(reviewMissingAfterDoneMessage(run.run_id, pr.number));
      }

      const allFindings = projectFindings(review.findings);
      const shown = allFindings.slice(0, DEFAULT_FINDING_LIMIT);
      const truncated = allFindings.length > shown.length;

      const result: ReviewResult = {
        repo: repo.full_name,
        pr: pr.number,
        agent: agent.name,
        status: 'completed',
        verdict: review.verdict ?? null,
        score: review.score ?? null,
        summary: review.summary ? truncateText(review.summary, MAX_SUMMARY_CHARS) : null,
        findings_total: allFindings.length,
        findings: shown.map((f) => toFindingOut(f, 'compact')),
        truncated,
        run_id: run.run_id,
        next_step: truncated ? findingsTruncatedNextStep(shown.length, allFindings.length) : null,
      };
      return { content: [{ type: 'text', text: renderReviewText(result) }], structuredContent: result };
    } catch (err) {
      return renderToolError(err, TOOL_NAME);
    }
  },
});
