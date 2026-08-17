import type { ContextDocument } from "@devdigest/shared";

/** Pure helpers for the Project Context page — no I/O. */

/** Case-insensitive substring match against the full repository-relative path. */
export function filterDocuments(documents: ContextDocument[], filter: string): ContextDocument[] {
  const q = filter.trim().toLowerCase();
  if (!q) return documents;
  return documents.filter((d) => d.path.toLowerCase().includes(q));
}

export interface FolderGroup {
  folder: string;
  documents: ContextDocument[];
}

/** Group by containing folder ('' — repo root — sorts first), documents
 *  sorted by path within each folder (spec Contracts — discoverable set
 *  ordering). */
export function groupByFolder(documents: ContextDocument[]): FolderGroup[] {
  const byFolder = new Map<string, ContextDocument[]>();
  for (const doc of documents) {
    const list = byFolder.get(doc.folder) ?? [];
    list.push(doc);
    byFolder.set(doc.folder, list);
  }
  const folders = [...byFolder.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return folders.map((folder) => ({
    folder,
    documents: [...(byFolder.get(folder) ?? [])].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    ),
  }));
}

/** File name — the last path segment. */
export function fileName(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

/** Coarse "Xh ago" / "Xm ago" / "just now" — no i18n library needed for this
 *  (mirrors conventions/_components/ConventionsView/helpers.ts). */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const seconds = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
