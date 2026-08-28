/* hooks/ci.ts — Export-to-CI + CI Runs (SPEC-05, L06 Phase C). One hook file
   for every CI-domain query/mutation, per client/CLAUDE.md ("one TanStack
   Query hook file per resource, the only place that talks to the API").

   Every `@devdigest/shared` import here is `import type` — a value import
   breaks `next build` even though `pnpm typecheck`/`pnpm test:unit` both stay
   green (client/insights.md, Tool & Library Notes 2026-08-22; plan constraint
   6). Nothing here calls `.parse()` on a vendored schema.

   `useRefreshCiRuns` and `useInstallCi` both carry
   `meta: { suppressErrorToast: true }` — the wizard and the CI Runs page own
   their own inline error UX and must `catch` the `mutateAsync` call
   themselves (client/insights.md, What Works 2026-08-22: an uncaught
   rejection surfaces as Next's runtime-error overlay in dev). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  CiExportInputBody,
  CiExportPreview,
  CiExport,
  CiInstallation,
  CiRefreshResult,
  CiRun,
  CiWorkflowValidation,
} from "@devdigest/shared";

// ---- reads --------------------------------------------------------------

export function useCiInstallations(agentId: string) {
  return useQuery({
    queryKey: ["ci", "installations", agentId],
    queryFn: () => api.get<CiInstallation[]>(`/agents/${agentId}/ci-installations`),
    enabled: !!agentId,
  });
}

export function useAgentCiRuns(agentId: string) {
  return useQuery({
    queryKey: ["ci", "agent-runs", agentId],
    queryFn: () => api.get<CiRun[]>(`/agents/${agentId}/ci-runs`),
    enabled: !!agentId,
  });
}

export function useCiRuns() {
  return useQuery({
    queryKey: ["ci", "runs"],
    queryFn: () => api.get<CiRun[]>("/ci/runs"),
  });
}

// ---- writes ---------------------------------------------------------------

export function useRefreshCiRuns() {
  const qc = useQueryClient();
  return useMutation({
    meta: { suppressErrorToast: true },
    mutationFn: () => api.post<CiRefreshResult>("/ci/refresh"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ci", "runs"] });
      qc.invalidateQueries({ queryKey: ["ci", "installations"] });
    },
  });
}

export function useCiExportPreview() {
  return useMutation({
    meta: { suppressErrorToast: true },
    mutationFn: ({ agentId, input }: { agentId: string; input: CiExportInputBody }) =>
      api.post<CiExportPreview>(`/agents/${agentId}/ci-export/preview`, input),
  });
}

export function useValidateWorkflow() {
  return useMutation({
    meta: { suppressErrorToast: true },
    mutationFn: (contents: string) =>
      api.post<CiWorkflowValidation>("/ci/workflow/validate", { contents }),
  });
}

export function useInstallCi() {
  const qc = useQueryClient();
  return useMutation({
    meta: { suppressErrorToast: true },
    mutationFn: ({ agentId, input }: { agentId: string; input: CiExportInputBody }) =>
      api.post<CiExport>(`/agents/${agentId}/ci-export/install`, input),
    onSuccess: (_data, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["ci", "runs"] });
      qc.invalidateQueries({ queryKey: ["ci", "installations", agentId] });
    },
  });
}
