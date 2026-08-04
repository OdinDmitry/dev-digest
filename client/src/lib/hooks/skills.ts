/* hooks/skills.ts — React Query hooks for the Skills library (L02).

   A skill is text-only: name, a directive description (its interface), a type
   and a markdown body. Editing the body versions the skill server-side. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  Skill,
  SkillImportPreview,
  SkillListStats,
  SkillSource,
  SkillType,
  SkillVersion,
  SkillVersionDetail,
} from "@devdigest/shared";

export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: () => api.get<Skill[]>("/skills"),
  });
}

// Intentionally unused today: `useSkills()` already returns full skill objects
// (bodies included), so the rail + detail pane read straight from that list.
// Wiring this in "for completeness" would double the request count for data
// already in hand — leave it be unless a future screen needs ONE skill
// without the rest of the list.
export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill", id],
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

/** Per-skill linked-agent rollup for the rail footer (one request for all). */
export function useSkillStats() {
  return useQuery({
    queryKey: ["skills", "stats"],
    queryFn: () => api.get<SkillListStats[]>("/skills/stats"),
    staleTime: 30_000,
  });
}

/** Body-version history for a skill, newest first — no body (see the route doc). */
export function useSkillVersions(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill", skillId, "versions"],
    queryFn: () => api.get<SkillVersion[]>(`/skills/${skillId}/versions`),
    enabled: !!skillId,
  });
}

/** One historical snapshot, WITH its body — fetched only when a diff or restore needs it. */
export function useSkillVersion(skillId: string | null | undefined, version: number | null | undefined) {
  return useQuery({
    queryKey: ["skill", skillId, "version", version],
    queryFn: () => api.get<SkillVersionDetail>(`/skills/${skillId}/versions/${version}`),
    enabled: !!skillId && version != null,
  });
}

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  source?: SkillSource;
  enabled?: boolean;
  evidence_files?: string[] | null;
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) => api.post<Skill>("/skills", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

export interface UpdateSkillInput {
  id: string;
  patch: Partial<Pick<Skill, "name" | "description" | "type" | "body" | "enabled">> & {
    /** "What changed?" — versions only alongside an actual body change; a
     *  note on any other patch is discarded server-side (see the route doc). */
    note?: string | null;
  };
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillInput) => api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
      // A skill's body/enabled state feeds every agent that links it, so the
      // agent-side link lists are stale too.
      qc.invalidateQueries({ queryKey: ["agent"] });
      // A body change may have written a new snapshot — refresh the tab.
      qc.invalidateQueries({ queryKey: ["skill", data.id, "versions"] });
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/skills/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.invalidateQueries({ queryKey: ["skills", "stats"] });
      qc.removeQueries({ queryKey: ["skill", id] });
      qc.invalidateQueries({ queryKey: ["agent"] });
    },
  });
}

export interface RestoreSkillVersionInput {
  skillId: string;
  version: number;
  note?: string | null;
}

/** Restore a historical body as a NEW version (history stays append-only). */
export function useRestoreSkillVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ skillId, version, note }: RestoreSkillVersionInput) =>
      api.post<Skill>(`/skills/${skillId}/versions/${version}/restore`, { note }),
    onSuccess: (data, { skillId }) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
      qc.invalidateQueries({ queryKey: ["skill", skillId, "versions"] });
      qc.invalidateQueries({ queryKey: ["agent"] });
    },
  });
}

export interface PreviewImportInput {
  filename: string;
  /** Markdown uploads travel as text; archives as base64 in `content_base64`. */
  content?: string;
  content_base64?: string;
}

/**
 * Parse an upload server-side and return what WOULD be created. Nothing is
 * persisted — the user confirms the preview, and the drawer then calls
 * `useCreateSkill` with the confirmed values.
 */
export function usePreviewSkillImport() {
  return useMutation({
    mutationFn: (input: PreviewImportInput) =>
      api.post<SkillImportPreview>("/skills/import/preview", input),
  });
}
