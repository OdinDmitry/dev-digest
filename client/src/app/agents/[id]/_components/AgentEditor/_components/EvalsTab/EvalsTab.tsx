/* EvalsTab — an agent's eval cases: metrics header (T8), the case list (T7)
   and per-case preview runs (T9). SPEC-03.

   Server state (cases / active run / run history) lives entirely in the
   TanStack Query cache via the Step 0 hooks — the only client-owned state
   here is the session-local preview `Map<caseId, EvalPerTrace>` (T9's
   clarification 6: a preview is local to the session that produced it and
   must never enter the query cache) and the dialog's open/mode. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Icon, Button, Skeleton } from "@devdigest/ui";
import type { EvalCase, EvalPerTrace, EvalRunRecord } from "@devdigest/shared";
import {
  useAgentEvalCases,
  useAgentEvalRuns,
  useActiveEvalRun,
  useStartEvalRun,
  usePreviewEvalCase,
  useDeleteEvalCase,
} from "@/lib/hooks";
import { EvalCaseDialog } from "@/components/eval-case-dialog/EvalCaseDialog";
import { s } from "./styles";

/** NFR — the in-progress indicator is a stepped, non-animated form under
 *  `prefers-reduced-motion` instead of a spinning icon. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function pct(v: number | null): string {
  return v == null ? "—" : Math.round(v * 100).toString();
}
function seconds(ms: number | null): string {
  return ms == null ? "—" : (ms / 1000).toFixed(1);
}

type DialogState = { mode: "new" } | { mode: "edit"; caseRecord: EvalCase };

export function EvalsTab({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");
  const reducedMotion = useReducedMotion();

  const cases = useAgentEvalCases(agentId);
  const runs = useAgentEvalRuns(agentId);
  const activeRun = useActiveEvalRun(agentId);
  const startRun = useStartEvalRun(agentId);
  const preview = usePreviewEvalCase();
  const del = useDeleteEvalCase();

  const [dialog, setDialog] = React.useState<DialogState | null>(null);
  // T9 — session-local preview outcomes, keyed by case id. Never mirrored
  // into the query cache.
  const [previewMap, setPreviewMap] = React.useState<Map<string, EvalPerTrace>>(new Map());

  const caseList = cases.data ?? [];
  const running = activeRun.data != null;
  const tracesTotal = activeRun.data?.traces_total ?? 0;
  const tracesDone = activeRun.data
    ? activeRun.data.per_trace.filter((r) => r.status !== "pending").length
    : 0;

  const lastCompletedRun: EvalRunRecord | null = React.useMemo(
    () => (runs.data ?? []).find((r) => r.state === "completed") ?? null,
    [runs.data],
  );

  // AC-45 — announce a terminal run's outcome via an aria-live region, never
  // by moving focus. Fires once the runs list has actually refreshed after
  // this tab observed an active run go away (client/insights.md's ref-based
  // "poll until X, then invalidate Y" pattern, applied one level up: here we
  // wait on the CONSEQUENCE of that invalidation instead of re-deriving it).
  const wasRunningRef = React.useRef(false);
  const pendingAnnounceRef = React.useRef(false);
  const [announcement, setAnnouncement] = React.useState("");
  React.useEffect(() => {
    if (wasRunningRef.current && !running) pendingAnnounceRef.current = true;
    wasRunningRef.current = running;
  }, [running]);
  React.useEffect(() => {
    if (!pendingAnnounceRef.current || !lastCompletedRun) return;
    pendingAnnounceRef.current = false;
    setAnnouncement(
      t("caseEditor.announceComplete", {
        outcome: t("caseEditor.resultSummary", {
          recall: pct(lastCompletedRun.recall),
          precision: pct(lastCompletedRun.precision),
          citation: pct(lastCompletedRun.citation_accuracy),
          duration: seconds(lastCompletedRun.duration_ms),
        }),
      }),
    );
  }, [lastCompletedRun, t]);

  function outcomeFor(c: EvalCase): { outcome: EvalPerTrace | null; isPreview: boolean } {
    const p = previewMap.get(c.id);
    if (p) return { outcome: p, isPreview: true };
    return { outcome: c.last_outcome, isPreview: false };
  }

  function statusVisual(status: EvalPerTrace["status"] | null) {
    switch (status) {
      case "passed":
        return { Icon: Icon.CheckCircle, color: "var(--ok)", label: t("evalsTab.passed") };
      case "failed":
        return { Icon: Icon.XCircle, color: "var(--crit)", label: t("evalsTab.failed") };
      case "errored":
        return { Icon: Icon.AlertTriangle, color: "var(--warn)", label: t("evalsTab.errored") };
      default:
        return { Icon: Icon.Dot, color: "var(--text-muted)", label: t("evalsTab.neverRun") };
    }
  }

  if (cases.isLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={22} width={180} />
        <div style={{ height: 16 }} />
        <Skeleton height={140} />
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      {dialog && (
        <EvalCaseDialog
          mode={dialog.mode}
          agentId={agentId}
          caseRecord={dialog.mode === "edit" ? dialog.caseRecord : undefined}
          onClose={() => setDialog(null)}
          onSaved={() => setDialog(null)}
        />
      )}

      <div style={s.metricsHeader}>
        <div style={s.metricsTitleRow}>
          <div>
            <h2 style={s.h2}>{t("evalsTab.metricsTitle")}</h2>
            <p style={s.subtitle}>{t("evalsTab.metricsSubtitle")}</p>
          </div>
          {/* AC-55 */}
          <Link href={`/evals/${agentId}`} style={s.viewDashboardLink}>
            {t("evalsTab.viewDashboard")}
          </Link>
        </div>

        {running && (
          // AC-24
          <div style={s.progressRow}>
            {reducedMotion ? (
              <div style={s.stepDots} aria-hidden>
                {Array.from({ length: Math.min(tracesTotal, 20) }).map((_, i) => (
                  <span key={i} style={s.stepDot(i < tracesDone)} />
                ))}
              </div>
            ) : (
              <Icon.RefreshCw size={14} style={{ ...s.spinner, animation: "ddspin 1s linear infinite" }} />
            )}
            <span>{t("dashboard.progress", { done: tracesDone, total: tracesTotal })}</span>
          </div>
        )}

        {/* AC-25 — the last COMPLETED run's metrics/outcomes keep rendering
           while a newer run is in progress; "never run" only when there is
           no completed run at all. */}
        {lastCompletedRun ? (
          <div style={s.metricCards}>
            <div style={s.metricCard}>
              <div style={s.tracesLabel}>{t("dashboard.metrics.recall")}</div>
              <div className="mono tnum" style={s.tracesValue}>
                {pct(lastCompletedRun.recall)}%
              </div>
            </div>
            <div style={s.metricCard}>
              <div style={s.tracesLabel}>{t("dashboard.metrics.precision")}</div>
              <div className="mono tnum" style={s.tracesValue}>
                {pct(lastCompletedRun.precision)}%
              </div>
            </div>
            <div style={s.metricCard}>
              <div style={s.tracesLabel}>{t("dashboard.metrics.citationAccuracy")}</div>
              <div className="mono tnum" style={s.tracesValue}>
                {pct(lastCompletedRun.citation_accuracy)}%
              </div>
            </div>
            <div style={s.metricCard}>
              <div style={s.tracesLabel}>{t("dashboard.table.pass")}</div>
              <div className="mono tnum" style={s.tracesValue}>
                {lastCompletedRun.traces_passed}/{lastCompletedRun.traces_total}
              </div>
            </div>
          </div>
        ) : (
          !running && <p style={s.hint}>{t("dashboard.neverRun")}</p>
        )}

        <div aria-live="polite" style={s.srOnly}>
          {announcement}
        </div>
      </div>

      <div style={s.header}>
        <h2 style={s.h2}>{t("evalsTab.casesHeading")}</h2>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {/* AC-22 — absent (not just disabled) when there is no case. */}
          {caseList.length > 0 && (
            <Button
              kind="secondary"
              icon="Play"
              disabled={running} // AC-23
              onClick={() => startRun.mutate()}
            >
              {running ? t("evalsTab.running") : t("evalsTab.runAll")}
            </Button>
          )}
          <Button kind="primary" icon="Plus" onClick={() => setDialog({ mode: "new" })}>
            {t("evalsTab.newCase")}
          </Button>
        </div>
      </div>

      {caseList.length === 0 ? (
        <p style={s.hint}>{t("evalsTab.emptyCases")}</p>
      ) : (
        <div style={s.list}>
          {caseList.map((cs) => {
            const { outcome, isPreview } = outcomeFor(cs);
            const visual = statusVisual(outcome?.status ?? null);
            const primary = cs.expectations[0] ?? null;
            const isRunningThis = preview.isPending && preview.variables?.id === cs.id;

            return (
              <div key={cs.id} style={s.row}>
                <visual.Icon size={18} style={s.statusIcon(visual.color)} />
                <div style={s.rowMain}>
                  <div style={s.nameRow}>
                    <span style={s.name}>{cs.name}</span>
                    {primary?.severity && primary?.category && (
                      <span style={s.chip}>
                        {primary.severity} · {primary.category}
                      </span>
                    )}
                  </div>
                  <div style={s.statusText}>
                    {visual.label}
                    {outcome && (
                      <span style={s.subtextRow}>
                        {" · "}
                        {t("evalsTab.subtext", {
                          expected: outcome.expected_count,
                          got: outcome.matched_count,
                        })}
                      </span>
                    )}
                    {isPreview && <span style={s.previewNote}>{t("evalsTab.previewNotStored")}</span>}
                  </div>
                  {!cs.resolves_context && <div style={s.noContext}>{t("evalsTab.noContext")}</div>}
                </div>

                <div style={s.actions}>
                  <button
                    type="button"
                    aria-label={t("evalsTab.runCaseAria", { name: cs.name })}
                    disabled={isRunningThis}
                    style={s.iconButton(isRunningThis)}
                    onClick={() =>
                      preview.mutate(
                        { id: cs.id },
                        {
                          onSuccess: (result) =>
                            setPreviewMap((prev) => new Map(prev).set(cs.id, result.result)),
                        },
                      )
                    }
                  >
                    {isRunningThis ? (
                      <Icon.RefreshCw size={14} style={{ animation: "ddspin 1s linear infinite" }} />
                    ) : (
                      <Icon.Play size={14} />
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label={t("evalsTab.editCaseAria", { name: cs.name })}
                    style={s.iconButton(false)}
                    onClick={() => setDialog({ mode: "edit", caseRecord: cs })}
                  >
                    <Icon.Edit size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label={t("evalsTab.deleteCaseAria", { name: cs.name })}
                    style={s.iconButton(false)}
                    onClick={() => del.mutate({ id: cs.id })}
                  >
                    <Icon.Trash size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
