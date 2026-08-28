/* ConfigureRun — /multi-agent (design ref 02/03). Step 1: pick a PR
   (?pr=<prId>). Step 2: pick the agents to run, each row showing its own
   duration/cost estimate. Until a PR is chosen, the agent list is replaced
   by an inert "pick a PR first" empty state (present but not hidden). On
   success, navigates to the results route (AC-5). */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Checkbox, EmptyState, FormField, SelectInput } from "@devdigest/ui";
import { useActiveRepo } from "@/lib/repo-context";
import {
  useAgentEstimates,
  useAgents,
  useMultiAgentRun,
  usePulls,
  useStartMultiAgentReview,
} from "@/lib/hooks";
import { aggregateEstimate } from "@/lib/agent-estimates";
import { formatCost } from "@/lib/format-cost";
import { formatDuration } from "@/lib/format-duration";
import { s } from "./styles";

export function ConfigureRun() {
  const t = useTranslations("runs");
  const tPr = useTranslations("prReview");
  const router = useRouter();
  const search = useSearchParams();
  const { repoId } = useActiveRepo();

  const { data: pulls } = usePulls(repoId);
  const { data: agents } = useAgents();
  const { data: estimates } = useAgentEstimates();
  const start = useStartMultiAgentReview();

  const prId = search.get("pr");
  // A run already exists for the chosen PR → offer a way back to its results.
  // Without this the results route is only reachable by starting a NEW run
  // (`submit` below), which costs real model calls just to re-read a finished
  // review. The hook no-ops while `prId` is null (`enabled: !!prId`).
  const { data: existingRun } = useMultiAgentRun(prId);

  const setPr = (id: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("pr", id);
    router.replace(`/multi-agent?${sp.toString()}`);
  };

  const [selected, setSelected] = React.useState<string[]>([]);
  const allAgents = agents ?? [];
  const allEstimates = estimates ?? [];
  const allSelected = allAgents.length > 0 && selected.length === allAgents.length;

  const toggleAgent = (agentId: string) => {
    setSelected((prev) => (prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]));
  };
  const selectAll = () => setSelected(allSelected ? [] : allAgents.map((a) => a.id));

  const estimateLabel = (agentId: string): string => {
    const estimate = allEstimates.find((e) => e.agent_id === agentId);
    if (!estimate || (estimate.duration_ms == null && estimate.cost_usd == null)) {
      return t("page.estimate.unavailable");
    }
    return `${formatDuration(estimate.duration_ms)} · ${formatCost(estimate.cost_usd)}`;
  };

  const aggregate = aggregateEstimate(selected, allEstimates);
  const canRun = !!prId && selected.length > 0;

  const submit = async () => {
    if (!prId) return;
    await start.mutateAsync({ prId, agentIds: selected });
    router.push(`/multi-agent/${prId}`);
  };

  const prOptions = [
    { value: "", label: t("page.selectPr") },
    ...(pulls ?? [])
      .filter((p): p is typeof p & { id: string } => !!p.id)
      // Same order the Pull Requests list shows by default (`sort=newest`):
      // `updated_at` descending, unparseable/missing dates last. `.filter()`
      // above already copied, so sorting here does not mutate the query cache.
      .sort((a, b) => (Date.parse(b.updated_at ?? "") || 0) - (Date.parse(a.updated_at ?? "") || 0))
      .map((p) => ({ value: p.id, label: t("page.prItem", { number: p.number, title: p.title }) })),
  ];

  return (
    <div style={s.page}>
      <h1 style={s.title}>{t("page.configure.title")}</h1>

      <FormField
        label={t("page.selectPr")}
        right={
          prId && existingRun ? (
            <button
              type="button"
              style={s.linkButton}
              onClick={() => router.push(`/multi-agent/${prId}`)}
            >
              {t("page.configure.viewLatest")}
            </button>
          ) : null
        }
      >
        <SelectInput value={prId ?? ""} onChange={setPr} options={prOptions} mono={false} />
      </FormField>

      <FormField
        label={t("page.configure.agentsToRun")}
        right={
          prId && allAgents.length > 0 ? (
            <button type="button" style={s.linkButton} onClick={selectAll}>
              {t("page.configure.selectAll")}
            </button>
          ) : null
        }
      >
        {!prId ? (
          <div style={s.emptyState}>{t("page.configure.pickPrFirst")}</div>
        ) : allAgents.length === 0 ? (
          <EmptyState title={tPr("runReview.noAgentsAvailable")} />
        ) : (
          <div style={s.list}>
            {allAgents.map((agent) => (
              <div key={agent.id} style={s.row}>
                <Checkbox
                  checked={selected.includes(agent.id)}
                  onChange={() => toggleAgent(agent.id)}
                  label={agent.name}
                />
                <span style={s.estimate}>{estimateLabel(agent.id)}</span>
              </div>
            ))}
          </div>
        )}
      </FormField>

      <div style={s.footer}>
        <div style={s.aggregate}>
          {selected.length > 0 && (
            <>
              {formatDuration(aggregate.duration_ms)} · {formatCost(aggregate.cost_usd)}
              {!aggregate.complete && <span style={s.incomplete}> · {t("page.estimate.incomplete")}</span>}
            </>
          )}
        </div>
        <Button kind="primary" disabled={!canRun} loading={start.isPending} onClick={submit}>
          {t("page.configure.run", { count: selected.length })}
        </Button>
      </div>
    </div>
  );
}
