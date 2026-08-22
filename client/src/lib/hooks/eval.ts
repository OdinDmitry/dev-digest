/* hooks/eval.ts — React Query hooks for the L06 eval pipeline: turning an
   accepted/dismissed finding into a frozen eval case, running an agent's whole
   case set, and reading back suite-run history/metrics. The only place that
   talks to the eval API (client/CLAUDE.md). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  EvalAgentSummary,
  EvalCaseCreate,
  EvalCaseDraft,
  EvalCaseRecord,
  EvalCaseUpdate,
  EvalSuiteRun,
  EvalSuiteRunDetail,
} from "@devdigest/shared";

/** An agent's own frozen case set. */
export function useAgentEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent", agentId, "eval-cases"],
    queryFn: () => api.get<EvalCaseRecord[]>(`/agents/${agentId}/eval-cases`),
    enabled: !!agentId,
  });
}

/** The draft a finding would become — file, range, cut fragment, the derived
 *  expectation kind (null when the finding is undecided), and the already-
 *  existing case for this finding, if any (AC-10). The query key is stable
 *  across openings of the same finding, but `expectation_kind` is derived
 *  from the finding's decision, which can change between openings (accept →
 *  dismiss) without the key changing. The draft is cheap, so it always
 *  refetches on mount rather than serving the global 30s-stale cache
 *  (`providers.tsx`) — a stale expectation type here is never correct. */
export function useEvalCaseDraft(findingId: string | null | undefined) {
  return useQuery({
    queryKey: ["finding", findingId, "eval-case-draft"],
    queryFn: () => api.get<EvalCaseDraft>(`/findings/${findingId}/eval-case-draft`),
    enabled: !!findingId,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export interface CreateEvalCaseInput {
  agentId: string;
  body: EvalCaseCreate;
}

export function useCreateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, body }: CreateEvalCaseInput) =>
      api.post<EvalCaseRecord>(`/agents/${agentId}/eval-cases`, body),
    onSuccess: (_data, { agentId, body }) => {
      qc.invalidateQueries({ queryKey: ["agent", agentId, "eval-cases"] });
      qc.invalidateQueries({ queryKey: ["finding", body.finding_id, "eval-case-draft"] });
    },
  });
}

export interface UpdateEvalCaseInput {
  id: string;
  agentId: string;
  patch: EvalCaseUpdate;
}

export function useUpdateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateEvalCaseInput) =>
      api.put<EvalCaseRecord>(`/eval-cases/${id}`, patch),
    onSuccess: (_data, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["agent", agentId, "eval-cases"] });
    },
  });
}

export interface DeleteEvalCaseInput {
  id: string;
  agentId: string;
}

export function useDeleteEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: DeleteEvalCaseInput) => api.del<{ ok: boolean }>(`/eval-cases/${id}`),
    onSuccess: (_data, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["agent", agentId, "eval-cases"] });
    },
  });
}

export interface VerifyEvalCaseInput {
  id: string;
  agentId: string;
}

/** Verify one case on its own — a single model call scored alone, never a
 *  run: it writes only the case's `latest_result` (AC-46). Invalidating the
 *  agent's case-set query is enough; no run query is touched, since a
 *  verification never appears in the run history and never moves a run's
 *  metrics (AC-49/AC-50). */
export function useVerifyEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: VerifyEvalCaseInput) => api.post<EvalCaseRecord>(`/eval-cases/${id}/verify`),
    onSuccess: (_data, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["agent", agentId, "eval-cases"] });
    },
  });
}

/** An agent's own suite-run history, newest first. Polls every 2s while any
 *  run in the list is `running` (Placement decision 10) — a completed run
 *  stops the poll on its own since the predicate goes false. */
export function useAgentEvalRuns(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent", agentId, "eval-runs"],
    queryFn: () => api.get<EvalSuiteRun[]>(`/agents/${agentId}/eval-runs`),
    enabled: !!agentId,
    refetchInterval: (query) =>
      (query.state.data ?? []).some((r) => r.status === "running") ? 2000 : false,
  });
}

/** One suite run's full detail, including its per-case results. */
export function useEvalRun(runId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-run", runId],
    queryFn: () => api.get<EvalSuiteRunDetail>(`/eval-runs/${runId}`),
    enabled: !!runId,
  });
}

/** Recent runs across every agent, of every status, newest first (AC-62).
 *  Polls every 2s while any run in the list is `running` — the same
 *  predicate `useAgentEvalRuns` already uses, needed now that this list can
 *  itself carry a `running` run. */
export function useRecentEvalRuns(limit = 20) {
  return useQuery({
    queryKey: ["eval-runs", "recent", limit],
    queryFn: () => api.get<EvalSuiteRun[]>(`/eval-runs?limit=${limit}`),
    refetchInterval: (query) =>
      (query.state.data ?? []).some((r) => r.status === "running") ? 2000 : false,
  });
}

/** One row per agent, each carrying its own most recent run of any status
 *  (or `null` when it has never been run) — AC-63. Powers the dashboard's
 *  agent summary list; unlike the run list this can never omit an agent
 *  whose last run fell off the `?limit=` window. */
export function useEvalAgentSummaries() {
  return useQuery({
    queryKey: ["eval-agents"],
    queryFn: () => api.get<EvalAgentSummary[]>(`/eval-agents`),
  });
}

/** Start a run over an agent's whole case set (AC-13/14). */
export function useStartEvalRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api.post<EvalSuiteRun>(`/agents/${agentId}/eval-runs`),
    onSuccess: (_data, agentId) => {
      qc.invalidateQueries({ queryKey: ["agent", agentId, "eval-runs"] });
      qc.invalidateQueries({ queryKey: ["eval-runs", "recent"] });
    },
  });
}
