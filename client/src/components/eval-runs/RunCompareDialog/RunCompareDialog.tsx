/* RunCompareDialog — two suite runs of the same agent, side by side: each
   metric and the cost as earlier → later + delta (AC-31, AC-36), the system
   prompt diff between the two recorded configuration versions (AC-32), and a
   statement when the two runs covered different case sets (AC-33) or invoked
   different skills/skill versions (AC-39) — the reason a metric move must
   never be pinned on the prompt diff alone when a skill also changed. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal, Skeleton } from "@devdigest/ui";
import type { EvalSuiteRun } from "@devdigest/shared";
import { useAgentVersion } from "../../../lib/hooks/agents";
import { diffLines } from "../../../lib/diff-lines";
import { lineRowFor, lineSignFor } from "../../diff-viewer";
import { formatMetricPercent, formatRunCost, type DisplayValue } from "../helpers";
import {
  caseSetsDiffer,
  differingSkills,
  formatCostDelta,
  formatPercentDelta,
  invokedSkillsDiffer,
  metricDelta,
} from "./helpers";
import { useFocusTrap } from "./use-focus-trap";
import { s } from "./styles";

function MetricCard({
  label,
  earlier,
  later,
  delta,
  notAvailableLabel,
}: {
  label: string;
  earlier: DisplayValue;
  later: DisplayValue;
  delta: DisplayValue;
  notAvailableLabel: string;
}) {
  return (
    <div style={s.metricCard}>
      <div style={s.metricLabel}>{label}</div>
      <div style={s.metricValues}>
        <span aria-label={earlier.absent ? notAvailableLabel : undefined}>{earlier.text}</span>
        <span style={s.metricArrow} aria-hidden="true">
          →
        </span>
        <span style={s.metricNew} aria-label={later.absent ? notAvailableLabel : undefined}>
          {later.text}
        </span>
        <span style={s.metricDelta} aria-label={delta.absent ? notAvailableLabel : undefined}>
          ({delta.text})
        </span>
      </div>
    </div>
  );
}

export function RunCompareDialog({
  agentId,
  earlier,
  later,
  onClose,
}: {
  agentId: string;
  earlier: EvalSuiteRun;
  later: EvalSuiteRun;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const anchorRef = React.useRef<HTMLDivElement | null>(null);
  useFocusTrap(anchorRef, onClose);

  const earlierVersion = useAgentVersion(agentId, earlier.agent_version);
  const laterVersion = useAgentVersion(agentId, later.agent_version);

  const promptDiff = React.useMemo(() => {
    if (!earlierVersion.data || !laterVersion.data) return null;
    return diffLines(earlierVersion.data.config.system_prompt, laterVersion.data.config.system_prompt);
  }, [earlierVersion.data, laterVersion.data]);

  const casesDiffer = caseSetsDiffer(earlier.case_ids, later.case_ids);
  const skillsDiffer = invokedSkillsDiffer(earlier.invoked_skills, later.invoked_skills);
  const skillDiffs = skillsDiffer ? differingSkills(earlier.invoked_skills, later.invoked_skills) : [];

  const versionsLoading = earlierVersion.isLoading || laterVersion.isLoading;
  const versionMissing = !versionsLoading && (earlierVersion.data === null || laterVersion.data === null);

  return (
    <Modal
      width={760}
      title={t("compare.title", { earlier: earlier.agent_version, later: later.agent_version })}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("compare.close")}
          </Button>
        </div>
      }
    >
      <div style={s.body} ref={anchorRef}>
        <div style={s.metricGrid}>
          <MetricCard
            label={t("dashboard.metrics.recall")}
            earlier={formatMetricPercent(earlier.recall)}
            later={formatMetricPercent(later.recall)}
            delta={formatPercentDelta(metricDelta(earlier.recall, later.recall))}
            notAvailableLabel={t("runHistory.notAvailable")}
          />
          <MetricCard
            label={t("dashboard.metrics.precision")}
            earlier={formatMetricPercent(earlier.precision)}
            later={formatMetricPercent(later.precision)}
            delta={formatPercentDelta(metricDelta(earlier.precision, later.precision))}
            notAvailableLabel={t("runHistory.notAvailable")}
          />
          <MetricCard
            label={t("dashboard.metrics.citationAccuracy")}
            earlier={formatMetricPercent(earlier.citation_accuracy)}
            later={formatMetricPercent(later.citation_accuracy)}
            delta={formatPercentDelta(metricDelta(earlier.citation_accuracy, later.citation_accuracy))}
            notAvailableLabel={t("runHistory.notAvailable")}
          />
          <MetricCard
            label={t("compare.cost")}
            earlier={formatRunCost(earlier.cost_usd)}
            later={formatRunCost(later.cost_usd)}
            delta={formatCostDelta(metricDelta(earlier.cost_usd, later.cost_usd))}
            notAvailableLabel={t("runHistory.notAvailable")}
          />
        </div>

        {casesDiffer && <p style={s.statement}>{t("compare.caseSetsDiffer")}</p>}

        {skillsDiffer && (
          <p style={s.statement}>
            {t("compare.skillsDiffer", {
              list: skillDiffs
                .map(
                  (d) =>
                    `${d.name} (v${d.earlierVersion ?? "—"} → v${d.laterVersion ?? "—"})`,
                )
                .join(", "),
            })}
          </p>
        )}

        <div style={s.sectionHeading}>{t("compare.promptDiffHeading")}</div>
        {versionsLoading && <Skeleton height={160} />}
        {versionMissing && <p style={s.diffEmpty}>{t("compare.promptUnavailable")}</p>}
        {promptDiff && promptDiff.truncated && <p style={s.diffEmpty}>{t("compare.diffTooLarge")}</p>}
        {promptDiff && !promptDiff.truncated && promptDiff.lines.length === 0 && (
          <p style={s.diffEmpty}>{t("compare.diffEmpty")}</p>
        )}
        {promptDiff && !promptDiff.truncated && promptDiff.lines.length > 0 && (
          <div className="mono" style={s.diffBody}>
            {promptDiff.lines.map((ln, i) => (
              <div key={i} style={lineRowFor(ln.kind)}>
                <span className="tnum" style={s.lineNo}>
                  {ln.newNo ?? ln.oldNo ?? ""}
                </span>
                <span style={lineSignFor(ln.kind)}>
                  {ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : ""}
                </span>
                <span style={s.lineText}>{ln.text || " "}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
