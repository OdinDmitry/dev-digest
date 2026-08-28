/* AgentPanel — one multi-agent column (design ref 04/05). Header: agent
   name + one-line description, score, duration/cost exactly as recorded
   (AC-16), and a textual state label for every status (NFR). Findings use
   the promoted FindingCard, so accept/dismiss/turn-into-eval-case are
   exactly the three actions offered (AC-17). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, CircularScore, Icon } from "@devdigest/ui";
import type { AgentColumn } from "@devdigest/shared";
import { FindingCard } from "@/components/finding-card/FindingCard";
import { useFindingAction } from "@/lib/hooks/reviews";
import { formatCost } from "@/lib/format-cost";
import { formatDuration } from "@/lib/format-duration";
import { s } from "./styles";

export function AgentPanel({
  column,
  prId,
  repoFullName,
  headSha,
  onViewTrace,
}: {
  column: AgentColumn;
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
  onViewTrace: () => void;
}) {
  const t = useTranslations("runs");
  const action = useFindingAction();

  const stateLabel = t(`column.state.${column.status}`);
  const stateStyle =
    column.status === "running"
      ? s.stateLabelRunning
      : column.status === "failed"
        ? s.stateLabelFailed
        : s.stateLabelDone;

  return (
    <div style={s.panel}>
      <div style={s.header}>
        {column.score != null ? (
          <CircularScore score={column.score} size={44} />
        ) : (
          <div style={s.scoreFallback}>—</div>
        )}
        <div style={s.headerMain}>
          <div style={s.agentName}>{column.agent_name}</div>
          {column.agent_description && (
            <div style={s.agentDescription}>{column.agent_description}</div>
          )}
          <div style={s.metaRow}>
            <span style={{ ...s.stateLabel, ...stateStyle }}>
              {column.status === "running" && (
                <Icon.RefreshCw size={12} style={s.spinIcon} />
              )}{" "}
              {stateLabel}
            </span>
            <span>{formatDuration(column.duration_ms)}</span>
            <span>{formatCost(column.cost_usd)}</span>
          </div>
        </div>
        <Button
          kind="ghost"
          size="sm"
          icon="FileText"
          onClick={onViewTrace}
          aria-label={`${t("viewTrace")} — ${column.agent_name}`}
        >
          {t("viewTrace")}
        </Button>
      </div>

      {column.status === "failed" && column.error && (
        <div style={s.errorBox}>{column.error}</div>
      )}

      <div style={s.toolbar}>
        {column.findings.length > 0
          ? t("column.findingsCount", { count: column.findings.length })
          : null}
      </div>

      <div style={s.list}>
        {column.findings.length === 0 ? (
          <div style={s.empty}>{t("column.noFindings")}</div>
        ) : (
          column.findings.map((f) => (
            <FindingCard
              key={f.id}
              f={f}
              pending={action.isPending}
              repoFullName={repoFullName}
              headSha={headSha}
              onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
            />
          ))
        )}
      </div>
    </div>
  );
}
