/* hooks/intent.ts — L03 intent layer. The only place that talks to the
   /pulls/:id/intent* API; IntentCard drives its lazy-compute-once guard off
   these hooks' return values, never a raw fetch. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { PrIntentRecord } from "@devdigest/shared";

const intentKey = (prId: string | null | undefined) => ["pr-intent", prId];

/** Persisted intent for a PR — pure read, no LLM call. `null` until computed. */
export function usePrIntent(prId: string | null | undefined) {
  return useQuery({
    queryKey: intentKey(prId),
    queryFn: () => api.get<PrIntentRecord | null>(`/pulls/${prId}/intent`),
    enabled: !!prId,
  });
}

/** Compute-if-absent (server re-reads before spending a token); returns the
 *  existing row unchanged if one is already persisted. */
export function useComputeIntent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prId: string) => api.post<PrIntentRecord>(`/pulls/${prId}/intent`),
    // No optimistic update — there is nothing to guess ahead of the model call.
    onSuccess: (data, prId) => qc.setQueryData(intentKey(prId), data),
  });
}

/** Always recomputes + upserts — the "the PR was updated" escape hatch. */
export function useRecomputeIntent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prId: string) => api.post<PrIntentRecord>(`/pulls/${prId}/intent/recompute`),
    onSuccess: (data, prId) => qc.setQueryData(intentKey(prId), data),
  });
}
