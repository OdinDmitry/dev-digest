/* SkillDetail — the right pane: header (name/type/version) + Config/Preview/
   Versions tabs. Always mounted; when nothing is selected it shows either the
   library-empty state (with an import CTA) or a "pick a skill" prompt using
   the pre-existing `page.selectPrompt.*` i18n keys. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, EmptyState, Icon, Tabs } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import type { DetailTabKey } from "../SkillsView/constants";
import { ContextAttachPanel } from "@/components/context-attach/ContextAttachPanel";
import { skillTypeChip } from "../../../../lib/skill-type";
import { ConfigTab } from "./_components/ConfigTab";
import { PreviewTab } from "./_components/PreviewTab";
import { VersionsTab } from "./_components/VersionsTab";
import { TABS } from "./constants";
import { s } from "./styles";

export function SkillDetail({
  skill,
  tab,
  onTab,
  librarySize,
  onImport,
}: {
  skill: Skill | undefined;
  tab: DetailTabKey;
  onTab: (tab: string) => void;
  librarySize: number;
  onImport: () => void;
}) {
  const t = useTranslations("skills");
  // The Context tab's labelKey ("context.tabLabel") resolves under its own
  // `context` namespace (client/messages/en/context.json), not `skills` —
  // ContextAttachPanel is shared with the agent editor's Context tab and its
  // copy lives in one place.
  const tc = useTranslations("context");

  if (!skill) {
    return (
      <div style={s.emptyWrap}>
        {librarySize === 0 ? (
          <EmptyState
            icon="Sparkles"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={onImport}
          />
        ) : (
          <EmptyState
            icon="Sparkles"
            title={t("page.selectPrompt.title")}
            body={t("page.selectPrompt.body")}
          />
        )}
      </div>
    );
  }

  const tabs = TABS.map((tb) => ({
    key: tb.key,
    label: tb.key === "context" ? tc("tabLabel") : t(tb.labelKey),
    icon: tb.icon,
  }));

  return (
    <div style={s.root}>
      <div style={s.header}>
        <Icon.Sparkles size={18} style={{ color: "var(--accent)" }} />
        <h1 className="mono" style={s.title}>
          {skill.name}
        </h1>
        <span style={skillTypeChip(skill.type)}>{t(`listItem.type.${skill.type}`)}</span>
        <Badge mono>{t("preview.version", { version: skill.version })}</Badge>
      </div>
      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={onTab} pad="0 24px" />
      </div>
      <div style={s.body}>
        {tab === "preview" && <PreviewTab skill={skill} />}
        {tab === "versions" && <VersionsTab skill={skill} />}
        {tab === "config" && <ConfigTab skill={skill} />}
        {tab === "context" && (
          <ContextAttachPanel ownerKind="skill" ownerId={skill.id} hint={tc("inheritedHint")} />
        )}
      </div>
    </div>
  );
}
