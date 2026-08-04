/* SkillCard — one skill in the library grid: name, type, description and the
   library-level enabled toggle. Clicking it opens the preview pane. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Toggle } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { skillTypeChip } from "../../../../lib/skill-type";
import { s } from "./styles";

export function SkillCard({
  skill,
  active,
  onClick,
  onToggle,
}: {
  skill: Skill;
  active?: boolean;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const t = useTranslations("skills");
  const untrusted = skill.source !== "manual";

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
      style={s.card(!!active, skill.enabled)}
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
    </div>
  );
}
