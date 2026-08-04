/* CreateSkillFromConventionsModal — merges the repo's accepted conventions
   into a draft skill (server-side preview, writes nothing), lets the user
   edit every field, then creates it via the existing POST /skills
   (source: 'extracted'). Mirrors CreateSkillModal's field set/shape. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, FormField, Modal, SelectInput, Skeleton, TextInput, Textarea, Toggle } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { useCreateSkill } from "../../../../../../lib/hooks/skills";
import { useMergeConventionsPreview } from "../../../../../../lib/hooks/conventions";
import { useToast } from "../../../../../../lib/toast";
// Reused rather than re-implemented: the line-numbered editor's gutter/textarea
// pixel-metric parity is load-bearing (see its own file header) — a copy would
// only ever drift, the same reasoning the diff-viewer's row renderer uses.
import { SkillBodyEditor } from "../../../../../skills/_components/SkillDetail/_components/SkillBodyEditor";
import { s } from "./styles";

const SKILL_TYPE_VALUES: readonly SkillType[] = ["rubric", "convention", "security", "custom"];

export function CreateSkillFromConventionsModal({
  repoId,
  repoName,
  conventionIds,
  onClose,
}: {
  repoId: string;
  repoName: string;
  conventionIds: string[];
  onClose: () => void;
}) {
  const t = useTranslations("conventions");
  const router = useRouter();
  const toast = useToast();
  const preview = useMergeConventionsPreview();
  const create = useCreateSkill();

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("convention");
  const [body, setBody] = React.useState("");
  const [enabled, setEnabled] = React.useState(true);
  const [evidenceFiles, setEvidenceFiles] = React.useState<string[]>([]);

  const previewMutate = preview.mutate;
  React.useEffect(() => {
    previewMutate(
      { repoId, conventionIds },
      {
        onSuccess: (draft) => {
          setName(draft.name);
          setDescription(draft.description);
          setType(draft.type);
          setBody(draft.body);
          setEvidenceFiles(draft.evidence_files);
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const typeOptions = SKILL_TYPE_VALUES.map((v) => ({ value: v, label: v }));
  const loading = preview.isPending && !preview.data;
  const canSubmit = !loading && name.trim() !== "" && description.trim() !== "" && body.trim() !== "";

  const submit = () => {
    if (!canSubmit) return;
    create.mutate(
      {
        name: name.trim(),
        description: description.trim(),
        type,
        body,
        source: "extracted",
        enabled,
        evidence_files: evidenceFiles,
      },
      {
        onSuccess: (skill) => {
          toast.success(t("modal.createdToast", { name: skill.name }));
          onClose();
          // Land on the skill's own (already-built) detail/edit page rather
          // than just closing back onto the conventions list.
          router.push(`/skills?id=${skill.id}`);
        },
      },
    );
  };

  return (
    <Modal
      width={640}
      title={t("modal.title")}
      subtitle={t("modal.subtitleMerged", { count: conventionIds.length, repo: repoName })}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 10 }}>
          <Button kind="primary" icon="Check" onClick={submit} disabled={!canSubmit || create.isPending}>
            {create.isPending ? t("modal.creating") : t("modal.create")}
          </Button>
          <Button onClick={onClose}>{t("modal.cancel")}</Button>
        </div>
      }
    >
      <div style={s.body}>
        {loading ? (
          <>
            <Skeleton height={36} />
            <Skeleton height={80} />
            <Skeleton height={220} />
          </>
        ) : (
          <>
            <FormField label={t("modal.nameLabel")} required>
              <TextInput value={name} onChange={setName} mono />
            </FormField>
            <FormField label={t("modal.descriptionLabel")} required>
              <Textarea value={description} onChange={setDescription} rows={2} />
            </FormField>
            <div style={s.row}>
              <div style={{ flex: 1 }}>
                <FormField label={t("modal.typeLabel")}>
                  <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={typeOptions} />
                </FormField>
              </div>
              <div style={{ flex: 1 }}>
                <FormField label={t("modal.enabledLabel")} right={<Toggle on={enabled} onChange={setEnabled} />} />
              </div>
            </div>
            <FormField label={t("modal.bodyLabel")}>
              <SkillBodyEditor value={body} onChange={setBody} filename={`${name || "skill"}.md`} dirty />
            </FormField>
          </>
        )}
      </div>
    </Modal>
  );
}
