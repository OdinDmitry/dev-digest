/* VersionDiffModal — line diff between two historical bodies of the same
   skill. `from`/`to` are the ADJACENT elements of the desc-ordered version
   list the caller already has, never computed as `to - 1` (versions are not
   guaranteed contiguous — a restore can jump the sequence). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Skeleton } from "@devdigest/ui";
import { lineRowFor, lineSignFor } from "../../../../../../../components/diff-viewer";
import { useSkillVersion } from "../../../../../../../lib/hooks/skills";
import { diffLines } from "../../../../../../../lib/diff-lines";
import { s } from "./styles";

export function VersionDiffModal({
  skillId,
  from,
  to,
  onClose,
}: {
  skillId: string;
  from: number;
  to: number;
  onClose: () => void;
}) {
  const t = useTranslations("skills");
  const fromVersion = useSkillVersion(skillId, from);
  const toVersion = useSkillVersion(skillId, to);

  const loading = fromVersion.isLoading || toVersion.isLoading;
  const result = React.useMemo(() => {
    if (!fromVersion.data || !toVersion.data) return null;
    return diffLines(fromVersion.data.body, toVersion.data.body);
  }, [fromVersion.data, toVersion.data]);

  return (
    <Modal width={760} title={t("versions.diffTitle", { from, to })} onClose={onClose}>
      {loading && <Skeleton height={240} />}
      {result && result.truncated && <div style={s.tooLarge}>{t("versions.diffTooLarge")}</div>}
      {result && !result.truncated && result.lines.length === 0 && (
        <div style={s.empty}>{t("versions.diffEmpty")}</div>
      )}
      {result && !result.truncated && result.lines.length > 0 && (
        <div className="mono" style={s.body}>
          {result.lines.map((ln, i) => (
            <div key={i} style={lineRowFor(ln.kind)}>
              <span className="tnum" style={s.lineNo}>
                {ln.newNo ?? ln.oldNo ?? ""}
              </span>
              <span style={lineSignFor(ln.kind)}>
                {ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : ""}
              </span>
              <span style={s.lineText}>{ln.text || " "}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
