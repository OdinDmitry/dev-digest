/* CiRunsView — the workspace-wide CI Runs page (AC-16): every recorded run,
   most recent first, with repository, pull request, agent, verdict (word),
   findings, cost, duration, status (word) and a job link. Refresh is
   user-triggered only (no auto-refresh/polling — plan Out of scope) and its
   response's `installations_checked` is the only signal this page has for
   telling "no installation anywhere" apart from "installations but no runs
   yet" — before any Refresh press it defaults to the more informative
   "no installation" copy, since `GET /ci/runs` alone can't distinguish the
   two (no workspace-wide installations-listing route exists — see the
   plan's "No server change belongs in this phase"). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import type { CiRefreshRejection } from "@devdigest/shared";
import { useCiRuns, useRefreshCiRuns } from "@/lib/hooks";
import { formatCost } from "@/lib/format-cost";
import { formatWhen, formatDuration, isHttpsUrl, sortByRecency, VERDICT_KEY, STATUS_KEY } from "./helpers";
import { s } from "./styles";

export function CiRunsView() {
  const t = useTranslations("ci");
  const { data: runs, isLoading, isError, refetch } = useCiRuns();
  const refresh = useRefreshCiRuns();

  const [rejections, setRejections] = React.useState<CiRefreshRejection[]>([]);
  const [installationsChecked, setInstallationsChecked] = React.useState<number | null>(null);
  const [refreshError, setRefreshError] = React.useState<string | null>(null);

  async function handleRefresh() {
    setRefreshError(null);
    try {
      const result = await refresh.mutateAsync();
      setRejections(result.rejected);
      setInstallationsChecked(result.installations_checked);
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : String(e));
    }
  }

  const rows = sortByRecency(runs ?? []);
  // Before any refresh, default to the more informative "no installation
  // anywhere" empty state — only a refresh response can prove installations
  // exist yet still produced zero runs.
  const noInstallation = installationsChecked === null || installationsChecked === 0;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h1 style={s.h1}>{t("runs.title")}</h1>
        <Button kind="secondary" icon="RefreshCw" loading={refresh.isPending} onClick={() => void handleRefresh()}>
          {refresh.isPending ? t("runs.refreshing") : t("runs.refresh")}
        </Button>
      </div>
      <p style={s.subtitle}>{t("runs.subtitle")}</p>

      {refreshError && (
        <div role="alert" style={{ ...s.rejections, borderColor: "var(--crit)", background: "var(--crit-bg)", color: "var(--crit)" }}>
          {refreshError}
        </div>
      )}

      {rejections.length > 0 && (
        <div role="status" style={s.rejections}>
          <div style={s.rejectionsHeading}>{t("runs.rejectionsHeading")}</div>
          {rejections.map((r, i) => (
            <div key={i}>{t("runs.rejectedLine", { job: r.job_url, reason: r.reason })}</div>
          ))}
        </div>
      )}

      {isLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Skeleton height={40} />
          <Skeleton height={40} />
          <Skeleton height={40} />
        </div>
      )}
      {isError && <ErrorState onRetry={() => refetch()} />}

      {!isLoading && !isError && rows.length === 0 && (
        <EmptyState
          icon="Workflow"
          title={noInstallation ? t("runs.noInstallationTitle") : t("runs.emptyTitle")}
          body={noInstallation ? t("runs.noInstallationBody") : t("runs.emptyBody")}
        />
      )}

      {!isLoading && !isError && rows.length > 0 && (
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>{t("runs.table.repository")}</th>
              <th style={s.th}>{t("runs.table.pullRequest")}</th>
              <th style={s.th}>{t("runs.table.agent")}</th>
              <th style={s.th}>{t("runs.table.verdict")}</th>
              <th style={s.th}>{t("runs.table.findings")}</th>
              <th style={s.th}>{t("runs.table.cost")}</th>
              <th style={s.th}>{t("runs.table.duration")}</th>
              <th style={s.th}>{t("runs.table.status")}</th>
              <th style={s.th}>{t("runs.table.job")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((run) => {
              const isRecorded = run.status === "recorded";
              return (
                <tr key={run.id} style={s.row}>
                  <td style={s.td}>{run.repo}</td>
                  <td style={s.tdMuted} className="tnum">
                    {run.pr_number != null ? `#${run.pr_number}` : "—"}
                  </td>
                  <td style={s.td}>{run.agent_name ?? "—"}</td>
                  <td style={s.td}>
                    {isRecorded && run.verdict ? (
                      <>
                        <span style={s.wordChip(run.verdict === "changes_requested" ? "crit" : "neutral")}>
                          {t(`runs.verdict.${VERDICT_KEY[run.verdict]}`)}
                        </span>
                        {run.verdict === "skipped" && <div style={s.forkNote}>{t("runs.forkSkipped")}</div>}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td style={s.td} className="tnum">
                    {isRecorded && run.findings_count != null ? run.findings_count : "—"}
                  </td>
                  <td style={s.tdMuted} className="tnum">
                    {formatCost(run.cost_usd)}
                  </td>
                  <td style={s.tdMuted} className="tnum">
                    {formatDuration(run.duration_ms)}
                  </td>
                  <td style={s.td}>
                    <span style={s.wordChip(run.status === "unavailable" ? "warn" : run.status === "in_progress" ? "neutral" : "ok")}>
                      {t(`runs.runStatus.${STATUS_KEY[run.status]}`)}
                    </span>
                    {run.status === "unavailable" && run.unavailable_reason && (
                      <div style={s.unavailableReason}>{run.unavailable_reason}</div>
                    )}
                  </td>
                  <td style={s.td} title={formatWhen(run.ran_at)}>
                    {isHttpsUrl(run.job_url) ? (
                      <a href={run.job_url} target="_blank" rel="noopener noreferrer">
                        {t("runs.jobLink")}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
