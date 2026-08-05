/* hooks/conventions.ts — React Query hooks for the repo-scoped Conventions
   Extractor (L02). Extraction is one synchronous POST (a single cheap-model
   call, not a run/SSE flow) — no polling needed. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  ConventionCandidate,
  ConventionExtractResult,
  ConventionMergePreview,
  ConventionStatus,
} from "@devdigest/shared";

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionCandidate[]>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

/** Run (or re-run) extraction. Replaces pending candidates; accepted/rejected survive. */
export function useExtractConventions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) =>
      api.post<ConventionExtractResult>(`/repos/${repoId}/conventions/extract`),
    onSuccess: (_data, repoId) => {
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
    },
  });
}

export interface UpdateConventionInput {
  id: string;
  repoId: string;
  patch: { rule?: string; category?: string | null; status?: ConventionStatus };
}

/**
 * Accept/reject/edit one candidate. Optimistic — Accept/Reject needs to feel
 * instant, same shape as `useSetAgentSkills`'s onMutate/onError-rollback/
 * onSettled-invalidate pattern.
 */
export function useUpdateConvention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateConventionInput) =>
      api.put<ConventionCandidate>(`/conventions/${id}`, patch),
    onMutate: async ({ id, repoId, patch }) => {
      await qc.cancelQueries({ queryKey: ["conventions", repoId] });
      const prev = qc.getQueryData<ConventionCandidate[]>(["conventions", repoId]);
      qc.setQueryData<ConventionCandidate[]>(["conventions", repoId], (list) =>
        list?.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      );
      return { prev };
    },
    onError: (_err, { repoId }, ctx) => {
      if (ctx?.prev) qc.setQueryData(["conventions", repoId], ctx.prev);
    },
    onSettled: (_d, _e, { repoId }) => {
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
    },
  });
}

export interface DeleteConventionInput {
  id: string;
  repoId: string;
}

/** Permanently remove one candidate (any status) — the manual "clear it" escape hatch. */
export function useDeleteConvention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: DeleteConventionInput) => api.del<{ ok: boolean }>(`/conventions/${id}`),
    onMutate: async ({ id, repoId }) => {
      await qc.cancelQueries({ queryKey: ["conventions", repoId] });
      const prev = qc.getQueryData<ConventionCandidate[]>(["conventions", repoId]);
      qc.setQueryData<ConventionCandidate[]>(["conventions", repoId], (list) =>
        list?.filter((c) => c.id !== id),
      );
      return { prev };
    },
    onError: (_err, { repoId }, ctx) => {
      if (ctx?.prev) qc.setQueryData(["conventions", repoId], ctx.prev);
    },
    onSettled: (_d, _e, { repoId }) => {
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
    },
  });
}

export interface MergeConventionsPreviewInput {
  repoId: string;
  conventionIds: string[];
}

/** Draft a skill body from the given (normally accepted) conventions. Writes nothing. */
export function useMergeConventionsPreview() {
  return useMutation({
    mutationFn: ({ repoId, conventionIds }: MergeConventionsPreviewInput) =>
      api.post<ConventionMergePreview>(`/repos/${repoId}/conventions/merge-preview`, {
        convention_ids: conventionIds,
      }),
  });
}
