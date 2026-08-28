/* lib/agent-estimates.ts — pure aggregation of per-agent duration/cost
   estimates into one figure for the multi-agent picker/configure-run screen.
   No React import. */
import type { AgentEstimate } from "@devdigest/shared";

export interface AggregateEstimate {
  /** Greatest available per-agent duration (agents run concurrently). */
  duration_ms: number | null;
  /** Sum of the available per-agent costs. */
  cost_usd: number | null;
  /** False when any selected agent is missing a duration or a cost. */
  complete: boolean;
}

export function aggregateEstimate(
  selectedAgentIds: string[],
  estimates: AgentEstimate[],
): AggregateEstimate {
  const byAgentId = new Map(estimates.map((e) => [e.agent_id, e]));

  let duration_ms: number | null = null;
  let cost_usd: number | null = null;
  let complete = selectedAgentIds.length > 0;

  for (const agentId of selectedAgentIds) {
    const estimate = byAgentId.get(agentId);
    const agentDuration = estimate?.duration_ms ?? null;
    const agentCost = estimate?.cost_usd ?? null;

    if (agentDuration === null || agentCost === null) complete = false;

    if (agentDuration !== null) {
      duration_ms = duration_ms === null ? agentDuration : Math.max(duration_ms, agentDuration);
    }
    if (agentCost !== null) {
      cost_usd = cost_usd === null ? agentCost : cost_usd + agentCost;
    }
  }

  return { duration_ms, cost_usd, complete };
}
