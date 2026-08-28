/* hooks/multi-agent.ts — React Query hooks for the multi-agent review feature
   (agent duration/cost estimates, the group's results, starting a run). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { AgentEstimate, MultiAgentRun } from "@devdigest/shared";

// ---- Per-agent duration/cost estimate, from each agent's last successful run ----
export function useAgentEstimates() {
  return useQuery({
    queryKey: ["agent-estimates"],
    queryFn: () => api.get<AgentEstimate[]>("/agents/estimates"),
  });
}

// ---- The latest multi-agent group for a PR (columns + conflicts) ----
/** Polls while any column is still `running` — mirrors `usePrRuns`. */
export function useMultiAgentRun(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["multi-agent", prId],
    queryFn: () => api.get<MultiAgentRun | null>(`/pulls/${prId}/multi-agent`),
    enabled: !!prId,
    refetchInterval: (query) =>
      (query.state.data?.columns ?? []).some((c) => c.status === "running") ? 4000 : false,
  });
}

// ---- Start a multi-agent review ----
export interface StartMultiAgentReviewInput {
  prId: string;
  agentIds: string[];
}

export interface StartMultiAgentReviewResponse {
  multi_agent_run_id: string;
  runs: { run_id: string; agent_id: string; agent_name: string }[];
}

export function useStartMultiAgentReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prId, agentIds }: StartMultiAgentReviewInput) =>
      api.post<StartMultiAgentReviewResponse>(`/pulls/${prId}/multi-agent-run`, {
        agent_ids: agentIds,
      }),
    onSuccess: (_d, { prId }) => {
      qc.invalidateQueries({ queryKey: ["multi-agent", prId] });
      qc.invalidateQueries({ queryKey: ["pr-active-runs", prId] });
    },
  });
}
