/* RunReviewDropdown — a multi-select agent picker (design ref 01).
   Replaces the old single-choice Dropdown menu: pick any subset of agents
   (each row showing its own duration/cost estimate) and kick off
   POST /pulls/:id/multi-agent-run, handing the resulting runIds up so the
   parent can stream SSE live status without navigating (AC-3). */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Checkbox } from "@devdigest/ui";
import { useAgents } from "@/lib/hooks/agents";
import { useAgentEstimates, useStartMultiAgentReview } from "@/lib/hooks/multi-agent";
import { formatDuration } from "@/lib/format-duration";
import { formatCost } from "@/lib/format-cost";
import { s } from "./styles";

export function RunReviewDropdown({
  prId,
  size = "sm",
  kind = "primary",
  warnMerged = false,
  onRunStart,
  onRunsStarted,
  onRunSettled,
}: {
  prId: string;
  size?: "sm" | "md" | "lg";
  kind?: "primary" | "secondary";
  /** PR is already merged/closed — dim the trigger and warn, but still allow. */
  warnMerged?: boolean;
  /** Fired the moment a run is kicked off (before it completes). */
  onRunStart?: () => void;
  onRunsStarted?: (runIds: string[]) => void;
  /** Fired when the run request settles (success or error). */
  onRunSettled?: () => void;
}) {
  const t = useTranslations("prReview");
  const tRuns = useTranslations("runs");
  const router = useRouter();
  const { data: agents } = useAgents();
  const { data: estimates } = useAgentEstimates();
  const start = useStartMultiAgentReview();

  const all = agents ?? [];
  const estimateByAgentId = React.useMemo(
    () => new Map((estimates ?? []).map((e) => [e.agent_id, e])),
    [estimates],
  );

  const [open, setOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<string[]>([]);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      containerRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggleAgent = (agentId: string) => {
    setSelected((prev) => (prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]));
  };

  const estimateLabel = (agentId: string): string => {
    const estimate = estimateByAgentId.get(agentId);
    if (!estimate || (estimate.duration_ms == null && estimate.cost_usd == null)) {
      return tRuns("page.estimate.unavailable");
    }
    return `${formatDuration(estimate.duration_ms)} · ${formatCost(estimate.cost_usd)}`;
  };

  const submit = async () => {
    onRunStart?.();
    try {
      const res = await start.mutateAsync({ prId, agentIds: selected });
      onRunsStarted?.(res.runs.map((r) => r.run_id));
      setOpen(false);
      setSelected([]);
    } finally {
      onRunSettled?.();
    }
  };

  return (
    <div ref={containerRef} style={s.container}>
      <span
        title={warnMerged ? t("runReview.mergedTooltip") : undefined}
        style={warnMerged ? { opacity: 0.6 } : undefined}
      >
        <Button
          kind={kind}
          size={size}
          iconRight="ChevronDown"
          icon="Sparkles"
          loading={start.isPending}
          aria-expanded={open}
          aria-haspopup="true"
          onClick={() => setOpen((o) => !o)}
        >
          {start.isPending ? t("runReview.running") : t("runReview.runReview")}
        </Button>
      </span>
      {open && (
        <div style={s.popover}>
          <div style={s.header}>
            <span style={s.headerTitle}>{t("runReview.pickAgents")}</span>
            <button type="button" style={s.linkButton} onClick={() => setSelected([])}>
              {t("runReview.clear")}
            </button>
          </div>

          {warnMerged && <div style={s.mergedWarning}>{t("runReview.mergedWarning")}</div>}

          {all.length === 0 ? (
            <div style={s.emptyState}>{t("runReview.noAgentsAvailable")}</div>
          ) : (
            <div style={s.list}>
              {all.map((agent) => (
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

          <div style={s.footer}>
            <button type="button" style={s.linkButton} onClick={() => router.push("/agents")}>
              {t("runReview.configureAgents")}
            </button>
            <Button kind="primary" size="sm" disabled={selected.length === 0} onClick={submit}>
              {t("runReview.runMultiAgent", { count: selected.length })}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
