/* AgentEvalRow — one row of the /evals dashboard (SPEC-03 AC-35/AC-36 entry
   point). Shows the agent's identity, its last completed run's start time
   and pass count, and its recall/precision/citation-accuracy bars with the
   numeric value rendered as text next to each bar (NFR). An agent with cases
   but no completed run states so (`dashboard.neverRun`) instead of being
   hidden or showing empty bars — AC-35. Activating the row (click or
   keyboard) navigates to that agent's own eval history. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, PercentProgress } from "@devdigest/ui";
import type { EvalDashboardEntry } from "@devdigest/shared";
import { s } from "./styles";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function AgentEvalRow({
  entry,
  onActivate,
}: {
  entry: EvalDashboardEntry;
  onActivate: () => void;
}) {
  const t = useTranslations("eval");

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate();
        }
      }}
      style={s.row}
    >
      <div style={s.left}>
        <div style={s.iconBox}>
          <Icon.Cpu size={15} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={s.nameRow}>
            <span style={s.name}>{entry.agent_name}</span>
            <span className="mono" style={s.modelChip}>
              {entry.model}
            </span>
          </div>
          {entry.never_run ? (
            <div style={s.subtitle}>{t("dashboard.neverRun")}</div>
          ) : (
            <div style={s.subtitle} className="tnum">
              {entry.last_run_started_at && formatWhen(entry.last_run_started_at)}
              {" · "}
              {entry.traces_passed}/{entry.traces_total} {t("dashboard.pass")}
            </div>
          )}
        </div>
      </div>

      {!entry.never_run && (
        <div style={s.metrics}>
          <div style={s.metric}>
            <PercentProgress
              value={(entry.recall ?? 0) * 100}
              label={t("dashboard.metrics.recall")}
              color="var(--accent)"
            />
          </div>
          <div style={s.metric}>
            <PercentProgress
              value={(entry.precision ?? 0) * 100}
              label={t("dashboard.metrics.precision")}
              color="var(--ok)"
            />
          </div>
          <div style={s.metric}>
            <PercentProgress
              value={(entry.citation_accuracy ?? 0) * 100}
              label={t("dashboard.metrics.citationAccuracy")}
              color="var(--warn)"
            />
          </div>
        </div>
      )}

      <Icon.ChevronRight size={16} style={s.chevron} />
    </div>
  );
}
