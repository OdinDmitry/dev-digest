/* VersionsTab — body-version history for a skill: newest first, an optional
   author note per snapshot (falling back to a computed line-delta summary).
   Every row gets Diff against its adjacent older snapshot when one exists
   (including the current row — "what did I just change?" is the single most
   common reason to open this tab); Restore is offered on every row except
   the current one (restoring onto itself is a no-op). Only the oldest row,
   with no older neighbour, has neither. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useRestoreSkillVersion, useSkillVersions } from "../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../lib/toast";
import { VersionDiffModal } from "./VersionDiffModal";
import { s } from "./styles";

export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const { data: versions, isLoading } = useSkillVersions(skill.id);
  const restore = useRestoreSkillVersion();
  const [diffTarget, setDiffTarget] = React.useState<{ from: number; to: number } | null>(null);

  if (isLoading || !versions) {
    return (
      <div style={s.wrap}>
        <Skeleton height={20} width={200} />
        <div style={{ height: 16 }} />
        <Skeleton height={140} />
      </div>
    );
  }

  const doRestore = (version: number) =>
    restore.mutate(
      { skillId: skill.id, version, note: t("versions.restoredNote", { version }) },
      {
        onSuccess: (data) => {
          // Restoring the CURRENT version is a genuine no-op — don't claim a
          // new version was created when it wasn't.
          if (data.version !== skill.version) {
            toast.success(t("versions.restoredToast", { version: data.version }));
          }
        },
      },
    );

  return (
    <div style={s.wrap}>
      {diffTarget && (
        <VersionDiffModal
          skillId={skill.id}
          from={diffTarget.from}
          to={diffTarget.to}
          onClose={() => setDiffTarget(null)}
        />
      )}

      <div style={s.header}>
        <h2 style={s.h2}>{t("versions.title")}</h2>
        <Badge>{t("versions.count", { count: versions.length })}</Badge>
      </div>
      <p style={s.subtitle}>{t("versions.subtitle")}</p>

      <div style={s.list}>
        {versions.map((v, i) => {
          const isNewest = i === 0;
          const older = versions[i + 1]; // adjacent OLDER snapshot, never `version - 1`
          const title =
            v.note ??
            (v.version === 1
              ? t("versions.row.initial")
              : t("versions.row.delta", { added: v.lines_added, removed: v.lines_removed }));

          return (
            <div key={v.version} style={s.row}>
              <Badge mono>{t("preview.version", { version: v.version })}</Badge>
              <div style={s.rowText}>
                <div style={s.rowTitle}>{title}</div>
                <div style={s.rowDate} className="tnum">
                  {v.created_at.slice(0, 10)}
                </div>
              </div>
              <div style={s.rowActions}>
                {isNewest && (
                  <Badge dot color="var(--ok)" bg="var(--ok-bg)">
                    {t("versions.current")}
                  </Badge>
                )}
                {older && (
                  <Button
                    size="sm"
                    icon="Eye"
                    onClick={() => setDiffTarget({ from: older.version, to: v.version })}
                  >
                    {t("versions.diff")}
                  </Button>
                )}
                {!isNewest && (
                  <Button
                    size="sm"
                    icon="History"
                    disabled={restore.isPending}
                    onClick={() => doRestore(v.version)}
                  >
                    {t("versions.restore")}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
