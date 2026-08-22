/* CompareRunsDialog — one of the two dialogs AC-43/AC-44 name ("the eval
   case dialog or the comparison dialog"): keyboard focus is confined to it
   while open (`useFocusTrap`), and closing it returns focus to the Compare
   control that opened it. Presents the two selected runs earlier-first with,
   for recall/precision/citation accuracy/cost, both values and the
   difference (AC-40); the system-prompt diff as inert text with added/
   removed conveyed by a marker as well as colour (AC-41, NFR); a
   different-case-sets statement (AC-42) and a different-context statement
   (AC-54) when the comparison says so. No Promote control (excluded by the
   spec/plan) and no version labels (`v6`/`v7`) — the reshaped contracts
   carry none. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";
import type { EvalComparisonMetric } from "@devdigest/shared";
import { useEvalComparison } from "../../../../../lib/hooks/evals";
import { useFocusTrap } from "../../../../../lib/use-focus-trap";
import { formatCost } from "../../../../../lib/format-cost";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function formatMetricValue(metric: EvalComparisonMetric, value: number | null): string {
  if (value == null) return "—";
  return metric.key === "cost_usd" ? formatCost(value) : `${Math.round(value * 100)}%`;
}

/** One recall/precision/citation-accuracy/cost box: earlier → later, plus the
 *  worded difference (mirrors RunHistoryTable's delta wording for AC-40). */
function MetricBox({ metric }: { metric: EvalComparisonMetric }) {
  const t = useTranslations("eval");
  const label =
    metric.key === "cost_usd"
      ? t("dashboard.table.cost")
      : t(`dashboard.metrics.${metric.key === "citation_accuracy" ? "citationAccuracy" : metric.key}`);

  let deltaText = t("dashboard.deltaNone");
  let deltaColor = "var(--text-secondary)";
  if (metric.delta != null) {
    if (metric.delta === 0) {
      deltaText = t("dashboard.deltaUnchanged");
      deltaColor = "var(--text-muted)";
    } else {
      const rose = metric.delta > 0;
      const improved = metric.key === "cost_usd" ? metric.delta < 0 : metric.delta > 0;
      const magnitude =
        metric.key === "cost_usd"
          ? formatCost(Math.abs(metric.delta))
          : `${Math.round(Math.abs(metric.delta) * 100)}pts`;
      deltaText = t(rose ? "dashboard.deltaUp" : "dashboard.deltaDown", { value: magnitude });
      deltaColor = improved ? "var(--ok)" : "var(--crit)";
    }
  }

  return (
    <div
      style={{
        flex: 1,
        minWidth: 130,
        padding: 12,
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--bg-elevated)",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", color: "var(--text-muted)" }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 6 }} className="tnum">
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{formatMetricValue(metric, metric.earlier)}</span>
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>→</span>
        <span style={{ fontSize: 18, fontWeight: 700 }}>{formatMetricValue(metric, metric.later)}</span>
      </div>
      <div style={{ fontSize: 12, color: deltaColor, marginTop: 4 }}>{deltaText}</div>
    </div>
  );
}

export function CompareRunsDialog({
  agentId,
  runIdA,
  runIdB,
  onClose,
}: {
  agentId: string;
  runIdA: string;
  runIdB: string;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const c = useTranslations("common");
  const { data: comparison } = useEvalComparison(agentId, runIdA, runIdB);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true, onClose);

  return (
    <div ref={dialogRef}>
      <Modal
        width={760}
        title={t("dashboard.compareTitle")}
        subtitle={
          comparison ? `${formatWhen(comparison.earlier.started_at)} → ${formatWhen(comparison.later.started_at)}` : undefined
        }
        onClose={onClose}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button kind="secondary" onClick={onClose}>
              {c("actions.close")}
            </Button>
          </div>
        }
      >
        <div style={{ padding: 24 }}>
          {!comparison && <div style={{ color: "var(--text-muted)" }}>{t("dashboard.loading")}</div>}
          {comparison && (
            <>
              {comparison.case_sets_differ && (
                <div
                  role="status"
                  style={{
                    padding: 10,
                    borderRadius: 6,
                    background: "var(--warn-bg)",
                    color: "var(--warn)",
                    fontSize: 13,
                    marginBottom: 12,
                  }}
                >
                  {t("dashboard.caseSetsDiffer", {
                    earlier: comparison.earlier_case_count,
                    later: comparison.later_case_count,
                  })}
                </div>
              )}
              {comparison.context_differs && (
                <div
                  role="status"
                  style={{
                    padding: 10,
                    borderRadius: 6,
                    background: "var(--warn-bg)",
                    color: "var(--warn)",
                    fontSize: 13,
                    marginBottom: 12,
                  }}
                >
                  {t("dashboard.contextDiffers")}
                </div>
              )}

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {comparison.metrics.map((m) => (
                  <MetricBox key={m.key} metric={m} />
                ))}
              </div>

              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8 }}>
                  {t("dashboard.promptDiff")}
                </div>
                <div
                  style={{
                    fontFamily: "monospace",
                    fontSize: 12,
                    lineHeight: 1.6,
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: 10,
                    maxHeight: 220,
                    overflow: "auto",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {comparison.prompt_diff.map((line, i) => {
                    // AC-41 / NFR: added/removed are conveyed by a text marker
                    // AS WELL AS colour — never colour alone. Inert text: no
                    // interactive elements, just styled spans.
                    const marker = line.kind === "added" ? "+ " : line.kind === "removed" ? "- " : "  ";
                    const color =
                      line.kind === "added" ? "var(--ok)" : line.kind === "removed" ? "var(--crit)" : "var(--text-secondary)";
                    return (
                      <div key={i} style={{ color }}>
                        {marker}
                        {line.text}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
