/* EvalsTab — an agent's frozen eval case set (AC-56). SPEC-04 moved the run
   history off this surface entirely (AC-59) — it now lives only on the
   dashboard (`/eval`, `EvalDashboardView`). What stays here: the latest
   COMPLETED run's metrics (AC-57), a passed-cases counter over the set's own
   most recent results (AC-58), the run control itself (whose own label
   carries "N of M cases run" while a run is in progress, AC-60), and each
   case's own pass/fail/never-run state, expectation and expected/returned
   finding counts (AC-52/AC-53). A single-case verification (AC-46) is a
   quick, synchronous action from the row — never a run: it writes only that
   case's `latest_result`, never appears in run history and never moves a
   run's metrics. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, IconBtn, Skeleton, TextInput, type IconName } from "@devdigest/ui";
import type { Agent, EvalCaseRecord } from "@devdigest/shared";
import { formatMetricPercent, formatPassCount, type DisplayValue } from "@/components/eval-runs/helpers";
import {
  useAgentEvalCases,
  useAgentEvalRuns,
  useDeleteEvalCase,
  useStartEvalRun,
  useUpdateEvalCase,
  useVerifyEvalCase,
} from "../../../../../../../lib/hooks/eval";
import {
  caseExpectation,
  expectedFindingCount,
  latestCompletedRun,
  passedCaseCount,
  runningRun,
} from "./helpers";
import { s } from "./styles";

type T = (key: string, values?: Record<string, string | number>) => string;

function Metric({ label, value, t }: { label: string; value: DisplayValue; t: T }) {
  return (
    <div style={s.metricCard}>
      <div style={s.metricLabel}>{label}</div>
      <div
        className="tnum"
        style={s.metricValue}
        aria-label={value.absent ? t("runHistory.notAvailable") : undefined}
      >
        {value.text}
      </div>
    </div>
  );
}

function severityCategoryLabel(c: EvalCaseRecord, notAvailable: string): string {
  return `${c.severity ?? notAvailable} · ${c.category ?? notAvailable}`;
}

/** A returned finding's own `title`/`severity` are `.nullish()` on the wire
 *  (older persisted results predate them) — never collapsed to an empty
 *  string or a made-up default. `absent` drives the accessible label; the
 *  em dash is what renders. */
function displayOrAbsent(v: string | null | undefined): { text: string; absent: boolean } {
  return v == null ? { text: "—", absent: true } : { text: v, absent: false };
}

/** AC-52/AC-54 — passed / failed / never-run is stated as TEXT; the icon is
 *  purely decorative (`aria-hidden`) and never the only carrier of state. */
function statusIconName(result: EvalCaseRecord["latest_result"]): IconName {
  if (result == null) return "Dot";
  return result.passed === true ? "CheckCircle" : "XCircle";
}

