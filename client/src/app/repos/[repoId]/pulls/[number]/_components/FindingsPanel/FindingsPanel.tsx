/* FindingsPanel — hide-low-confidence + j/k navigation + FindingCard list,
   wiring the accept/dismiss action hook (A2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, EmptyState } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import type { SeverityKey } from "../../../_components/SeverityCounts";
import { FindingCard } from "@/components/finding-card/FindingCard";
import { useFindingAction } from "../../../../../../../lib/hooks/reviews";
import { KEY_TO_ACTION } from "./constants";
import { visibleFindings } from "./helpers";
import { s } from "./styles";

export function FindingsPanel({
  findings,
  prId,
  repoFullName,
  headSha,
  severityFilter,
  targetFindingId = null,
  targetFindingNonce = 0,
}: {
  findings: FindingRecord[];
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
  /** Page-level severity click-filter (from FindingsTab's aggregate counter). */
  severityFilter?: SeverityKey | null;
  /** Finding-level navigation target (Smart Diff marker → Agent runs tab, §10).
   *  When it matches a finding in `findings`, this panel reveals + scrolls to
   *  it, clearing the `hideLow` filter first if that's what was hiding it. */
  targetFindingId?: string | null;
  targetFindingNonce?: number;
}) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const [hideLow, setHideLow] = React.useState(false);
  const [focusIdx, setFocusIdx] = React.useState(0);

  const shown = React.useMemo(
    () => visibleFindings(findings, hideLow, severityFilter),
    [findings, hideLow, severityFilter],
  );

  // Finding-level navigation target: reveal + scroll to it. Only fires once
  // the owning accordion is open (this panel doesn't render until then), so
  // no requestAnimationFrame/setTimeout sequencing is needed. A no-op when
  // the id matches nothing here (e.g. a stale/empty `findings`).
  React.useEffect(() => {
    if (!targetFindingId) return;
    const idx = shown.findIndex((f) => f.id === targetFindingId);
    if (idx !== -1) {
      setFocusIdx(idx);
      document
        .getElementById(`finding-${targetFindingId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    // Present in the full list but hidden by the low-confidence filter —
    // clear it; the effect re-fires once `shown` updates and takes the
    // branch above.
    if (findings.some((f) => f.id === targetFindingId)) setHideLow(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetFindingId, targetFindingNonce, shown]);

  // j/k navigation + a/d shortcuts on the focused finding (keyboard).
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "j") setFocusIdx((i) => Math.min(i + 1, shown.length - 1));
      else if (e.key === "k") setFocusIdx((i) => Math.max(i - 1, 0));
      else if (KEY_TO_ACTION[e.key] && shown[focusIdx]) {
        action.mutate({ findingId: shown[focusIdx]!.id, action: KEY_TO_ACTION[e.key]!, prId });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shown, focusIdx, action, prId]);

  return (
    <div>
      <div style={s.toolbar}>
        <div style={s.toggleGroup}>
          {t("panel.hideLowConfidence")}
          <Toggle on={hideLow} onChange={setHideLow} size={16} />
        </div>
      </div>

      <div style={s.list}>
        {shown.length === 0 ? (
          <EmptyState icon="Filter" title={t("panel.noMatchTitle")} body={t("panel.noMatchBody")} />
        ) : (
          shown.map((f, i) => (
            <FindingCard
              key={f.id}
              f={f}
              focused={i === focusIdx}
              defaultExpanded={i === 0}
              pending={action.isPending}
              repoFullName={repoFullName}
              headSha={headSha}
              onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
            />
          ))
        )}
      </div>
    </div>
  );
}
