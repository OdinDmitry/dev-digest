/* hooks/smart-diff.ts — L03 Smart Diff. The only place that talks to
   GET /pulls/:id/smart-diff; SmartDiffViewer/DiffTab drive off this hook,
   never a raw fetch. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { SmartDiff } from "@devdigest/shared";

export const smartDiffKey = (prId: string | null | undefined) => ["pr-smart-diff", prId];

/** Deterministic, no-LLM file classification + finding refs for a PR. */
export function usePrSmartDiff(prId: string | null | undefined) {
  return useQuery({
    queryKey: smartDiffKey(prId),
    queryFn: () => api.get<SmartDiff>(`/pulls/${prId}/smart-diff`),
    enabled: !!prId,
  });
}
