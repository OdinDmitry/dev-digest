/* DiffViewer — basic GitHub-style unified diff viewer. Renders real PrFile.patch
   (unified-diff text from the F1 API) as a list of collapsible FileCards.
   Optional inline comments (Files changed tab): hover a line → "+" → comment,
   posted live to GitHub; existing GitHub review comments render inline. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { PrFile } from "@/lib/types";
import { type DiffCommentApi } from "../comments";
import { s } from "../styles";
import { FileCard } from "../FileCard";

export function DiffViewer({
  files,
  commenting,
  renderLineMarker,
  targetFilePath,
  targetFileNonce,
}: {
  files: PrFile[];
  commenting?: DiffCommentApi;
  /** Optional per-line marker slot — see `CodeLine`'s doc comment. Passed
   *  straight through; this layer stays domain-free. */
  renderLineMarker?: (args: { path: string; line: number }) => React.ReactNode;
  /** Optional scroll target — see `diffFileCardId`'s doc comment. Passed
   *  straight through; this layer stays domain-free. */
  targetFilePath?: string | null;
  targetFileNonce?: number;
}) {
  const t = useTranslations("shell");
  if (!files || files.length === 0) {
    return <div style={s.empty}>{t("diffViewer.noChangedFiles")}</div>;
  }
  return (
    <div style={s.list}>
      {files.map((f, i) => (
        <FileCard
          key={i}
          file={f}
          commenting={commenting}
          renderLineMarker={renderLineMarker}
          targetFilePath={targetFilePath}
          targetFileNonce={targetFileNonce}
        />
      ))}
    </div>
  );
}
