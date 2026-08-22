/* EvalDashboardView — /eval. SPEC-04's dashboard is ONE run list, not two
   (AC-62): an agent summary row per agent (AC-63) sits above a single run
   list that shows every agent's runs, newest first, until an agent row is
   selected — at which point the SAME list narrows to that agent's own runs
   (AC-64) and the selected row exposes its selected state to assistive tech,
   never by colour alone (AC-65). The run history that used to live on the
   agent's own Evals tab lives ONLY here now (AC-59). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { Skeleton } from "@devdigest/ui";
import { useAgentEvalRuns, useEvalAgentSummaries, useRecentEvalRuns } from "@/lib/hooks/eval";
import { RunHistoryTable } from "@/components/eval-runs/RunHistoryTable";
import { formatMetricPercent, formatPassCount, formatStartedAt } from "@/components/eval-runs/helpers";
import { toggleAgentSelection } from "./helpers";
import { s } from "./styles";

export function EvalDashboardView() {
  const t = useTranslations("eval");
  const { data: summaries, isLoading: summariesLoading } = useEvalAgentSummaries();
  const [selectedAgentId, setSelectedAgentId] = React.useState<string | null>(null);

  const { data: recent, isLoading: recentLoading } = useRecentEvalRuns(20);
  const { data: agentRuns, isLoading: agentRunsLoading } = useAgentEvalRuns(selectedAgentId);

  const notAvailable = t("runHistory.notAvailable");
  const agentList = summaries ?? [];
  const workspaceHasNoRuns = !recentLoading && (recent ?? []).length === 0 && !selectedAgentId;

  const runs = selectedAgentId ? (agentRuns ?? []) : (recent ?? []);
  const runsLoading = selectedAgentId ? agentRunsLoading : recentLoading;

  return (
    <AppShell crumb={[{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard") }]}>
      <div style={s.wrap}>
        <h1 style={s.title}>{t("page.crumbEvalDashboard")}</h1>

        <section>
          <h2 style={s.h2}>{t("dashboard.agentsHeading")}</h2>
          <p style={s.hint}>{t("dashboard.selectAgentHint")}</p>
          {summariesLoading ? (
            <Skeleton height={80} />
          ) : (
            <div style={s.agentList}>
              {agentList.map((a) => {
                const run = a.latest_run;
                const selected = selectedAgentId === a.agent_id;
                return (
                  <button
                    key={a.agent_id}
                    type="button"
                    aria-pressed={selected}
                    style={s.agentRow(selected)}
                    onClick={() => setSelectedAgentId((prev) => toggleAgentSelection(prev, a.agent_id))}
                  >
                    <div style={s.agentInfo}>
                      <div style={s.agentName}>{a.agent_name}</div>
                      <div className="mono" style={s.agentMeta}>
                        {run ? `${formatStartedAt(run.started_at)} · v${run.agent_version}` : notAvailable}
                      </div>
                    </div>
                    <div style={s.agentMetrics}>
                      <div style={s.metricCell}>
                        <span style={s.metricLabel}>{t("dashboard.table.pass")}</span>
                        <span
                          className="tnum"
                          style={s.metricValue}
                          aria-label={run == null || formatPassCount(run.cases_passed, run.cases_total).absent ? notAvailable : undefined}
                        >
                          {run ? formatPassCount(run.cases_passed, run.cases_total).text : "—"}
                        </span>
                      </div>
                      <div style={s.metricCell}>
                        <span style={s.metricLabel}>{t("dashboard.metrics.recall")}</span>
                        <span
                          className="tnum"
                          style={s.metricValue}
                          aria-label={run == null || formatMetricPercent(run.recall).absent ? notAvailable : undefined}
                        >
                          {run ? formatMetricPercent(run.recall).text : "—"}
                        </span>
                      </div>
                      <div style={s.metricCell}>
                        <span style={s.metricLabel}>{t("dashboard.metrics.precision")}</span>
                        <span
                          className="tnum"
                          style={s.metricValue}
                          aria-label={run == null || formatMetricPercent(run.precision).absent ? notAvailable : undefined}
                        >
                          {run ? formatMetricPercent(run.precision).text : "—"}
                        </span>
                      </div>
                      <div style={s.metricCell}>
                        <span style={s.metricLabel}>{t("dashboard.metrics.citationAccuracy")}</span>
                        <span
                          className="tnum"
                          style={s.metricValue}
                          aria-label={run == null || formatMetricPercent(run.citation_accuracy).absent ? notAvailable : undefined}
                        >
                          {run ? formatMetricPercent(run.citation_accuracy).text : "—"}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <h2 style={s.h2}>{t("dashboard.recentRuns")}</h2>
          {workspaceHasNoRuns ? (
            <p style={s.hint}>{t("dashboard.noRuns")}</p>
          ) : (
            <RunHistoryTable runs={runs} agentId={selectedAgentId} isLoading={runsLoading} />
          )}
        </section>
      </div>
    </AppShell>
  );
}
