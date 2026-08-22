/* hooks/agents.ts — React Query hooks for the A2 Agents tab + Agent Editor. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import type {
  Agent,
  AgentListStats,
  AgentSkillLink,
  AgentVersion,
  ModelInfo,
  Provider,
  ReviewStrategy,
} from "@devdigest/shared";

export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: () => api.get<Agent[]>("/agents"),
  });
}

export function useAgent(id: string | null | undefined) {
  return useQuery({
    queryKey: ["agent", id],
    queryFn: () => api.get<Agent>(`/agents/${id}`),
    enabled: !!id,
  });
}

export interface CreateAgentInput {
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  system_prompt: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  enabled?: boolean;
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAgentInput) => api.post<Agent>("/agents", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] }),
  });
}

export interface UpdateAgentInput {
  id: string;
  patch: Partial<
    Pick<
      Agent,
      | "name"
      | "description"
      | "provider"
      | "model"
      | "system_prompt"
      | "output_schema"
      | "strategy"
      | "ci_fail_on"
      | "repo_intel"
      | "enabled"
    >
  >;
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateAgentInput) => api.put<Agent>(`/agents/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.setQueryData(["agent", data.id], data);
    },
  });
}

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/agents/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.removeQueries({ queryKey: ["agent", id] });
    },
  });
}

/** Per-agent skill/run/cost rollup for the list cards (one request for all). */
export function useAgentStats() {
  return useQuery({
    queryKey: ["agents", "stats"],
    queryFn: () => api.get<AgentListStats[]>("/agents/stats"),
    staleTime: 30_000,
  });
}

/** Skills linked to an agent, in prompt order. */
export function useAgentSkills(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent", agentId, "skills"],
    queryFn: () => api.get<AgentSkillLink[]>(`/agents/${agentId}/skills`),
    enabled: !!agentId,
  });
}

export interface SetAgentSkillsInput {
  agentId: string;
  /** The full ordered set — index becomes `agent_skills.order`. */
  skillIds: string[];
}

/**
 * Attach/detach and reorder an agent's skills.
 *
 * The only optimistic mutation in the app, and deliberately so: the Skills tab
 * reorders by drag, and a list that snapped back to the server's order for the
 * duration of a round-trip would be unusable.
 */
export function useSetAgentSkills() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, skillIds }: SetAgentSkillsInput) =>
      api.post<AgentSkillLink[]>(`/agents/${agentId}/skills`, { skill_ids: skillIds }),
    onMutate: async ({ agentId, skillIds }) => {
      // Not optional: an in-flight GET that lands after this write would
      // resurrect the pre-drag order.
      await qc.cancelQueries({ queryKey: ["agent", agentId, "skills"] });
      const prev = qc.getQueryData<AgentSkillLink[]>(["agent", agentId, "skills"]);
      qc.setQueryData<AgentSkillLink[]>(
        ["agent", agentId, "skills"],
        skillIds.map((skill_id, order) => ({ agent_id: agentId, skill_id, order })),
      );
      return { prev };
    },
    onError: (_err, { agentId }, ctx) => {
      if (ctx?.prev) qc.setQueryData(["agent", agentId, "skills"], ctx.prev);
    },
    onSettled: (_d, _e, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["agent", agentId, "skills"] });
      // The agent card's "N skills" badge comes from this rollup, and the
      // skills rail's "N agents" footer is the same link table grouped the
      // other way — both go stale on any attach/detach.
      qc.invalidateQueries({ queryKey: ["agents", "stats"] });
      qc.invalidateQueries({ queryKey: ["skills", "stats"] });
    },
  });
}

/**
 * One historical config snapshot for an agent (the eval-run compare dialog's
 * prompt diff, AC-32). A version that no longer exists resolves to `null`
 * rather than throwing — it's a rendered state ("cannot be shown"), not an
 * error, and the caller branches on `data === null` vs `isLoading`.
 */
export function useAgentVersion(agentId: string | null | undefined, version: number | null | undefined) {
  return useQuery({
    queryKey: ["agent", agentId, "version", version],
    queryFn: async () => {
      try {
        return await api.get<AgentVersion>(`/agents/${agentId}/versions/${version}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    enabled: !!agentId && version != null,
  });
}

/** Dynamic model list for a provider (editor model picker). */
export function useProviderModels(provider: Provider | null | undefined) {
  return useQuery({
    queryKey: ["provider-models", provider],
    queryFn: () => api.get<ModelInfo[]>(`/providers/${provider}/models`),
    enabled: !!provider,
    staleTime: 5 * 60_000,
  });
}
