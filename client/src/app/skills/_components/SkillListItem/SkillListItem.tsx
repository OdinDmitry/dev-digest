/* SkillListItem — one skill in the library's rail: name, type + source chips,
   description, the library-level enabled toggle, and a linked-agent count.
   Clicking it selects the skill in the detail pane on the right. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, Toggle } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { skillTypeChip } from "../../../../lib/skill-type";
import { isUnvettedSkillSource } from "../../../../lib/skill-source";
import { SOURCE_ICON } from "./helpers";
import { s } from "./styles";

export function SkillListItem({
  skill,
  active,
  /** null = stats not loaded yet; renders no footer rather than a false "0". */
  agentCount,
  onClick,
  onToggle,
}: {
  skill: Skill;
  active?: boolean;
  agentCount?: number | null;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const t = useTranslations("skills");
  const untrusted = isUnvettedSkillSource(skill.source);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={!!active}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
      style={s.row(!!active, skill.enabled)}
    >
      <div style={s.headerRow}>
        <div style={s.iconBox}>
          <Icon.Sparkles size={15} />
        </div>
        <span className="mono" style={s.name}>
          {skill.name}
        </span>
        {onToggle && (
          <div onClick={(e) => e.stopPropagation()}>
            <Toggle on={skill.enabled} onChange={onToggle} size={14} />
          </div>
        )}
      </div>
      <div style={s.description}>{skill.description}</div>
      <div style={s.metaRow}>
        <span style={skillTypeChip(skill.type)}>{t(`listItem.type.${skill.type}`)}</span>
        <Badge icon={SOURCE_ICON[skill.source]} color="var(--text-muted)">
          {t(`listItem.source.${skill.source}`)}
        </Badge>
        {untrusted && (
          <span
            title={t("listItem.vettingTitle")}
            style={{ ...skillTypeChip("security"), display: "inline-flex", alignItems: "center", gap: 5 }}
          >
            <Icon.AlertTriangle size={11} />
            {t("listItem.needsVetting")}
          </span>
        )}
      </div>
      {/* Guard on != null, not ?? 0 — an in-flight stats request must not
          render a confident "0 agents" while the real count is still loading. */}
      {agentCount != null && (
        <div style={s.statsRow} className="tnum">
          {t("listItem.agentCount", { count: agentCount })}
        </div>
      )}
    </div>
  );
}
