"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Badge, Skeleton } from "@devdigest/ui";
import { usePrBrief } from "@/lib/hooks/brief";
import type { BriefFileRef, BriefFocusItem } from "@devdigest/shared";
import { s } from "./styles";

interface ReviewFocusProps {
  prId: string | null;
  /** Switches to the Files-changed tab and scrolls to this file's card —
   *  the only thing a file reference in this section ever does (references
   *  are inert text otherwise; no link is ever built from model text). */
  onJumpToFile: (path: string) => void;
}

function refKey(ref: BriefFileRef): string {
  return `${ref.path}:${ref.start_line ?? ""}:${ref.end_line ?? ""}:${ref.endpoint ?? ""}`;
}

function refLabel(ref: BriefFileRef): string {
  if (ref.start_line == null) return ref.path;
  if (ref.end_line == null || ref.end_line === ref.start_line) return `${ref.path}:${ref.start_line}`;
  return `${ref.path}:${ref.start_line}-${ref.end_line}`;
}

/** Identical references within one item collapse to one (mockup 6) — same
 *  `(path, start_line, end_line, endpoint)` tuple `groundBrief` already
 *  de-duplicates server-side; this only guards against a stale/legacy
 *  stored document that predates that guarantee. */
function dedupeRefs(refs: BriefFileRef[]): BriefFileRef[] {
  const seen = new Set<string>();
  const out: BriefFileRef[] = [];
  for (const ref of refs) {
    const key = refKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

/**
 * SPEC-02 "REVIEW FOCUS — READ THESE FIRST" (mockups 6-7) — an ordered list
 * of where to start reading this PR's diff, immediately below IntentCard on
 * the Overview tab. Reads the same brief IntentCard/BriefCard read
 * (`usePrBrief`, shared TanStack Query cache — no second fetch, no second
 * auto-start: BriefCard alone owns the generate-if-absent guard).
 */
export function ReviewFocus({ prId, onJumpToFile }: ReviewFocusProps) {
  const t = useTranslations("brief");
  const { data, isLoading } = usePrBrief(prId);

  if (!prId) return null;

  const items: BriefFocusItem[] = data?.status === "ready" ? (data.brief?.review_focus ?? []) : [];

  return (
    <section aria-label={t("focus.title")}>
      <SectionLabel icon="ListChecks" right={<Badge>{items.length}</Badge>}>
        {t("focus.title")}
      </SectionLabel>
      {isLoading ? (
        <Skeleton height={64} />
      ) : items.length === 0 ? (
        <div style={s.box}>
          <span style={s.empty}>{t("focus.empty")}</span>
        </div>
      ) : (
        <div style={s.box}>
          <ul style={s.list}>
            {items.map((item, i) => (
              <li key={`${item.refs[0]?.path ?? ""}-${i}`} style={s.item}>
                <span style={s.bullet}>›</span>
                <span style={s.itemText}>
                  {dedupeRefs(item.refs).map((ref, j) => (
                    <React.Fragment key={refKey(ref)}>
                      {j > 0 && <span style={s.refSep}>, </span>}
                      <button
                        type="button"
                        className="mono"
                        style={s.refButton}
                        onClick={() => onJumpToFile(ref.path)}
                        aria-label={t("fileRefAria", { ref: refLabel(ref) })}
                      >
                        {refLabel(ref)}
                      </button>
                    </React.Fragment>
                  ))}
                  <span style={s.reasonSep}> — </span>
                  {item.reason}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
