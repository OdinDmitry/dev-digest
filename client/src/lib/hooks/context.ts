/* hooks/context.ts — React Query hooks for Project Context (browse/preview/attach). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  ContextAttachment,
  ContextAttachmentSet,
  ContextDocumentText,
  ContextListing,
  ContextOwnerKind,
} from "@devdigest/shared";

/** The discoverable document set for one repository. */
export function useContextDocuments(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["context", "documents", repoId],
    queryFn: () => api.get<ContextListing>(`/repos/${repoId}/context/documents`),
    enabled: !!repoId,
  });
}

/** One document's rendered text, fetched only when requested (preview). */
export function useContextDocument(
  repoId: string | null | undefined,
  path: string | null | undefined,
  opts?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ["context", "document", repoId, path],
    queryFn: () =>
      api.get<ContextDocumentText>(
        `/repos/${repoId}/context/document?path=${encodeURIComponent(path as string)}`,
      ),
    enabled: !!repoId && !!path && (opts?.enabled ?? true),
  });
}

/** An owner's (agent's or skill's) attached set, with per-attachment token counts. */
export function useOwnerContext(kind: ContextOwnerKind, ownerId: string | null | undefined) {
  return useQuery({
    queryKey: ["context", kind, ownerId],
    queryFn: () => api.get<ContextAttachmentSet>(`/${kind}s/${ownerId}/context`),
    enabled: !!ownerId,
  });
}

export interface SetOwnerContextInput {
  kind: ContextOwnerKind;
  ownerId: string;
  repoId: string;
  /** The full ordered set — index becomes each attachment's `order`. */
  paths: string[];
}

/**
 * Attach/detach and reorder an owner's documents. Optimistic — modeled
 * line-for-line on `useSetAgentSkills` (hooks/agents.ts): the footer token
 * total must move immediately, with no run started (AC-10), and
 * `cancelQueries` first stops an in-flight GET from resurrecting the
 * pre-drag order (client/insights.md 2026-08-04).
 */
export function useSetOwnerContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, ownerId, repoId, paths }: SetOwnerContextInput) =>
      api.put<ContextAttachmentSet>(`/${kind}s/${ownerId}/context`, {
        repo_id: repoId,
        paths,
      }),
    onMutate: async ({ kind, ownerId, repoId, paths }) => {
      // Not optional: an in-flight GET that lands after this write would
      // resurrect the pre-toggle/pre-drag order.
      await qc.cancelQueries({ queryKey: ["context", kind, ownerId] });
      const prev = qc.getQueryData<ContextAttachmentSet>(["context", kind, ownerId]);
      if (prev) {
        const byPath = new Map(prev.attachments.map((a) => [a.path, a]));
        // A path just toggled ON has no entry in `prev.attachments` yet, so
        // its real token count is looked up from the documents-listing cache
        // (the same source `buildRows` uses for each row's count) instead of
        // a `0` placeholder — otherwise the footer total doesn't move on a
        // fresh attach while the PUT is pending (AC-10).
        const listing = qc.getQueryData<ContextListing>(["context", "documents", repoId]);
        const docByPath = new Map(listing?.documents.map((d) => [d.path, d.token_count]) ?? []);
        const attachments: ContextAttachment[] = paths.map((path, order) => {
          const existing = byPath.get(path);
          return existing
            ? { ...existing, order }
            : {
                owner_kind: kind,
                owner_id: ownerId,
                repo_id: repoId,
                path,
                order,
                missing: false,
                token_count: docByPath.get(path) ?? 0,
              };
        });
        const total_tokens = attachments.reduce((sum, a) => sum + a.token_count, 0);
        qc.setQueryData<ContextAttachmentSet>(["context", kind, ownerId], {
          ...prev,
          attachments,
          total_tokens,
          over_budget: total_tokens > prev.budget,
        });
      }
      return { prev };
    },
    onError: (_err, { kind, ownerId }, ctx) => {
      if (ctx?.prev) qc.setQueryData(["context", kind, ownerId], ctx.prev);
    },
    onSettled: (_d, _e, { kind, ownerId, repoId }) => {
      qc.invalidateQueries({ queryKey: ["context", kind, ownerId] });
      // Usage counts move on every attach/detach.
      qc.invalidateQueries({ queryKey: ["context", "documents", repoId] });
    },
  });
}
