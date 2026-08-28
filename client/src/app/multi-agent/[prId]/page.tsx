/* Route: /multi-agent/:prId (Multi-Agent Review results). All four pieces of
   view state live in the URL so a mid-run reload restores them:
   ?view=columns|tabs, ?conflicts=1, ?agent=<agentId> (tabs mode) and
   ?trace=<runId> (Edge cases). */
"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useMultiAgentRun } from "@/lib/hooks";
import RunTraceDrawer from "@/components/run-trace-drawer/RunTraceDrawer";
import { AgentPanel } from "./_components/AgentPanel";
import { ResultsHeader } from "./_components/ResultsHeader";
import { DisagreementBlock } from "./_components/DisagreementBlock";
import { LiveStateAnnouncer } from "./_components/LiveStateAnnouncer";
import { VIEW_MODES, isViewMode } from "./_components/constants";

export default function MultiAgentResultsPage() {
  const t = useTranslations("runs");
  const params = useParams<{ prId: string }>();
  const prId = params.prId;
  const router = useRouter();
  const search = useSearchParams();

  const { data: run, isLoading, isError, refetch } = useMultiAgentRun(prId);

  const viewParam = search.get("view");
  const view = isViewMode(viewParam) ? viewParam : VIEW_MODES[0];
  const conflictsOnly = search.get("conflicts") === "1";
  const selectedAgentId = search.get("agent");
  const traceRunId = search.get("trace");

  const setParam = (key: string, value: string | null) => {
    const sp = new URLSearchParams(search.toString());
    if (value == null) sp.delete(key);
    else sp.set(key, value);
    router.replace(`/multi-agent/${prId}${sp.toString() ? `?${sp.toString()}` : ""}`);
  };

  const crumb = [
    { label: "Multi-Agent Review", href: "/multi-agent" },
    { label: run?.pr_number != null ? `#${run.pr_number}` : "…", mono: true },
  ];

  if (isLoading) {
    return (
      <AppShell crumb={crumb}>
        <div style={{ padding: "24px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
          <Skeleton height={28} width={320} />
          <Skeleton height={220} />
        </div>
      </AppShell>
    );
  }

  if (isError) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState fullScreen onRetry={() => refetch()} title="Couldn't load this review" />
      </AppShell>
    );
  }

  if (!run) {
    return (
      <AppShell crumb={crumb}>
        <EmptyState
          title={t("page.results.empty.title")}
          body={t("page.results.empty.body")}
          cta={t("page.results.empty.cta")}
          onCta={() => router.push("/multi-agent")}
        />
      </AppShell>
    );
  }

  const activeAgentId = selectedAgentId ?? run.columns[0]?.agent_id ?? null;
  const activeColumn = run.columns.find((c) => c.agent_id === activeAgentId) ?? null;
  const traceColumn = run.columns.find((c) => c.run_id === traceRunId) ?? null;

  return (
    <AppShell crumb={crumb}>
      <LiveStateAnnouncer columns={run.columns} />

      <div style={{ padding: "24px 32px 44px", display: "flex", flexDirection: "column", gap: 24 }}>
        <ResultsHeader
          run={run}
          view={view}
          onSetView={(v) => setParam("view", v)}
          selectedAgentId={activeAgentId}
          onSelectAgent={(id) => setParam("agent", id)}
        />

        {view === "columns" ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${Math.max(run.columns.length, 1)}, minmax(280px, 1fr))`,
              gap: 16,
              overflowX: "auto",
            }}
          >
            {run.columns.map((column) => (
              <AgentPanel key={column.run_id} column={column} prId={run.pr_id} onViewTrace={() => setParam("trace", column.run_id)} />
            ))}
          </div>
        ) : (
          activeColumn && (
            <AgentPanel column={activeColumn} prId={run.pr_id} onViewTrace={() => setParam("trace", activeColumn.run_id)} />
          )
        )}

        {/* Below the per-agent panels, per design refs 04/05: the panels are
            the primary result, the disagreement block reads them across. */}
        <DisagreementBlock
          conflicts={run.conflicts}
          onlyConflicts={conflictsOnly}
          onToggle={(v) => setParam("conflicts", v ? "1" : null)}
        />
      </div>

      {traceColumn && (
        <RunTraceDrawer
          runId={traceColumn.run_id}
          prNumber={run.pr_number}
          agentName={traceColumn.agent_name}
          findings={traceColumn.findings}
          running={traceColumn.status === "running"}
          onClose={() => setParam("trace", null)}
        />
      )}
    </AppShell>
  );
}
