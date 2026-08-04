/* PreviewTab — the body rendered as markdown, exactly as it reaches the
   reviewing agent's prompt. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { s } from "./styles";

export function PreviewTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const untrusted = skill.source !== "manual";

  return (
    <div style={s.wrap}>
      <h2 style={s.h2}>{t("preview.title")}</h2>
      <p style={s.subtitle}>{t("preview.subtitle")}</p>
      {untrusted && (
        <div style={s.notice}>
          <Icon.AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{t("preview.untrustedNotice")}</span>
        </div>
      )}
      <div style={s.card}>
        <Markdown>{skill.body}</Markdown>
      </div>
    </div>
  );
}
