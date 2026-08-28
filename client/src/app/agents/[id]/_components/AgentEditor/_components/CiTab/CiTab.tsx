/* CiTab — the agent editor's CI view (AC-1, AC-9, AC-23): lists the
   repositories this agent is installed in, states in a word whether the
   installed workflow is the version an export would generate now
   (`CiInstallation.current` is already computed server-side — AC-9), and
   shows this agent's recent CI runs below (omitted entirely when there are
   none). The add-to-CI control opens `ExportWizard` at its target step; with
   no repository in the workspace it is disabled and says so (edge case). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Skeleton } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useCiInstallations, useAgentCiRuns, useRepos } from "@/lib/hooks";
import { ExportWizard } from "./_components/ExportWizard";
import type { WizardState } from "./_components/ExportWizard/reducer";
import { formatWhen, runsForInstallation } from "./helpers";
import { formatCost } from "@/lib/format-cost";
import { s } from "./styles";

const VERDICT_KEY: Record<string, string> = {
  approved: "approved",
  changes_requested: "changesRequested",
  commented: "commented",
  skipped: "skipped",
};
const STATUS_KEY: Record<string, string> = {
  in_progress: "inProgress",
  recorded: "recorded",
  unavailable: "unavailable",
};

export function CiTab({ agent }: { agent: Agent }) {
  const t = useTranslations("ci");
  const installations = useCiInstallations(agent.id);
  const runs = useAgentCiRuns(agent.id);
  const repos = useRepos();
  const [wizardStep, setWizardStep] = React.useState<WizardState["step"] | null>(null);

  const hasRepos = (repos.data ?? []).length > 0;
  const installList = installations.data ?? [];
  const runList = runs.data ?? [];

  return (
    <div style={s.wrap}>
      {wizardStep !== null && (
        <ExportWizard agent={agent} initialStep={wizardStep} onClose={() => setWizardStep(null)} />
      )}

      <div style={s.header}>
        <div>
          <h2 style={s.h2}>{t("ciTab.heading")}</h2>
          <p style={s.subtitle}>{t("ciTab.subtitle")}</p>
        </div>
        <div style={s.addCol}>
          <Button kind="primary" icon="Plus" disabled={!hasRepos} onClick={() => setWizardStep(0)}>
            {t("ciTab.exportToCi")}
          </Button>
          {!hasRepos && <div style={s.hint}>{t("ciTab.noRepo")}</div>}
        </div>
      </div>

      {installations.isLoading ? (
        <Skeleton height={80} />
      ) : installList.length === 0 ? (
        <p style={s.hint}>{t("ciTab.noInstallations")}</p>
      ) : (
        <div>
          <h3 style={s.h3}>{t("ciTab.installationsHeading")}</h3>
          <div style={s.list}>
            {installList.map((inst) => {
              const instRuns = runsForInstallation(runList, inst.id);
              return (
                <div key={inst.id} style={s.row}>
                  <div style={s.rowMain}>
                    <div style={s.rowTitle} className="mono">
                      {inst.repo}
                    </div>
                    <div style={s.rowMeta}>
                      {t("ciTab.target")}: {inst.target_type} · {t("ciTab.installedOn")}: {formatWhen(inst.installed_at)} ·{" "}
                      {t("ciTab.threshold")}: {inst.ci_fail_on}
                    </div>
                    {instRuns.length === 0 && <div style={s.hint}>{t("ciTab.noRunsForInstallation")}</div>}
                  </div>
                  <span style={s.currencyWord(inst.current)}>
                    {inst.current ? t("ciTab.workflowCurrent") : t("ciTab.workflowOutdated")}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {runList.length > 0 && (
        <div>
          <h3 style={s.h3}>{t("ciTab.recentRunsHeading")}</h3>
          <div style={s.list}>
            {runList.map((run) => (
              <div key={run.id} style={s.runRow}>
                <span className="mono">{run.repo}</span>
                {run.pr_number != null && <span className="mono">#{run.pr_number}</span>}
                <span style={s.wordChip}>{t(`runs.runStatus.${STATUS_KEY[run.status]}`)}</span>
                {run.status === "recorded" && run.verdict && (
                  <span style={s.wordChip}>{t(`runs.verdict.${VERDICT_KEY[run.verdict]}`)}</span>
                )}
                {run.status === "recorded" && run.findings_count != null && (
                  <span style={s.runMeta}>{run.findings_count}</span>
                )}
                <span style={s.runMeta}>{formatCost(run.cost_usd)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
