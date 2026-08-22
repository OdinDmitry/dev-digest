/* RunAllAgentsDialog — confirms the run-all-agents action before anything
   starts, stating how many agents and how many cases it will evaluate
   (SPEC-03 AC-32). Confirming calls `useRunAllAgents` (AC-31). This dialog is
   NOT one of the two named by AC-43/AC-44 ("the eval case dialog or the
   comparison dialog"), so it does not use `useFocusTrap` — only its own
   `padding: 24` wrapper (Modal applies none, see client/insights.md). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";
import { useRunAllAgents } from "../../../../lib/hooks/evals";

export function RunAllAgentsDialog({
  agentCount,
  caseCount,
  onClose,
}: {
  agentCount: number;
  caseCount: number;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const c = useTranslations("common");
  const runAll = useRunAllAgents();

  const confirm = async () => {
    await runAll.mutateAsync();
    onClose();
  };

  return (
    <Modal
      width={440}
      title={t("dashboard.runAllConfirmTitle")}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Button kind="ghost" onClick={onClose} disabled={runAll.isPending}>
            {c("actions.cancel")}
          </Button>
          <Button kind="primary" icon="Play" onClick={confirm} disabled={runAll.isPending}>
            {c("actions.run")}
          </Button>
        </div>
      }
    >
      <div style={{ padding: 24 }}>{t("dashboard.runAllConfirmBody", { agents: agentCount, cases: caseCount })}</div>
    </Modal>
  );
}
