import type { ContextAttachment, ContextDocument } from "@devdigest/shared";

/** Pure helpers for ContextAttachPanel — no I/O. */

export interface AttachRow {
  path: string;
  folder: string;
  attached: boolean;
  missing: boolean;
  tokenCount: number;
}

function folderOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

/**
 * Attached rows first (in the owner's stored order), then every other
 * discoverable document (in listing order) — mirrors SkillsTab's "linked
 * skills in prompt order, then unlinked ones" shape (`orderRows`). An
 * attached row whose document still exists in the discoverable listing gets
 * that listing's folder/token count; one that doesn't (AC-18) falls back to
 * the attachment's own stored token count and a folder derived from its path.
 */
export function buildRows(
  documents: ContextDocument[],
  attachments: ContextAttachment[],
): AttachRow[] {
  const docByPath = new Map(documents.map((d) => [d.path, d]));
  const attachedPaths = new Set(attachments.map((a) => a.path));

  const attachedRows: AttachRow[] = attachments.map((a) => {
    const doc = docByPath.get(a.path);
    return {
      path: a.path,
      folder: doc?.folder ?? folderOf(a.path),
      attached: true,
      missing: a.missing,
      tokenCount: doc?.token_count ?? a.token_count,
    };
  });

  const unattachedRows: AttachRow[] = documents
    .filter((d) => !attachedPaths.has(d.path))
    .map((d) => ({
      path: d.path,
      folder: d.folder,
      attached: false,
      missing: false,
      tokenCount: d.token_count,
    }));

  return [...attachedRows, ...unattachedRows];
}

/** Case-insensitive substring match on path. */
export function filterRows(rows: AttachRow[], filter: string): AttachRow[] {
  const q = filter.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => r.path.toLowerCase().includes(q));
}

/** Toggle one path in/out of the attached order. Attaching appends to the
 *  end of the current attached order; detaching removes it, preserving the
 *  relative order of everything else. */
export function toggleAttach(attachedPaths: readonly string[], path: string): string[] {
  return attachedPaths.includes(path)
    ? attachedPaths.filter((p) => p !== path)
    : [...attachedPaths, path];
}
