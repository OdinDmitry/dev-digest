/* ConfigTab — name/description/type/body form + the library-level enabled
   toggle + delete. Always a live form (no separate view/edit mode): the
   Preview tab is where you read the rendered body. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, FormField, Icon, SelectInput, TextInput, Textarea, Toggle } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useDeleteSkill, useUpdateSkill } from "../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../lib/toast";
import { SKILL_TYPE_VALUES } from "../../../SkillsView/constants";
import { SkillBodyEditor } from "../SkillBodyEditor";
import { s } from "./styles";

export function ConfigTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const update = useUpdateSkill();
  const del = useDeleteSkill();

  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [type, setType] = React.useState<SkillType>(skill.type);
  const [body, setBody] = React.useState(skill.body);
  const [enabled, setEnabled] = React.useState(skill.enabled);
  const [note, setNote] = React.useState("");

  // Switching skills drops any half-finished edit rather than carrying it over
  // to a different skill; a background refetch of the SAME skill does not
  // reset the form (keyed on skill.id, not the object).
  React.useEffect(() => {
    setName(skill.name);
    setDescription(skill.description);
    setType(skill.type);
    setBody(skill.body);
    setEnabled(skill.enabled);
    setNote("");
  }, [skill.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const untrusted = skill.source !== "manual";
  const bodyDirty = body !== skill.body;
  const dirty =
    bodyDirty ||
    name !== skill.name ||
    description !== skill.description ||
    type !== skill.type ||
    enabled !== skill.enabled;

  const typeOptions = SKILL_TYPE_VALUES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }));

  const save = () =>
    update.mutate(
      {
        id: skill.id,
        patch: { name, description, type, body, enabled, note: note.trim() || null },
      },
      {
        onSuccess: (data) => {
          setNote("");
          toast.success(t("preview.savedToast", { version: data.version }));
        },
      },
    );

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("config.title")}</h2>
        <Badge mono>{t("preview.version", { version: skill.version })}</Badge>
        <label style={s.enabledLabel}>
          {t("preview.enabled")}
          <Toggle on={enabled} onChange={setEnabled} size={16} />
        </label>
      </div>

      {untrusted && (
        <div style={s.notice}>
          <Icon.AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{t("preview.untrustedNotice")}</span>
        </div>
      )}

      <FormField label={t("editor.nameLabel")} required>
        <TextInput value={name} onChange={setName} mono />
      </FormField>
      <FormField label={t("editor.descriptionLabel")} hint={t("editor.descriptionHint")} required>
        <Textarea value={description} onChange={setDescription} rows={3} />
      </FormField>
      <FormField label={t("editor.typeLabel")}>
        <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={typeOptions} />
      </FormField>
      <FormField label={t("preview.bodyLabel")} hint={t("editor.bodyHint")}>
        <SkillBodyEditor
          value={body}
          onChange={setBody}
          filename={`${skill.name}.md`}
          dirty={bodyDirty}
        />
      </FormField>
      {bodyDirty && (
        <FormField label={t("versions.noteLabel")}>
          <TextInput value={note} onChange={setNote} placeholder={t("versions.notePlaceholder")} />
        </FormField>
      )}
      {skill.evidence_files && skill.evidence_files.length > 0 && (
        <div style={s.evidence}>
          {t("preview.evidenceTitle")}: {skill.evidence_files.join(", ")}
        </div>
      )}

      <div style={s.actions}>
        <Button kind="primary" icon="Check" onClick={save} disabled={!dirty || update.isPending}>
          {update.isPending ? t("config.saving") : t("config.save")}
        </Button>
        <div style={s.spacer} />
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {t(`listItem.source.${skill.source}`)}
        </span>
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
