/* hooks/brief.ts — SPEC-02 PR brief layer. The only place that talks to the
   /pulls/:id/brief*, /pulls/:id/brief/regenerate and /pulls/:id/run-summary
   API; BriefCard/IntentCard/ReviewFocus drive their auto-start guard and
   their "regenerate"/"recalculate" controls off these hooks' return values,
   never a raw fetch. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { BriefEnvelope, PrRunSummary } from "@devdigest/shared";

const briefKey = (prId: string | null | undefined) => ["pr-brief", prId];
const runSummaryKey = (prId: string | null | undefined) => ["pr-run-summary", prId];

/** Persisted brief for the PR's current head commit — pure read, no LLM
 *  call. `status: "absent"` until one is generated for this head SHA. */
export function usePrBrief(prId: string | null | undefined) {
  return useQuery({
    queryKey: briefKey(prId),
    queryFn: () => api.get<BriefEnvelope>(`/pulls/${prId}/brief`),
    enabled: !!prId,
  });
}

/** Generate-if-absent-for-this-head-SHA (server re-reads before spending a
 *  token); returns the existing brief unchanged if one is already
 *  persisted. Drives the card's ref-guarded auto-start only. */
export function useGenerateBrief() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prId: string) => api.post<BriefEnvelope>(`/pulls/${prId}/brief`),
    onSuccess: (data, prId) => qc.setQueryData(briefKey(prId), data),
  });
}

/** Always generates + replaces the whole stored brief — the "regenerate"
 *  entry point (brief card icon control AND the risk subsection's
 *  "Recalculate" control both call this one mutation). */
export function useRegenerateBrief() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prId: string) => api.post<BriefEnvelope>(`/pulls/${prId}/brief/regenerate`),
    onSuccess: (data, prId) => qc.setQueryData(briefKey(prId), data),
  });
}

/** The most recent completed review's verdict/finding-blocker counts/score,
 *  as one unit — pure read, no LLM call. `null` when the PR has no
 *  completed review yet. Fills in independently of the brief text. */
export function usePrRunSummary(prId: string | null | undefined) {
  return useQuery({
    queryKey: runSummaryKey(prId),
    queryFn: () => api.get<PrRunSummary | null>(`/pulls/${prId}/run-summary`),
    enabled: !!prId,
  });
}
