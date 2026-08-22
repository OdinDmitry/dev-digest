/* RunHistoryTable — an agent's completed (and failed) suite runs, most
   recently started first (SPEC-03 AC-36). A failed run states so
   (`dashboard.runFailed`) and shows no metrics (AC-29). Each completed run
   shows its metrics together with the difference from the immediately
   preceding COMPLETED run, stated in words as well as an arrow, so the
   comparison isn't conveyed by arrow colour alone (AC-38, NFR). Only
   completed runs offer the selection control that feeds the compare
   workflow (AC-39) — its accessible name states the run's start time and
   its hit target is at least 24x24 CSS px (NFR). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { EvalRunRecord } from "@devdigest/shared";
import { formatCost } from "../../../../../lib/format-cost";
import { s } from "./styles";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** Renders one metric's value + its worded delta (or `deltaNone` for the
 *  earliest completed run). `kind` controls how the delta magnitude is
 *  formatted: percentage points for the three rate metrics, currency for cost. */
function MetricCell({
  value,
  delta,
  kind,
}: {
  value: number | null;
  delta: number | null;
  kind: "percent" | "cost";
}) {
  const t = useTranslations("eval");
  const display = value == null ? "—" : kind === "percent" ? `${Math.round(value * 100)}%` : formatCost(value);

  if (delta == null) {
    return (
      <td style={s.td}>
        <div style={s.metricValue} className="tnum">
          {display}
        </div>
        <div style={s.deltaRow}>{t("dashboard.deltaNone")}</div>
      </td>
    );
  }

  const up = delta >= 0;
  const magnitude = kind === "percent" ? `${Math.round(Math.abs(delta) * 100)}pts` : formatCost(Math.abs(delta));
  const deltaText = t(up ? "dashboard.deltaUp" : "dashboard.deltaDown", { value: magnitude });

  return (
    <td style={s.td}>
      <div style={s.metricValue} className="tnum">
        {display}
      </div>
      <div style={{ ...s.deltaRow, ...(up ? s.deltaUp : s.deltaDown) }}>
        {up ? <Icon.ArrowUp size={11} /> : <Icon.ArrowDown size={11} />}
        {deltaText}
      </div>
    </td>
  );
}

export function RunHistoryTable({
  runs,
  selectedIds,
  onToggleSelect,
}: {
  runs: EvalRunRecord[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  const t = useTranslations("eval");
  // AC-36: only completed (and, per AC-29's presentation, failed) runs belong
  // in this history — an in-progress run is tracked elsewhere (the active-run
  // poll), not as a row here.
  const rows = runs.filter((r) => r.state === "completed" || r.state === "failed");

  return (
    <table style={s.table}>
      <thead>
        <tr>
          <th style={s.th} />
          <th style={s.th}>{t("dashboard.table.ranAt")}</th>
          <th style={s.th}>{t("dashboard.table.recall")}</th>
          <th style={s.th}>{t("dashboard.table.precision")}</th>
          <th style={s.th}>{t("dashboard.table.citation")}</th>
          <th style={s.th}>{t("dashboard.table.pass")}</th>
          <th style={s.th}>{t("dashboard.table.cost")}</th>
          <th style={s.th}>{t("evalsTab.errored")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((run) => {
          const when = formatWhen(run.started_at);
          const checked = selectedIds.has(run.id);
          return (
            <tr key={run.id} style={s.row}>
              <td style={s.td}>
                {run.state === "completed" && (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    aria-label={t("dashboard.selectRun", { at: when })}
                    onClick={() => onToggleSelect(run.id)}
                    style={s.selectBtn(checked)}
                  >
                    {checked && <Icon.Check size={13} />}
                  </button>
                )}
              </td>
              <td style={s.tdMuted} className="tnum">
                {when}
              </td>
              {run.state === "failed" ? (
                <td style={s.failedCell} colSpan={5}>
                  {t("dashboard.runFailed")}
                </td>
              ) : (
                <>
                  <MetricCell value={run.recall} delta={run.delta?.recall ?? null} kind="percent" />
                  <MetricCell value={run.precision} delta={run.delta?.precision ?? null} kind="percent" />
                  <MetricCell value={run.citation_accuracy} delta={run.delta?.citation_accuracy ?? null} kind="percent" />
                  <td style={s.td} className="tnum">
                    {run.traces_passed}/{run.traces_total}
                  </td>
                  <MetricCell value={run.cost_usd} delta={run.delta?.cost_usd ?? null} kind="cost" />
                </>
              )}
              <td style={s.tdMuted} className="tnum">
                {run.errored_count}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
