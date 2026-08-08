/* hooks/blast.ts — L04 Blast Radius. The only place that talks to
   GET /pulls/:id/blast; BlastTab drives off this hook, never a raw fetch. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { PrBlastRadius } from "@devdigest/shared";

export const blastKey = (prId: string | null | undefined) => ["pr-blast", prId];

/** Import-graph blast radius (changed symbols → callers → endpoints) for a PR. */
export function useBlastRadius(prId: string | null | undefined) {
  return useQuery({
    queryKey: blastKey(prId),
    queryFn: () => api.get<PrBlastRadius>(`/pulls/${prId}/blast`),
    enabled: !!prId,
  });
}
