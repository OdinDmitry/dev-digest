"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Skeleton, Button } from "@devdigest/ui";
import { usePrIntent, useComputeIntent, useRecomputeIntent } from "../../../../../../../lib/hooks/intent";
import { usePrBrief, useRegenerateBrief } from "@/lib/hooks/brief";
import { ApiError } from "../../../../../../../lib/api";
import { sortRisks } from "./helpers";
import { RiskRow } from "./RiskRow";
import { s } from "./styles";

interface IntentCardProps {
  prId: string | null;
  /** Switches to the Files-changed tab and scrolls to this file's card —
   *  every risk-area file reference goes through here, mirroring BlastTab's
   *  `onJumpToFile` (client/insights.md 2026-08-05: state lives in page.tsx,
   *  the ancestor that outlives both this tab and the Files-changed tab). */
  onJumpToFile: (path: string) => void;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError || err instanceof Error ? err.message : fallback;
}

/**
 * Derived PR intent/scope (L03), shown above Description on the Overview tab
 * so the user can verify the system understood the task before reading
 * findings. Lazy: mounts → reads the persisted row (no LLM); if none exists,
 * fires ONE auto-compute per PR per mount (ref-guarded — a refetch/re-render
 * can never fan out into repeated model calls). A "Recompute" button is the
 * manual "the PR changed" escape hatch.
 */
export function IntentCard({ prId, onJumpToFile }: IntentCardProps) {
  const t = useTranslations("brief");
  const { data, isLoading, error } = usePrIntent(prId);
  const computeMutation = useComputeIntent();
  const recomputeMutation = useRecomputeIntent();

  // RISK AREAS subsection (SPEC-02, mockups 3-5) reads the SAME brief the
  // Overview tab's BriefCard reads (`["pr-brief", prId]` — one shared
  // TanStack Query cache entry, no second fetch) and shares its regenerate
  // mutation's endpoint: BriefCard's icon control and this subsection's
  // "Recalculate" control are two entry points into the same rebuild, not
  // two different ones.
  const { data: briefEnvelope, isLoading: briefLoading } = usePrBrief(prId);
  const regenerateMutation = useRegenerateBrief();
  const [expandedRisks, setExpandedRisks] = React.useState<ReadonlySet<string>>(new Set());
  const toggleRisk = (key: string) =>
    setExpandedRisks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const risks = sortRisks(
    briefEnvelope?.status === "ready" ? (briefEnvelope.brief?.risks ?? []) : [],
  );

  // Once-per-PR-per-mount guard, keyed on prId so navigating to a different
  // PR resets it — a refetch/re-render of this component must never trigger
  // a second model call for the SAME PR.
  const firedForRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!prId || isLoading || data !== null || firedForRef.current === prId) return;
    firedForRef.current = prId;
    computeMutation.mutate(prId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prId, data, isLoading]);

  if (!prId) return null;

  if (isLoading) {
    return (
      <section>
        <SectionLabel icon="Target">Intent</SectionLabel>
        <Skeleton height={64} />
      </section>
    );
  }

  // Error UX: no toast, no full-screen error — a PR page must stay usable
  // with no LLM key configured. A quiet inline empty state with a retry.
  if (error || computeMutation.isError) {
    const message = error
      ? errorMessage(error, "Could not load intent for this PR.")
      : errorMessage(computeMutation.error, "Could not derive intent for this PR.");
    return (
      <section>
        <SectionLabel icon="Target">Intent</SectionLabel>
        <div style={s.emptyState}>
          <span style={s.emptyMessage}>{message}</span>
          <Button
            kind="secondary"
            size="sm"
            loading={computeMutation.isPending}
            onClick={() => computeMutation.mutate(prId)}
          >
            Derive intent
          </Button>
        </div>
      </section>
    );
  }

  if (data == null) {
    return (
      <section>
        <SectionLabel icon="Target">Intent</SectionLabel>
        <div style={s.derivingState}>Deriving intent…</div>
      </section>
    );
  }

  return (
    <section>
      <SectionLabel
        icon="Target"
        right={
          <Button
            kind="ghost"
            size="sm"
            icon="RefreshCw"
            loading={recomputeMutation.isPending}
            onClick={() => recomputeMutation.mutate(prId)}
          >
            {recomputeMutation.isPending ? "Deriving…" : "Recompute"}
          </Button>
        }
      >
        Intent
      </SectionLabel>
      <div style={s.box}>
        <p style={s.quote}>{data.intent}</p>
        {data.in_scope.length > 0 && (
          <>
            <hr style={s.divider} />
            <div style={s.scopeBlock}>
              <div style={s.scopeLabel}>In scope</div>
              <ul style={s.scopeList}>
                {data.in_scope.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </>
        )}
        {data.out_of_scope.length > 0 && (
          <>
            <hr style={s.divider} />
            <div style={s.scopeBlock}>
              <div style={s.scopeLabel}>Out of scope</div>
              <ul style={s.scopeList}>
                {data.out_of_scope.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </>
        )}

        <hr style={s.divider} />
        <div>
          <SectionLabel icon="AlertTriangle">{t("risks.title")}</SectionLabel>
          {briefLoading ? (
            <Skeleton height={40} />
          ) : risks.length === 0 ? (
            <span style={s.risksEmpty}>{t("risks.empty")}</span>
          ) : (
            <div style={s.risksList}>
              {risks.map((risk, i) => {
                const key = `${risk.title}-${i}`;
                return (
                  <RiskRow
                    key={key}
                    risk={risk}
                    expanded={expandedRisks.has(key)}
                    onToggle={() => toggleRisk(key)}
                    onJumpToFile={onJumpToFile}
                    t={t}
                  />
                );
              })}
            </div>
          )}
          <div style={s.recalculateRow}>
            <Button
              kind="ghost"
              size="sm"
              icon="RefreshCw"
              loading={regenerateMutation.isPending}
              onClick={() => prId && regenerateMutation.mutate(prId)}
              aria-label={t("risks.recalculateAria")}
            >
              {t("risks.recalculate")}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
