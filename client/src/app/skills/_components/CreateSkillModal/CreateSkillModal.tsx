/* CreateSkillModal — author a skill by hand. The description field carries the
   "this is the skill's interface" hint, because that is the part authors get
   wrong. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, Modal, SelectInput, TextInput, Textarea } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { useCreateSkill } from "../../../../lib/hooks/skills";
import { useToast } from "../../../../lib/toast";
import { SKILL_TYPE_VALUES } from "../SkillsView/constants";
import { DEFAULT_SKILL_TYPE } from "./constants";
import { s } from "./styles";

export function CreateSkillModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated?: (id: string) => void;
}) {
  const t = useTranslations("skills");
  const toast = useToast();
  const create = useCreateSkill();

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>(DEFAULT_SKILL_TYPE);
  const [body, setBody] = React.useState("");

  const typeOptions = SKILL_TYPE_VALUES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }));
  const canSubmit = name.trim() !== "" && description.trim() !== "" && body.trim() !== "";

  const submit = () => {
    if (!canSubmit) return;
    create.mutate(
      { name: name.trim(), description: description.trim(), type, body },
      {
        onSuccess: (skill) => {
          toast.success(t("editor.createdToast", { name: skill.name }));
          onCreated?.(skill.id);
          onClose();
        },
      },
    );
  };

  return (
    <Modal
      title={t("editor.title")}
      subtitle={t("editor.subtitle")}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 10 }}>
          <Button kind="primary" icon="Check" onClick={submit} disabled={!canSubmit || create.isPending}>
            {create.isPending ? t("editor.creating") : t("editor.create")}
          </Button>
          <Button onClick={onClose}>{t("editor.cancel")}</Button>
        </div>
      }
    >
      <div style={s.body}>
        <FormField label={t("editor.nameLabel")} required>
          <TextInput value={name} onChange={setName} placeholder={t("editor.namePlaceholder")} mono />
        </FormField>
        <FormField label={t("editor.descriptionLabel")} hint={t("editor.descriptionHint")} required>
          <Textarea
            value={description}
            onChange={setDescription}
            placeholder={t("editor.descriptionPlaceholder")}
            rows={3}
          />
        </FormField>
        <FormField label={t("editor.typeLabel")}>
          <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={typeOptions} />
        </FormField>
        <FormField label={t("editor.bodyLabel")} hint={t("editor.bodyHint")}>
          <Textarea value={body} onChange={setBody} placeholder={t("editor.bodyPlaceholder")} rows={12} mono />
        </FormField>
      </div>
    </Modal>
  );
}
