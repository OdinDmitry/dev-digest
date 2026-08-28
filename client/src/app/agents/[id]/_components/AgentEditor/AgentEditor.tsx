/* AgentEditor — agent config (model + system prompt) and the skills attached to
   it. Later lessons add a Stats tab. Tab state lives in ?tab=. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Tabs } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { ContextAttachPanel } from "@/components/context-attach/ContextAttachPanel";
import { ConfigTab } from "./_components/ConfigTab";
import { SkillsTab } from "./_components/SkillsTab";
import { EvalsTab } from "./_components/EvalsTab";
import { CiTab } from "./_components/CiTab";
import { TABS } from "./constants";
import { s } from "./styles";

export function AgentEditor({ agent, tab, onTab }: { agent: Agent; tab: string; onTab: (t: string) => void }) {
  const t = useTranslations("agents");
  const tc = useTranslations("context");
  const tabs = TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey), icon: tb.icon }));
  return (
    <div style={s.wrap}>
      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={onTab} pad="0 24px" />
      </div>
      <div style={s.body}>
        {tab === "skills" ? (
          <SkillsTab agent={agent} />
        ) : tab === "context" ? (
          <ContextAttachPanel ownerKind="agent" ownerId={agent.id} hint={tc("orderHint")} />
        ) : tab === "evals" ? (
          <EvalsTab agentId={agent.id} />
        ) : tab === "ci" ? (
          <CiTab agent={agent} />
        ) : (
          <ConfigTab agent={agent} />
        )}
      </div>
    </div>
  );
}
