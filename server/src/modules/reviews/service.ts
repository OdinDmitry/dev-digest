import type { Container } from '../../platform/container.js';
import type {
  AgentColumn,
  FindingActionKind,
  MultiAgentRun,
  RunEventKind,
  RunTrace,
} from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { AgentRow } from '../../db/rows.js';
import { ReviewRepository } from './repository.js';
import { type ReviewDto, type ReviewDtoFinding } from './helpers.js';
import { ReviewRunExecutor, type Logger } from './run-executor.js';
import { actOnFinding as actOnFindingImpl } from './findings.js';
import { reviewToDto, totalGroupDurationMs, runIdsOf, columnsFromRuns } from './helpers.js';
import { buildConflicts } from './multi-agent.js';

// Re-export DTO types + converters for backward-compatible imports from
// './service.js' (these previously lived here; logic now in ./helpers.ts).
export { findingRowToDto, reviewToDto } from './helpers.js';
export type { ReviewDto, ReviewDtoFinding } from './helpers.js';

/**
 * Review service (the core). Orchestrates:
 *   diff → assemblePrompt(system + repo-map + diff)
 *        → llm.completeStructured({ schema: Review }) (single-pass)
 *        → groundFindings(...) (citation gate — drops findings off the diff)
 *        → persist reviews + kept findings (+ grounding summary)
 *   while streaming RunEvents over container.runBus, and on completion writing
 *   the whole log as ONE RunTrace doc + an agent_runs row.
 *
 * Also: the finding accept/dismiss actions. The bulky run execution lives in
 * run-executor; this class keeps the public method surface.
 */
