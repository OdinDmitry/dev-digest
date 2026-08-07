import type { WireRun, WireReview } from '../devdigest/wire.js';
import { resolveAgent, resolvePr, resolveRepo, ToolError } from '../devdigest/resolve.js';
import {
  filterFindings,
  pickLatestReview,
  projectFindings,
  renderReviewText,
  toFindingOut,
  truncateText,
} from '../project.js';
import { AgentArg, FileArg, PrArg, RepoArg, ReviewResult, RunIdArg, SeverityArg, FindingsLimitArg, DetailArg } from './schemas.js';
import {
  agentHasNoReviewMessage,
  DEFAULT_FINDING_LIMIT,
  findingsStillRunningNextStep,
  findingsTruncatedNextStep,
  MAX_SUMMARY_CHARS,
  noReviewsAtAllMessage,
  unknownRunIdMessage,
} from '../constants.js';
import { defineTool, renderToolError } from './types.js';

const TOOL_NAME = 'get_findings';

/** Shared by `WireReview` and `WireRun` — both carry `agent_id`/`agent_name`. */
function matchesAgent(
  row: { agent_id?: string | null; agent_name?: string | null },
  agent: { id: string; name: string },
): boolean {
  if (row.agent_name && row.agent_name.toLowerCase() === agent.name.toLowerCase()) return true;
  return row.agent_id === agent.id;
}

/**
 * §7 — the same flat triple as run_agent_on_pr, plus an optional `run_id`
 * pin so the handoff from a soft timeout is exact. Semantics are constraint
 * 11's: each agent's own most recent `kind: 'review'` row, undismissed
 * findings only — the ONE established meaning of "which findings count" in
 * this repo. Do not invent a third definition.
 */
export const getFindingsTool = defineTool({
  name: TOOL_NAME,
  title: 'Get findings from a completed review',
  description:
    'Get findings from a review that already completed for a pull request and agent. Use instead of re-running an agent.',
  inputSchema: {
    repo: RepoArg,
    pr: PrArg,
    agent: AgentArg,
    run_id: RunIdArg,
    severity: SeverityArg,
    file: FileArg,
    limit: FindingsLimitArg,
    detail: DetailArg,
  },
  outputSchema: ReviewResult.shape,
  annotations: { readOnlyHint: true, openWorldHint: false },
  async handler(args, { api }) {
    try {
      const repo = await resolveRepo(api, args.repo);
      const pr = await resolvePr(api, repo, args.pr);
      const agent = await resolveAgent(api, args.agent);

      const allReviews = await api.listReviews(pr.id);
      const reviewRows = allReviews.filter((r) => r.kind === 'review');
      const agentReviews = reviewRows.filter((r) => matchesAgent(r, agent));

      let review: WireReview | undefined;
      if (args.run_id) {
        review = agentReviews.find((r) => r.run_id === args.run_id);
        if (!review) {
          throw new ToolError(unknownRunIdMessage(args.run_id, pr.number, agent.name));
        }
      } else {
        review = pickLatestReview(agentReviews);
      }

      if (!review) {
        // No completed review for this agent — check for an in-flight run
        // before concluding there is none at all (§7's "running" path; this
        // second call is made only on this empty path).
        const runs: WireRun[] = await api.listRuns(pr.id);
        const activeRun = runs.find((r) => r.status === 'running' && matchesAgent(r, agent));
        if (activeRun) {
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
            run_id: activeRun.run_id,
            next_step: findingsStillRunningNextStep(repo.full_name, pr.number, agent.name),
          };
          return { content: [{ type: 'text', text: renderReviewText(result) }], structuredContent: result };
        }

        const reviewedAgentNames = [
          ...new Set(reviewRows.map((r) => r.agent_name).filter((n): n is string => !!n)),
        ];
        if (reviewedAgentNames.length > 0) {
          throw new ToolError(agentHasNoReviewMessage(agent.name, pr.number, reviewedAgentNames));
        }
        throw new ToolError(noReviewsAtAllMessage(pr.number));
      }

      let findings = projectFindings(review.findings);
      findings = filterFindings(findings, { severity: args.severity, file: args.file });
      const total = findings.length;
      const limit = args.limit ?? DEFAULT_FINDING_LIMIT;
      const shown = findings.slice(0, limit);
      const truncated = total > shown.length;
      const detail = args.detail ?? 'compact';

      const result: ReviewResult = {
        repo: repo.full_name,
        pr: pr.number,
        agent: agent.name,
        status: 'completed',
        verdict: review.verdict ?? null,
        score: review.score ?? null,
        summary: review.summary ? truncateText(review.summary, MAX_SUMMARY_CHARS) : null,
        findings_total: total,
        findings: shown.map((f) => toFindingOut(f, detail)),
        truncated,
        run_id: review.run_id ?? null,
        next_step: truncated ? findingsTruncatedNextStep(shown.length, total) : null,
      };
      return { content: [{ type: 'text', text: renderReviewText(result) }], structuredContent: result };
    } catch (err) {
      return renderToolError(err, TOOL_NAME);
    }
  },
});