function CaseRow({ c, agentId, t }: { c: EvalCaseRecord; agentId: string; t: T }) {
  const update = useUpdateEvalCase();
  const del = useDeleteEvalCase();
  const verify = useVerifyEvalCase();
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(c.name);

  const notAvailable = t("runHistory.notAvailable");
  const result = c.latest_result;
  const expectation = caseExpectation(c);
  const statusText = result == null ? t("evalsTab.neverRun") : result.passed === true ? t("evalsTab.passed") : t("evalsTab.failed");
  const StatusIcon = Icon[statusIconName(result)];

  const saveName = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== c.name) {
      update.mutate({ id: c.id, agentId, patch: { name: trimmed } });
    }
    setEditing(false);
  };

  return (
    <div style={s.row}>
      <div style={s.rowMain}>
        <StatusIcon size={18} aria-hidden="true" />
        <div style={s.rowInfo}>
          <div style={s.nameRow}>
            <span style={s.name}>{c.name}</span>
          </div>
          <div className="mono" style={s.location}>
            {c.file}:{c.start_line === c.end_line ? c.start_line : `${c.start_line}-${c.end_line}`}
          </div>
          {/* A polite live region: verifying this case re-renders this text
              once the case-set query is invalidated, and the region carries
              that outcome to assistive tech without moving focus (AC-47). */}
          <div style={s.statusRow} role="status" aria-live="polite">
            <span>{statusText}</span>
            {result && (
              <span>
                {t("evalsTab.resultLine", {
                  expected: expectedFindingCount(c),
                  got: result.matched_count,
                })}
              </span>
            )}
          </div>
          {/* AC-52 — the expectation type is stated on the row itself, not
              only once the panel below is opened. Same copy/treatment as the
              case form's own statement (`caseModal.kind.*`, reused rather
              than a new label). */}
          <p style={{ ...s.hint, marginTop: 2 }}>
            {expectation ? t(`caseModal.kind.${expectation.kind}`) : notAvailable}
          </p>
        </div>
        <span style={s.badge}>{severityCategoryLabel(c, notAvailable)}</span>
        <div style={s.rowActions}>
          <IconBtn
            icon="Play"
            label={t("evalsTab.verifyCaseLabel", { name: c.name })}
            onClick={() => verify.mutate({ id: c.id, agentId })}
          />
          <IconBtn icon="Edit" label={t("evalsTab.editCaseLabel", { name: c.name })} onClick={() => setOpen((o) => !o)} />
          <IconBtn
            icon="Trash"
            danger
            label={t("evalsTab.deleteCaseLabel", { name: c.name })}
            onClick={() => {
              if (window.confirm(t("evalsTab.deleteCaseLabel", { name: c.name }))) {
                del.mutate({ id: c.id, agentId });
              }
            }}
          />
        </div>
      </div>

      {open && (
        <div style={s.panel}>
          {editing ? (
            <div style={s.editForm}>
              <TextInput value={name} onChange={setName} aria-label={t("evalsTab.editNameLabel")} />
              <Button kind="ghost" size="sm" onClick={saveName} disabled={update.isPending}>
                {t("evalsTab.saveEdit")}
              </Button>
              <Button
                kind="ghost"
                size="sm"
                onClick={() => {
                  setName(c.name);
                  setEditing(false);
                }}
              >
                {t("evalsTab.cancelEdit")}
              </Button>
            </div>
          ) : (
            <div style={s.editForm}>
              <span style={s.name}>{c.name}</span>
              <Button kind="ghost" size="sm" onClick={() => setEditing(true)}>
                {t("evalsTab.edit")}
              </Button>
            </div>
          )}

          <div>
            <div style={s.h3}>{t("evalsTab.expectationHeading")}</div>
            <p style={s.hint}>{expectation ? t(`caseModal.kind.${expectation.kind}`) : notAvailable}</p>
          </div>

          <div>
            <div style={s.h3}>{t("evalsTab.lastResultHeading")}</div>
            {!result ? (
              <p style={s.hint}>{t("evalsTab.noResultYet")}</p>
            ) : result.findings.length === 0 ? (
              <p style={s.hint}>{t("evalsTab.noFindingsInResult")}</p>
            ) : (
              <div style={s.fragmentList}>
                {result.findings.map((f, i) => {
                  const title = displayOrAbsent(f.title);
                  const severity = displayOrAbsent(f.severity);
                  return (
                    <div key={i} style={s.fragmentItem}>
                      <div style={s.fragmentHead}>
                        {/* Model output, rendered as inert text — never markup,
                            never interpolated into an href (SPEC-04 § Untrusted
                            inputs). */}
                        <span
                          style={s.fragmentTitle}
                          aria-label={title.absent ? notAvailable : undefined}
                        >
                          {title.text}
                        </span>
                        <span
                          style={s.fragmentSeverity}
                          aria-label={severity.absent ? notAvailable : undefined}
                        >
                          {severity.text}
                        </span>
                      </div>
                      <span className="mono" style={s.fragmentMeta}>
                        {f.file}:{f.start_line === f.end_line ? f.start_line : `${f.start_line}-${f.end_line}`} ·{" "}
                        {f.grounded ? t("evalsTab.grounded") : t("evalsTab.ungrounded")}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <Button
              kind="secondary"
              size="sm"
              icon="Play"
              disabled={verify.isPending}
              onClick={() => verify.mutate({ id: c.id, agentId })}
            >
              {verify.isPending ? t("evalsTab.verifying") : t("evalsTab.verify")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function EvalsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("eval");
  const { data: cases, isLoading: casesLoading } = useAgentEvalCases(agent.id);
  const { data: runs } = useAgentEvalRuns(agent.id);
  const startRun = useStartEvalRun();

  const list = cases ?? [];
  const running = runningRun(runs);
  const completedRun = latestCompletedRun(runs);
  const inProgress = !!running || startRun.isPending;

  const progressLabel = running
    ? t("evalsTab.progress", { completed: running.cases_completed, total: running.cases_total })
    : t("evalsTab.running");
  const runButtonLabel = inProgress ? progressLabel : t("evalsTab.run");

  return (
    <div style={s.wrap}>
      <div>
        <div style={s.header}>
          <h2 style={s.h2}>{t("evalsTab.metricsTitle")}</h2>
        </div>

        {completedRun ? (
          <div style={s.metricsGrid}>
            <Metric label={t("dashboard.metrics.recall")} value={formatMetricPercent(completedRun.recall)} t={t} />
            <Metric
              label={t("dashboard.metrics.precision")}
              value={formatMetricPercent(completedRun.precision)}
              t={t}
            />
            <Metric
              label={t("dashboard.metrics.citationAccuracy")}
              value={formatMetricPercent(completedRun.citation_accuracy)}
              t={t}
            />
            <Metric
              label={t("dashboard.table.pass")}
              value={formatPassCount(completedRun.cases_passed, completedRun.cases_total)}
              t={t}
            />
          </div>
        ) : (
          <p style={s.hint}>{t("evalsTab.noRunYet")}</p>
        )}

        {/* AC-58 — independent of whether a suite run ever completed: a
            case's `latest_result` can come from a verification too. */}
        {list.length > 0 && (
          <p style={s.passingCount}>
            {t("evalsTab.casesPassing", { passed: passedCaseCount(list), total: list.length })}
          </p>
        )}
      </div>

      <div>
        <div style={s.header}>
          <h2 style={s.h2}>{t("evalsTab.casesHeading")}</h2>
          <Button
            kind="primary"
            size="sm"
            icon="Play"
            aria-label={inProgress ? undefined : t("evalsTab.runControlLabel", { count: list.length })}
            disabled={list.length === 0 || inProgress}
            onClick={() => startRun.mutate(agent.id)}
          >
            {runButtonLabel}
          </Button>
          {inProgress && (
            <span role="status" aria-live="polite" style={s.srOnly}>
              {progressLabel}
            </span>
          )}
        </div>

        {casesLoading ? (
          <Skeleton height={80} />
        ) : list.length === 0 ? (
          <p style={s.hint}>{t("evalsTab.emptyCases")}</p>
        ) : (
          <div style={s.list}>
            {list.map((c) => (
              <CaseRow key={c.id} c={c} agentId={agent.id} t={t} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
