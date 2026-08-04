/* SkillPreviewPane — the side pane for the selected skill: read its body, edit
   it in place, toggle it, delete it. Saving a changed body versions the skill. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  FormField,
  Icon,
  Markdown,
  SelectInput,
  TextInput,
  Textarea,
  Toggle,
} from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useDeleteSkill, useUpdateSkill } from "../../../../lib/hooks/skills";
import { useToast } from "../../../../lib/toast";
import { skillTypeChip } from "../../../../lib/skill-type";
import { SKILL_TYPE_VALUES } from "../SkillsView/constants";
import { s } from "./styles";

export function SkillPreviewPane({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const update = useUpdateSkill();
  const del = useDeleteSkill();

  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [type, setType] = React.useState<SkillType>(skill.type);
  const [body, setBody] = React.useState(skill.body);

  const reset = React.useCallback(() => {
    setName(skill.name);
    setDescription(skill.description);
    setType(skill.type);
    setBody(skill.body);
  }, [skill]);

  // Switching skills drops any half-finished edit rather than carrying it over
  // to a different skill.
  React.useEffect(() => {
    reset();
    setEditing(false);
  }, [skill.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const untrusted = skill.source !== "manual";
  const typeOptions = SKILL_TYPE_VALUES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }));

  const save = () =>
    update.mutate(
      { id: skill.id, patch: { name, description, type, body } },
      {
        onSuccess: (data) => {
          setEditing(false);
          toast.success(t("preview.savedToast", { version: data.version }));
        },
      },
    );

  return (
    <div style={s.pane}>
      <div style={s.header}>
        <div style={s.title} className="mono">
          {skill.name}
        </div>
        <span style={skillTypeChip(skill.type)}>{t(`listItem.type.${skill.type}`)}</span>
        <Badge mono>{t("preview.version", { version: skill.version })}</Badge>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
          {skill.enabled ? t("preview.enabled") : t("preview.disabled")}
          <Toggle
            on={skill.enabled}
            onChange={(enabled) => update.mutate({ id: skill.id, patch: { enabled } })}
            size={14}
          />
        </label>
      </div>

      <div style={s.body}>
        {untrusted && (
          <div style={s.notice}>
            <Icon.AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{t("preview.untrustedNotice")}</span>
          </div>
        )}

        {editing ? (
          <>
            <FormField label={t("editor.nameLabel")} required>
              <TextInput value={name} onChange={setName} mono />
            </FormField>
            <FormField label={t("editor.descriptionLabel")} hint={t("editor.descriptionHint")} required>
              <Textarea value={description} onChange={setDescription} rows={3} />
            </FormField>
            <FormField label={t("editor.typeLabel")}>
              <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={typeOptions} />
            </FormField>
            <FormField label={t("preview.bodyLabel")} hint={t("preview.bodyHint")}>
              <Textarea value={body} onChange={setBody} rows={16} mono />
            </FormField>
          </>
        ) : (
          <>
            <div style={s.descriptionBlock}>
              <div style={s.descriptionLabel}>{t("editor.descriptionLabel")}</div>
              {skill.description}
            </div>
            <div style={s.markdown}>
              <Markdown>{skill.body}</Markdown>
            </div>
            {skill.evidence_files && skill.evidence_files.length > 0 && (
              <div style={s.evidence}>
                {t("preview.evidenceTitle")}: {skill.evidence_files.join(", ")}
              </div>
            )}
          </>
        )}
      </div>

      <div style={s.actions}>
        {editing ? (
          <>
            <Button kind="primary" icon="Check" onClick={save} disabled={update.isPending}>
              {update.isPending ? t("editor.saving") : t("editor.save")}
            </Button>
            <Button
              onClick={() => {
                reset();
                setEditing(false);
              }}
            >
              {t("editor.cancel")}
            </Button>
          </>
        ) : (
          <Button icon="Edit" onClick={() => setEditing(true)}>
            {t("preview.edit")}
          </Button>
        )}
        <div style={s.spacer} />
        <span style={s.meta}>{t(`listItem.source.${skill.source}`)}</span>
        <Button
          icon="Trash"
          disabled={del.isPending}
          onClick={() => {
            if (window.confirm(t("preview.deleteConfirm", { name: skill.name }))) del.mutate(skill.id);
          }}
        >
          {t("preview.delete")}
        </Button>
      </div>
    </div>
  );
}
