"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button, Badge, CircularScore, Skeleton, Icon } from "@devdigest/ui";
import { usePrBrief, useGenerateBrief, useRegenerateBrief, usePrRunSummary } from "../../../../../../../lib/hooks/brief";
import { ApiError } from "../../../../../../../lib/api";
import type { RiskSeverity, Verdict } from "@devdigest/shared";
import { VERDICT_META } from "../VerdictBanner/constants";
import { s } from "./styles";

interface BriefCardProps {
  prId: string | null;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError || err instanceof Error ? err.message : fallback;
}

/** AC-1 requires the risk level as text alongside what/why — colour only
 *  reinforces it (never the only channel). */
const RISK_LEVEL_COLOR: Record<RiskSeverity, string> = {
  high: "var(--crit)",
  medium: "var(--warn)",
  low: "var(--info)",
};

/**
 * SPEC-02 PR brief — the "what/why" synthesis plus the most recent run's
 * verdict, finding/blocker counts and PR score, above everything else on the
 * Overview tab. Two independent data sources fill in on their own schedule:
 * `usePrRunSummary` (verdict/counts/score — absent, never zero, with no run)
 * and `usePrBrief` (the generated text). Renders NO cost/token line — that
 * space is deliberately left empty (SPEC-02 non-goal).
 *
 * Auto-start mirrors IntentCard.tsx: a `useRef` keyed on `prId` fires ONE
 * generate-if-absent call per PR per mount, so a refetch/re-render can never
 * fan out into a second model call.
 */
export function BriefCard({ prId }: BriefCardProps) {
  const t = useTranslations("brief");
  const { data, isLoading, error } = usePrBrief(prId);
  const { data: runSummary, isLoading: runSummaryLoading } = usePrRunSummary(prId);
  const generateMutation = useGenerateBrief();
  const regenerateMutation = useRegenerateBrief();

  const firedForRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!prId || isLoading || !data || data.status !== "absent" || firedForRef.current === prId) return;
    firedForRef.current = prId;
    generateMutation.mutate(prId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prId, data, isLoading]);

  if (!prId) return null;

  const onRegenerate = () => regenerateMutation.mutate(prId);
  const regenerateButton = (
    <Button
      kind="ghost"
      size="sm"
      icon="RefreshCw"
      loading={regenerateMutation.isPending}
      onClick={onRegenerate}
      aria-label={t("card.regenerateAria")}
    />
  );

  if (isLoading) {
    return (
      <section aria-label={t("card.title")}>
        <SectionLabel icon="FileText">{t("card.title")}</SectionLabel>
        <Skeleton height={78} />
      </section>
    );
  }

  if (error) {
    return (
      <section aria-label={t("card.title")}>
        <SectionLabel icon="FileText">{t("card.title")}</SectionLabel>
        <div style={s.box}>
          <span style={s.stateText}>{errorMessage(error, t("card.unavailable"))}</span>
        </div>
      </section>
    );
  }

  // Precedence, evaluated top to bottom: a failed generation attempt is
  // reported first (it would otherwise be masked by `status === "absent"`,
  // which never changes once the mutation throws — nothing is stored on
  // failure, T17); then the in-flight/about-to-fire state (never a partial
  // brief); then the server's own `unavailable` reason; then the stored
  // brief.
  let body: React.ReactNode;
  if (generateMutation.isError) {
    body = <span style={s.stateText}>{errorMessage(generateMutation.error, t("card.unavailable"))}</span>;
  } else if (generateMutation.isPending || data?.status === "absent" || !data) {
    body = <span style={s.stateText}>{t("card.generating")}</span>;
  } else if (data.status === "unavailable") {
    const text =
      data.reason === "intent_absent"
        ? t("card.unavailableIntentAbsent")
        : data.reason === "input_budget"
          ? t("card.unavailableInputBudget")
          : t("card.unavailable");
    body = <span style={s.stateText}>{text}</span>;
  } else {
    const riskLevel = data.brief?.risk_level;
    body = (
      <>
        {riskLevel && (
          <span style={s.riskLevel(RISK_LEVEL_COLOR[riskLevel])}>
            {t("card.riskLevel", { level: t(`risks.severity.${riskLevel}`) })}
          </span>
        )}
        <p style={s.what}>{data.brief?.what}</p>
        <p style={s.why}>{data.brief?.why}</p>
      </>
    );
  }

  const verdictMeta = runSummary ? (VERDICT_META[runSummary.verdict as Verdict] ?? VERDICT_META.comment) : null;

  return (
    <section aria-label={t("card.title")}>
      <SectionLabel icon="FileText" right={regenerateButton}>
        {t("card.title")}
      </SectionLabel>
      <div style={s.box}>
        {verdictMeta && (
          <div style={s.iconBox(verdictMeta.bg, verdictMeta.c)}>
            {React.createElement(Icon[verdictMeta.icon], { size: 20 })}
          </div>
        )}
        <div style={s.main}>
          {runSummary && verdictMeta && (
            <div style={s.titleRow}>
              <span style={s.verdictLabel(verdictMeta.c)}>{t(`card.verdict.${verdictMeta.labelKey}`)}</span>
              <Badge color="var(--text-secondary)">
                {t("card.findingsCount", { count: runSummary.findings_count })}
                {runSummary.blockers_count > 0 ? t("card.blockers", { count: runSummary.blockers_count }) : ""}
              </Badge>
            </div>
          )}
          {body}
        </div>
        <div style={s.scoreCol}>
          {runSummaryLoading ? (
            <Skeleton width={52} height={52} style={{ borderRadius: "50%" }} />
          ) : runSummary?.score != null ? (
            <>
              <CircularScore score={runSummary.score} size={52} stroke={5} />
              <span style={s.scoreLabel}>{t("card.prScore")}</span>
            </>
          ) : (
            <>
              <div style={s.noScoreRing}>—</div>
              <span style={s.scoreLabel}>{t("card.noScore")}</span>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
