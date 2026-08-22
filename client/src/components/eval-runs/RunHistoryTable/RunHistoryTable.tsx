/* RunHistoryTable — a list of suite runs, shared by every surface that shows
   one (D20: source-agnostic — the fetch lives with the caller, per
   `frontend-ui-architecture`'s "server state lives in a query cache" rule;
   after AC-59 removed the run history from the agent's own Evals tab, the
   only caller left is EvalDashboardView, which passes either the unfiltered
   cross-agent list or one agent's own list through the SAME props). One row
   per run; a selection checkbox per row drives the two-run comparison
   dialog — but ONLY when `agentId` is non-null, since two runs of different
   agents are not comparable (AC-30 + SPEC-04's edge case) and a `null`
   agentId means the caller is showing the unfiltered cross-agent list. An
   absent metric/cost is an em dash with a "not available" accessible
   label — NEVER `0` and never `?? 0` before display (client/insights.md,
   2026-07-30). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Skeleton } from "@devdigest/ui";
import type { EvalSuiteRun } from "@devdigest/shared";
import { RunCompareDialog } from "../RunCompareDialog";
import {
  chronological,
  formatMetricPercent,
  formatPassCount,
  formatRunCost,
  formatStartedAt,
  type DisplayValue,
} from "../helpers";
import { s } from "./styles";

function Metric({ value, style }: { value: DisplayValue; style: React.CSSProperties }) {
  const t = useTranslations("eval");
  return (
    <span className="tnum" style={style} aria-label={value.absent ? t("runHistory.notAvailable") : undefined}>
      {value.text}
    </span>
  );
}

export function RunHistoryTable({
  runs,
  agentId,
  isLoading,
}: {
  runs: EvalSuiteRun[];
  /** The single agent this list is scoped to, or `null` for the unfiltered
   *  cross-agent list — selection/compare only render when non-null. */
  agentId: string | null;
  isLoading?: boolean;
}) {
  const t = useTranslations("eval");
  const [selected, setSelected] = React.useState<string[]>([]);
  const [comparing, setComparing] = React.useState(false);

  const list = runs;
  const comparable = agentId != null;

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return prev;
      return [...prev, id];
    });
  };

  if (isLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={40} />
        <Skeleton height={40} />
      </div>
    );
  }

  if (list.length === 0) {
    return <p style={s.empty}>{t("runHistory.empty")}</p>;
  }

  const runA = list.find((r) => r.id === selected[0]);
  const runB = list.find((r) => r.id === selected[1]);
  const pair: [EvalSuiteRun, EvalSuiteRun] | null = runA && runB ? chronological(runA, runB) : null;

  return (
    <div style={s.wrap}>
      {comparing && pair && agentId && (
        <RunCompareDialog
          agentId={agentId}
          earlier={pair[0]}
          later={pair[1]}
          onClose={() => setComparing(false)}
        />
      )}

      {comparable && (
        <div style={s.toolbar}>
          <Button kind="secondary" size="sm" disabled={selected.length !== 2} onClick={() => setComparing(true)}>
            {t("runHistory.compare")}
          </Button>
        </div>
      )}

      <div style={s.headerRow(comparable)} aria-hidden="true">
        {comparable && <span />}
        <span>{t("dashboard.table.ranAt")}</span>
        <span>{t("runHistory.version")}</span>
        <span>{t("dashboard.table.recall")}</span>
        <span>{t("dashboard.table.precision")}</span>
        <span>{t("dashboard.table.citation")}</span>
        <span>{t("dashboard.table.pass")}</span>
        <span>{t("runHistory.incomplete")}</span>
        <span>{t("dashboard.table.cost")}</span>
      </div>

      {list.map((r) => (
        <div key={r.id} style={s.row(comparable)}>
          {comparable && (
            <span style={s.checkboxCell}>
              <input
                type="checkbox"
                checked={selected.includes(r.id)}
                disabled={!selected.includes(r.id) && selected.length >= 2}
                onChange={() => toggle(r.id)}
                aria-label={t("runHistory.selectRunLabel", {
                  when: formatStartedAt(r.started_at),
                  version: r.agent_version,
                })}
              />
            </span>
          )}
          <span style={s.cell}>{formatStartedAt(r.started_at)}</span>
          <span className="mono tnum" style={s.cellMuted}>
            v{r.agent_version}
          </span>
          <Metric value={formatMetricPercent(r.recall)} style={s.cell} />
          <Metric value={formatMetricPercent(r.precision)} style={s.cell} />
          <Metric value={formatMetricPercent(r.citation_accuracy)} style={s.cell} />
          <Metric value={formatPassCount(r.cases_passed, r.cases_total)} style={s.cell} />
          <span className="tnum" style={s.cellMuted}>
            {r.cases_failed_to_complete}
          </span>
          <Metric value={formatRunCost(r.cost_usd)} style={s.cell} />
        </div>
      ))}
    </div>
  );
}
