/* ImportSkillDrawer — upload a markdown file or a zip, see exactly what the
   product extracted (and what it refused to read), then confirm.

   Two-step on purpose: nothing is written until the user has seen the body that
   is about to become instructions in their agent's prompt, plus every archive
   member that was skipped. The created skill starts disabled for the same
   reason. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Drawer, Icon, Markdown } from "@devdigest/ui";
import type { SkillImportPreview } from "@devdigest/shared";
import { ApiError } from "../../../../lib/api";
import { useCreateSkill, usePreviewSkillImport } from "../../../../lib/hooks/skills";
import { useToast } from "../../../../lib/toast";
import { skillTypeChip } from "../../../../lib/skill-type";
import { UPLOAD_ACCEPT } from "./constants";
import { readUpload } from "./helpers";
import { s } from "./styles";

export function ImportSkillDrawer({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported?: (id: string) => void;
}) {
  const t = useTranslations("skills");
  const toast = useToast();
  const preview = usePreviewSkillImport();
  const create = useCreateSkill();
  const fileInput = React.useRef<HTMLInputElement>(null);

  const [dragActive, setDragActive] = React.useState(false);
  const [filename, setFilename] = React.useState<string | null>(null);
  const [parsed, setParsed] = React.useState<SkillImportPreview | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setParsed(null);
    setFilename(file.name);
    try {
      const upload = await readUpload(file);
      setParsed(await preview.mutateAsync(upload));
    } catch (err) {
      setParsed(null);
      setError(err instanceof ApiError ? err.message : t("import.errors.unreadable"));
    }
  };

  const confirm = () => {
    if (!parsed) return;
    create.mutate(
      {
        name: parsed.name,
        description: parsed.description,
        type: parsed.type,
        body: parsed.body,
        source: parsed.source,
        // Imported skills arrive disabled: enabling foreign instructions is a
        // separate, deliberate act.
        enabled: false,
        evidence_files: parsed.evidence_files,
      },
      {
        onSuccess: (skill) => {
          toast.success(t("import.importedToast", { name: skill.name }));
          onImported?.(skill.id);
          onClose();
        },
      },
    );
  };

  return (
    <Drawer
      title={t("drawer.title")}
      subtitle={t("drawer.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button
            kind="primary"
            icon="Upload"
            onClick={confirm}
            disabled={!parsed || create.isPending}
          >
            {create.isPending ? t("import.importing") : t("import.confirm")}
          </Button>
          <Button onClick={onClose}>{t("import.cancel")}</Button>
        </div>
      }
    >
      <div
        onDragOver={(e) => {
          e.preventDefault(); // without this the drop never fires
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void handleFile(file);
        }}
        style={s.dropzone(dragActive)}
      >
        <Icon.Upload size={22} />
        <div style={s.dropTitle}>{t("import.dropzone.title")}</div>
        <div style={s.dropHint}>{t("import.dropzone.hint")}</div>
        <Button size="sm" icon="File" onClick={() => fileInput.current?.click()}>
          {t("import.dropzone.browse")}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept={UPLOAD_ACCEPT}
          aria-label={t("import.dropzone.browse")}
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            // Reset so re-picking the same file fires change again.
            e.target.value = "";
          }}
        />
      </div>

      {filename && (
        <div style={s.selected}>
          {preview.isPending
            ? t("import.parsing", { filename })
            : t("import.dropzone.selected", { filename })}
        </div>
      )}
      {error && <div style={s.error}>{error}</div>}

      {parsed && (
        <>
          <div style={s.sectionLabel}>{t("import.previewTitle")}</div>
          <div style={s.name} className="mono">
            {parsed.name}
          </div>
          <div style={{ ...s.metaRow, marginTop: 8 }}>
            <span style={skillTypeChip(parsed.type)}>{t(`listItem.type.${parsed.type}`)}</span>
            <Badge icon="Link">{t(`listItem.source.${parsed.source}`)}</Badge>
            {parsed.entry_path && (
              <Badge mono icon="File">
                {parsed.entry_path}
              </Badge>
            )}
          </div>
          <div style={s.description}>{parsed.description}</div>

          <div style={s.warning}>
            <Icon.AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{t("import.trustWarning")}</span>
          </div>

          {parsed.skipped.length > 0 && (
            <>
              <div style={s.sectionLabel}>{t("import.skipped.title")}</div>
              <div style={s.skippedList}>
                {parsed.skipped.map((sk) => (
                  <div key={sk.path} style={s.skippedRow}>
                    <Icon.Slash size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                    <span className="mono" style={s.skippedPath}>
                      {sk.path}
                    </span>
                    <Badge>{t(`import.skipped.reason.${sk.reason}`)}</Badge>
                  </div>
                ))}
              </div>
            </>
          )}

          {parsed.evidence_files.length > 0 && (
            <>
              <div style={s.sectionLabel}>{t("import.evidenceTitle")}</div>
              <div style={s.dropHint} className="mono">
                {parsed.evidence_files.join(", ")}
              </div>
            </>
          )}

          <div style={s.sectionLabel}>{t("import.bodyTitle")}</div>
          <div style={s.bodyBox}>
            <Markdown>{parsed.body}</Markdown>
          </div>
        </>
      )}
    </Drawer>
  );
}
