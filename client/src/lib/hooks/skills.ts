/* hooks/skills.ts — React Query hooks for the Skills library (L02).

   A skill is text-only: name, a directive description (its interface), a type
   and a markdown body. Editing the body versions the skill server-side. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Skill, SkillImportPreview, SkillSource, SkillType } from "@devdigest/shared";

export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: () => api.get<Skill[]>("/skills"),
  });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill", id],
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
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
  patch: Partial<Pick<Skill, "name" | "description" | "type" | "body" | "enabled">>;
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
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/skills/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.removeQueries({ queryKey: ["skill", id] });
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