export class ReviewService {
  private repo: ReviewRepository;
  private agents: Container['agentsRepo'];
  private executor: ReviewRunExecutor;

  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);
    this.agents = container.agentsRepo;
    this.executor = new ReviewRunExecutor(container, this.repo, this.agents);
  }

  // ===========================================================================
  // Run a review for one or all enabled agents on a PR.
  // ===========================================================================

  /**
   * Resolve which agents to run. `all` → all enabled agents; `agentIds` →
   * each id resolved workspace-scoped, 404 on any miss, returned in the
   * order given (panel order); else a single agent.
   */
  async resolveTargets(
    workspaceId: string,
    opts: { agentId?: string; all?: boolean; agentIds?: string[] },
  ): Promise<AgentRow[]> {
    if (opts.all) return this.agents.listEnabled(workspaceId);
    if (opts.agentIds) {
      const resolved: AgentRow[] = [];
      for (const id of opts.agentIds) {
        const agent = await this.agents.getById(workspaceId, id);
        if (!agent) throw new NotFoundError('Agent not found');
        resolved.push(agent);
      }
      return resolved;
    }
    if (opts.agentId) {
      const agent = await this.agents.getById(workspaceId, opts.agentId);
      if (!agent) throw new NotFoundError('Agent not found');
      return [agent];
    }
    throw new AppError('invalid_run_request', 'Provide agentId or all:true', 400);
  }

  /** Delete a whole review run (one agent's pass) + its findings (cascade). */
  async deleteReview(workspaceId: string, reviewId: string): Promise<boolean> {
    return this.repo.deleteReview(workspaceId, reviewId);
  }

  /** In-flight runs for a PR (server-side source of truth, survives reload). */
  async activeRuns(workspaceId: string, prId: string) {
    return this.repo.activeRunsForPull(workspaceId, prId);
  }

  /** All runs for a PR (any status), newest first — the run history (incl. failures). */
  async listRuns(workspaceId: string, prId: string) {
    return this.repo.listRunsForPull(workspaceId, prId);
  }

  /** Delete one run from the history (+ its trace). */
  async deleteRun(workspaceId: string, runId: string): Promise<boolean> {
    return this.repo.deleteAgentRun(workspaceId, runId);
  }

  /**
   * Cancel an in-flight run. Signals a live runner to stop at its next
   * checkpoint AND marks the DB row cancelled + completes the bus immediately —
   * so cancel also works for ORPHANED runs (whose background process died on a
   * server restart) where signalling alone would do nothing.
   */
  async cancelRun(runId: string): Promise<void> {
    this.publish(runId, 'info', 'Cancellation requested — stopping…');
    this.container.runBus.cancel(runId);
    await this.repo.cancelRunIfRunning(runId);
    this.container.runBus.complete(runId);
  }

  /** Reap runs left 'running' by a previous (now-dead) process. Called on boot. */
  async reapStaleRuns(): Promise<number> {
    return this.repo.reapStaleRunningRuns();
  }

  /**
   * Run a review for each target agent. Each agent gets its own runId
   * (= agent_runs.id) created up-front so the SSE route can be subscribed
   * before/while the run progresses. A partial failure in one agent does not
   * abort the others.
   */
  async runReview(
    workspaceId: string,
    prId: string,
    targets: AgentRow[],
    logger?: Logger,
    multiAgentRunId?: string,
  ): Promise<{ runs: { run_id: string; agent_id: string; agent_name: string }[]; reviews: ReviewDto[] }> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    // Create the agent_run rows up front so a runId is available IMMEDIATELY —
    // the client persists these in global state and subscribes to the SSE
    // stream. The actual (slow) review runs in the background below.
    const runs: { run_id: string; agent_id: string; agent_name: string }[] = [];
    const jobs: { agent: AgentRow; runId: string }[] = [];
    for (const agent of targets) {
      const runId = await this.repo.createAgentRun({
        workspaceId,
        agentId: agent.id,
        prId,
        provider: agent.provider,
        model: agent.model,
        multiAgentRunId: multiAgentRunId ?? null,
      });
      runs.push({ run_id: runId, agent_id: agent.id, agent_name: agent.name });
      jobs.push({ agent, runId });
    }

    // Fire-and-forget: the HTTP response returns now with the runIds; reviews
    // are persisted as each agent finishes and the client refetches on SSE done.
    void this.executor.executeRuns(workspaceId, pull, repo, jobs, logger).catch((err) => {
      logger?.error({ prId, err: (err as Error).message }, 'review: background execution crashed');
    });

    return { runs, reviews: [] };
  }

  private publish(runId: string, kind: RunEventKind, msg: string, data?: unknown) {
    return this.container.runBus.publish(runId, kind, msg, data);
  }

  // ===========================================================================
  // Finding actions
  // ===========================================================================

  async actOnFinding(
    workspaceId: string,
    findingId: string,
    action: FindingActionKind,
  ): Promise<{ finding: ReviewDtoFinding }> {
    return actOnFindingImpl(this.repo, workspaceId, findingId, action);
  }

  // ===========================================================================
  // Reads
  // ===========================================================================

  async reviewsForPull(workspaceId: string, prId: string): Promise<ReviewDto[]> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const rows = await this.repo.reviewsForPull(prId);
    const names = new Map<string, string>();
    for (const { review } of rows) {
      if (review.agentId && !names.has(review.agentId)) {
        const a = await this.agents.getById(workspaceId, review.agentId);
        if (a) names.set(review.agentId, a.name);
      }
    }
    return rows.map(({ review, findings }) =>
      reviewToDto(review, findings, review.agentId ? names.get(review.agentId) : null),
    );
  }

  async getRunTrace(runId: string): Promise<RunTrace | undefined> {
    return this.repo.getRunTrace(runId);
  }

  // ===========================================================================
  // Multi-agent review
  // ===========================================================================

  /**
   * Start a multi-agent review: one `multi_agent_runs` group row, then the
   * chosen agents are dispatched through the existing `runReview` so every
   * agent run carries that group id.
   */
  async startMultiAgentReview(
    workspaceId: string,
    prId: string,
    agentIds: string[],
    logger?: Logger,
  ): Promise<{
    multi_agent_run_id: string;
    runs: { run_id: string; agent_id: string; agent_name: string }[];
  }> {
    const targets = await this.resolveTargets(workspaceId, { agentIds });
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const multiAgentRunId = await this.repo.createMultiAgentRun({ workspaceId, prId });
    const { runs } = await this.runReview(workspaceId, prId, targets, logger, multiAgentRunId);
    return { multi_agent_run_id: multiAgentRunId, runs };
  }

  /**
   * The latest multi-agent group for a PR: its columns (T11's mapper) and the
   * disagreement block derived from them (T6). `total_duration_ms` is the
   * group's own wall-clock — `max(finished_at) − ran_at` once every run is
   * terminal, else `now − ran_at` — never a sum of the columns' durations.
   */
  async multiAgentForPull(workspaceId: string, prId: string): Promise<MultiAgentRun | null> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const group = await this.repo.latestMultiAgentRunForPull(workspaceId, prId);
    if (!group) return null;

    const runRows = await this.repo.runsForMultiAgentRun(group.id);
    const reviews = await this.repo.reviewsByRunIds(runIdsOf(runRows));
    const columns: AgentColumn[] = columnsFromRuns(runRows, reviews);

    const conflicts = buildConflicts(columns);

    const costs = columns.map((c) => c.cost_usd).filter((c): c is number => c !== null);
    const total_cost_usd = costs.length > 0 ? costs.reduce((sum, c) => sum + c, 0) : null;

    const total_duration_ms = totalGroupDurationMs(group.ranAt, runRows);

    return {
      id: group.id,
      pr_id: group.prId,
      pr_number: pull.number,
      ran_at: group.ranAt.toISOString(),
      agent_count: columns.length,
      total_duration_ms,
      total_cost_usd,
      columns,
      conflicts,
    };
  }
}
