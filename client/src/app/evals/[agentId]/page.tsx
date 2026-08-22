/* Route: /evals/:agentId (agent eval history + compare). Thin route entry:
   owns the run-selection state for the compare workflow (SPEC-03 AC-39) —
   genuine client state, never server data mirrored into component state
   (client/CLAUDE.md, SPEC-03 plan clarification 5) — and composes
   RunHistoryTable + CompareRunsDialog, both colocated under _components. */
"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../components/app-shell";
import { useAgent } from "../../../lib/hooks/agents";
import { useAgentEvalRuns } from "../../../lib/hooks/evals";
import { RunHistoryTable } from "./_components/RunHistoryTable";
import { CompareRunsDialog } from "./_components/CompareRunsDialog";

export default function AgentEvalHistoryPage() {
  const params = useParams<{ agentId: string }>();
  const { agentId } = params;
  const router = useRouter();
  const t = useTranslations("eval");

  const { data: agent, isLoading: agentLoading } = useAgent(agentId);
  const { data: runs, isLoading, isError, refetch } = useAgentEvalRuns(agentId);

  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [comparing, setComparing] = React.useState(false);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 2) {
        next.add(id);
      }
      return next;
    });
  };

  const selectedIds = Array.from(selected);
  const [runIdA, runIdB] = selectedIds;
  const canCompare = selectedIds.length === 2; // AC-39

  return (
    <AppShell
      crumb={[
        { label: t("page.crumbSkillsLab") },
        { label: t("page.crumbEvalDashboard"), href: "/evals" },
        { label: agent?.name ?? "" },
      ]}
    >
      {comparing && runIdA && runIdB && (
        <CompareRunsDialog
          agentId={agentId}
          runIdA={runIdA}
          runIdB={runIdB}
          onClose={() => setComparing(false)}
        />
      )}
      <div style={{ padding: 28, maxWidth: 1040, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <button
            type="button"
            onClick={() => router.push("/evals")}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-secondary)",
              fontSize: 13,
              cursor: "pointer",
              padding: 0,
            }}
          >
            {t("page.crumbEvalDashboard")}
          </button>
          <span style={{ color: "var(--text-muted)" }}>/</span>
          <h1 style={{ fontSize: 18, fontWeight: 700 }}>
            {agentLoading ? <Skeleton width={140} height={18} /> : agent?.name}
          </h1>
          <div style={{ marginLeft: "auto" }}>
            <Button kind="primary" disabled={!canCompare} onClick={() => setComparing(true)}>
              {t("dashboard.compare")}
            </Button>
          </div>
        </div>

        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Skeleton height={40} />
            <Skeleton height={40} />
            <Skeleton height={40} />
          </div>
        )}
        {isError && <ErrorState onRetry={() => refetch()} />}
        {!isLoading && !isError && (
          <RunHistoryTable runs={runs ?? []} selectedIds={selected} onToggleSelect={toggleSelect} />
        )}
      </div>
    </AppShell>
  );
}
