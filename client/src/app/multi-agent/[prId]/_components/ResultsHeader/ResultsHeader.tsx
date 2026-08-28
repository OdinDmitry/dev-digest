/* ResultsHeader — title, agent count, the group's total duration/cost
   rendered verbatim (AC-16), and the Columns/Tabs mode control. The mode
   control conveys the selected mode via `aria-pressed` and is keyboard
   operable (native <button>s) (NFR). Tabs mode also renders one tab per
   column with the agent's score as text (design ref 05). */
"use client";

import { useTranslations } from "next-intl";
import type { MultiAgentRun } from "@devdigest/shared";
import { formatCost } from "@/lib/format-cost";
import { formatDuration } from "@/lib/format-duration";
import { VIEW_MODES, type ViewMode } from "../constants";
import { s } from "./styles";

export function ResultsHeader({
  run,
  view,
  onSetView,
  selectedAgentId,
  onSelectAgent,
}: {
  run: MultiAgentRun;
  view: ViewMode;
  onSetView: (view: ViewMode) => void;
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
}) {
  const t = useTranslations("runs");
  const activeAgentId = selectedAgentId ?? run.columns[0]?.agent_id ?? null;

  return (
    <div>
      <div style={s.headerRow}>
        <div>
          <h1 style={s.title}>{t("page.title")}</h1>
          <div style={s.meta}>
            {t("page.meta", {
              count: run.agent_count,
              duration: formatDuration(run.total_duration_ms),
              cost: formatCost(run.total_cost_usd),
            })}
          </div>
        </div>
        <div role="group" aria-label={`${t("page.view.columns")} / ${t("page.view.tabs")}`} style={s.modeGroup}>
          {VIEW_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={view === mode}
              style={s.modeButton(view === mode)}
              onClick={() => onSetView(mode)}
            >
              {t(`page.view.${mode}`)}
            </button>
          ))}
        </div>
      </div>

      {view === "tabs" && (
        <div role="tablist" style={s.tabStrip}>
          {run.columns.map((column) => {
            const active = column.agent_id === activeAgentId;
            return (
              <button
                key={column.run_id}
                type="button"
                role="tab"
                aria-selected={active}
                style={s.tab(active)}
                onClick={() => onSelectAgent(column.agent_id)}
              >
                {column.agent_name}
                <span style={s.tabScore}>{column.score ?? "—"}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
