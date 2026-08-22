/* hooks/evals.ts — Eval Dashboard + agent-editor Evals tab + finding
   "Turn into eval case" flow (SPEC-03, L06). Covers eval-case CRUD, the
   finding-seed prefill, suite runs (start/poll/history), run comparison and
   the workspace dashboard. All calls go through `api` (F1 client) — nothing
   here calls `fetch` directly. */
"use client";

import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  EvalCase,
  EvalCaseInput,
  EvalCaseSeed,
  EvalCaseUpdate,
  EvalComparison,
  EvalDashboard,
  EvalRun,
  EvalRunRecord,
  EvalRunResult,
} from "@devdigest/shared";

/** A run is "terminal" once it can no longer change: no active run (`null`),
   or a run whose state has settled to completed/failed. `undefined` (not
   fetched yet) is deliberately treated as non-terminal so the very first
   poll interval isn't suppressed, and so a queryKey change that resets
   `data` to `undefined` mid-poll doesn't read as a false "just finished". */
function isTerminal(run: EvalRun | null | undefined): boolean {
  if (run === undefined) return false;
  if (run === null) return true;
  return run.state === "completed" || run.state === "failed";
}

/** Cases/history/dashboard all summarize outcomes from the same suite run —
   refresh all three once a run settles, so nothing needs a reload. */
function invalidateOnCompletion(
  qc: ReturnType<typeof useQueryClient>,
  agentId: string,
) {
  qc.invalidateQueries({ queryKey: ["evals", "cases", agentId] });
  qc.invalidateQueries({ queryKey: ["evals", "runs", agentId] });
  qc.invalidateQueries({ queryKey: ["evals", "dashboard"] });
}

// ---- reads -----------------------------------------------------------

export function useAgentEvalCases(agentId: string) {
  return useQuery({
    queryKey: ["evals", "cases", agentId],
    queryFn: () => api.get<EvalCase[]>(`/agents/${agentId}/eval-cases`),
    enabled: !!agentId,
  });
}

export function useEvalCaseSeed(findingId: string | null) {
  return useQuery({
    queryKey: ["evals", "seed", findingId],
    queryFn: () => api.get<EvalCaseSeed>(`/findings/${findingId}/eval-case-seed`),
    enabled: findingId != null,
  });
}

export function useEvalDashboard() {
  return useQuery({
    queryKey: ["evals", "dashboard"],
    queryFn: () => api.get<EvalDashboard>("/evals/dashboard"),
  });
}

export function useAgentEvalRuns(agentId: string) {
  return useQuery({
    queryKey: ["evals", "runs", agentId],
    queryFn: () => api.get<EvalRunRecord[]>(`/agents/${agentId}/eval-runs`),
    enabled: !!agentId,
  });
}

export function useActiveEvalRun(agentId: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["evals", "active", agentId],
    queryFn: () => api.get<EvalRun | null>(`/agents/${agentId}/eval-runs/active`),
    enabled: !!agentId,
    // AC-24: poll every 1.5s while a run is in flight, stop once terminal.
    refetchInterval: (q) => (isTerminal(q.state.data as EvalRun | null | undefined) ? false : 1500),
  });

  // AC-26: the moment this query's own data settles from non-terminal to
  // terminal, refresh the case outcomes + history + dashboard that
  // summarize the run that just finished — no reload needed.
  const wasTerminal = React.useRef(true);
  React.useEffect(() => {
    const terminal = isTerminal(query.data);
    if (!wasTerminal.current && terminal) invalidateOnCompletion(qc, agentId);
    wasTerminal.current = terminal;
  }, [query.data, qc, agentId]);

  return query;
}

export function useEvalRun(runId: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["evals", "run", runId],
    queryFn: () => api.get<EvalRun>(`/eval-runs/${runId}`),
    enabled: runId != null,
    refetchInterval: (q) => (isTerminal(q.state.data as EvalRun | undefined) ? false : 1500),
  });

  const wasTerminal = React.useRef(true);
  React.useEffect(() => {
    const terminal = isTerminal(query.data);
    if (!wasTerminal.current && terminal && query.data) {
      invalidateOnCompletion(qc, query.data.agent_id);
    }
    wasTerminal.current = terminal;
  }, [query.data, qc]);

  return query;
}

export function useEvalComparison(agentId: string, a: string | null, b: string | null) {
  return useQuery({
    queryKey: ["evals", "compare", agentId, a, b],
    queryFn: () =>
      api.get<EvalComparison>(`/agents/${agentId}/eval-compare?a=${a}&b=${b}`),
    enabled: !!agentId && a != null && b != null,
  });
}

// ---- writes ------------------------------------------------------------

export function useCreateEvalCase(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { suppressErrorToast: true },
    mutationFn: (input: EvalCaseInput) =>
      api.post<EvalCase>(`/agents/${agentId}/eval-cases`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["evals", "cases", agentId] }),
  });
}

export function useCreateEvalCaseFromFinding(findingId: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { suppressErrorToast: true },
    mutationFn: (input: EvalCaseInput) =>
      api.post<EvalCase>(`/findings/${findingId}/eval-case`, input),
    onSuccess: (data) =>
      qc.invalidateQueries({ queryKey: ["evals", "cases", data.owner_id] }),
  });
}

export function useUpdateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    meta: { suppressErrorToast: true },
    mutationFn: ({ id, patch }: { id: string; patch: EvalCaseUpdate }) =>
      api.put<EvalCase>(`/eval-cases/${id}`, patch),
    onSuccess: (data) =>
      qc.invalidateQueries({ queryKey: ["evals", "cases", data.owner_id] }),
  });
}

export function useDeleteEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => api.del<void>(`/eval-cases/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["evals", "cases"] }),
  });
}

export function usePreviewEvalCase() {
  return useMutation({
    meta: { suppressErrorToast: true },
    mutationFn: ({ id }: { id: string }) =>
      api.post<EvalRunResult>(`/eval-cases/${id}/preview`),
  });
}

export function useStartEvalRun(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EvalRun>(`/agents/${agentId}/eval-runs`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["evals", "active", agentId] }),
  });
}

export function useRunAllAgents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ runs: EvalRun[] }>("/evals/run-all"),
    onSuccess: (data) => {
      for (const run of data.runs) {
        qc.invalidateQueries({ queryKey: ["evals", "active", run.agent_id] });
      }
      qc.invalidateQueries({ queryKey: ["evals", "dashboard"] });
    },
  });
}
