/* Route: /evals (Eval Dashboard). One AgentEvalRow per agent that has an
   eval set (SPEC-03 AC-35). Thin route entry — data fetching, the run-all
   confirmation and per-agent rows live in colocated _components. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../components/app-shell";
import { useEvalDashboard } from "../../lib/hooks/evals";
import { AgentEvalRow } from "./_components/AgentEvalRow";
import { RunAllAgentsDialog } from "./_components/RunAllAgentsDialog";

export default function EvalDashboardPage() {
  const t = useTranslations("eval");
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useEvalDashboard();
  const [confirming, setConfirming] = React.useState(false);

  const agentCount = data?.run_all.agent_count ?? 0;
  const caseCount = data?.run_all.case_count ?? 0;
  const agents = data?.agents ?? [];

  return (
    <AppShell crumb={[{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard") }]}>
      {confirming && (
        <RunAllAgentsDialog
          agentCount={agentCount}
          caseCount={caseCount}
          onClose={() => setConfirming(false)}
        />
      )}
      <div style={{ padding: 28, maxWidth: 960, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, flex: 1 }}>{t("dashboard.defaultTitle")}</h1>
          <Button
            kind="primary"
            icon="Play"
            disabled={agentCount === 0}
            onClick={() => setConfirming(true)}
          >
            {t("dashboard.runAllAgents")}
          </Button>
        </div>

        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Skeleton height={72} />
            <Skeleton height={72} />
            <Skeleton height={72} />
          </div>
        )}
        {isError && <ErrorState onRetry={() => refetch()} />}
        {!isLoading && !isError && agents.length === 0 && <EmptyState title={t("dashboard.emptyAgents")} />}
        {!isLoading && !isError && agents.length > 0 && (
          <div>
            {agents.map((entry) => (
              <AgentEvalRow key={entry.agent_id} entry={entry} onActivate={() => router.push(`/evals/${entry.agent_id}`)} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
