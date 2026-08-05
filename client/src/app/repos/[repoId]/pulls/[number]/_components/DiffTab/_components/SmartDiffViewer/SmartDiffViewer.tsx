/* SmartDiffViewer — Smart-mode "Files changed" rendering: one collapsible
   section per role group (core → wiring → boilerplate, server order), each
   file's persistent per-line severity markers, and the large-file highlight.
   Presentational only: no api/fetch/router import, no business logic in the
   component body — the joins live in helpers.ts. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import { FileCard, type DiffCommentApi } from "@/components/diff-viewer";
import type { FindingRecord, PrFile, SmartDiff, SmartDiffRole } from "@devdigest/shared";
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "../../../constants";
import { findingRefsByPath, findingRefsForLine, isLargeFile, resolveGroups, type ResolvedGroup } from "./helpers";
import { chevronFor, s } from "./styles";

const ROLE_LABEL_KEY: Record<SmartDiffRole, string> = {
  core: "smartDiff.coreLabel",
  wiring: "smartDiff.wiringLabel",
  boilerplate: "smartDiff.boilerplateLabel",
};

/** core/wiring start open, boilerplate starts collapsed (acceptance criterion, §11). */
const DEFAULT_GROUP_OPEN: Record<SmartDiffRole, boolean> = {
  core: true,
  wiring: true,
  boilerplate: false,
};

export interface SmartDiffViewerProps {
  files: PrFile[];
  smartDiff: SmartDiff;
  findings: FindingRecord[];
  commenting?: DiffCommentApi;
  onOpenFinding: (findingId: string) => void;
}

export function SmartDiffViewer({ files, smartDiff, findings, commenting, onOpenFinding }: SmartDiffViewerProps) {
  const groups = React.useMemo(() => resolveGroups(smartDiff, files), [smartDiff, files]);
  const refsByPath = React.useMemo(() => findingRefsByPath(smartDiff), [smartDiff]);
  const findingById = React.useMemo(() => new Map(findings.map((f) => [f.id, f])), [findings]);

  // Built once per render, passed to every FileCard (§11). Only clicking
  // (calling `onOpenFinding`) happens here — no router/navigation import in
  // this presentational layer; routing stays in page.tsx.
  const renderLineMarker = React.useCallback(
    ({ path, line }: { path: string; line: number }) => {
      const refs = findingRefsForLine(refsByPath, path, line);
      if (refs.length === 0) return null;
      return (
        <div style={s.markerStack}>
          {refs.map((ref) => (
            <LineMarker
              key={ref.finding_id}
              record={findingById.get(ref.finding_id)}
              onClick={() => onOpenFinding(ref.finding_id)}
            />
          ))}
        </div>
      );
    },
    [refsByPath, findingById, onOpenFinding],
  );

  return (
    <div style={s.list}>
      {groups.map((group) => (
        <SmartDiffGroupSection
          key={group.role}
          group={group}
          defaultOpen={DEFAULT_GROUP_OPEN[group.role]}
          commenting={commenting}
          renderLineMarker={renderLineMarker}
        />
      ))}
    </div>
  );
}

function SmartDiffGroupSection({
  group,
  defaultOpen,
  commenting,
  renderLineMarker,
}: {
  group: ResolvedGroup;
  defaultOpen: boolean;
  commenting?: DiffCommentApi;
  renderLineMarker: (args: { path: string; line: number }) => React.ReactNode;
}) {
  const t = useTranslations("prReview");
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <div style={s.group}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setOpen((o) => !o);
        }}
        style={s.groupHeader}
      >
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <span style={s.groupLabel}>{t(ROLE_LABEL_KEY[group.role])}</span>
        <span style={s.groupMeta}>
          <span>{t("smartDiff.filesCount", { count: group.entries.length })}</span>
          <span className="mono tnum">
            <span style={{ color: "var(--code-add-text)" }}>+{group.totalAdditions}</span>{" "}
            <span style={{ color: "var(--code-del-text)" }}>−{group.totalDeletions}</span>
          </span>
          {/* Always visible, even collapsed — so findings inside a collapsed
              group (e.g. boilerplate) are never invisible (plan §11). */}
          {group.totalFindings > 0 && <span>{t("smartDiff.findingLines", { count: group.totalFindings })}</span>}
        </span>
      </div>

      {open && (
        <div style={s.groupFiles}>
          {group.entries.map((entry) => (
            <SmartDiffFileEntry
              key={entry.prFile.path}
              entry={entry}
              commenting={commenting}
              renderLineMarker={renderLineMarker}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SmartDiffFileEntry({
  entry,
  commenting,
  renderLineMarker,
}: {
  entry: ResolvedGroup["entries"][number];
  commenting?: DiffCommentApi;
  renderLineMarker: (args: { path: string; line: number }) => React.ReactNode;
}) {
  const t = useTranslations("prReview");
  const large = isLargeFile(entry.smartDiffFile);
  // Display-only — the clickable target is the per-line marker, not this chip.
  const findingsCount = entry.smartDiffFile.findings.length;
  const summary = entry.smartDiffFile.pseudocode_summary;

  return (
    <div style={large ? s.largeFileWrap : s.fileWrap}>
      {(large || findingsCount > 0) && (
        <div style={s.fileMetaRow}>
          {large && (
            <span style={s.largeFileChip}>
              <Icon.AlertTriangle size={11} />
              {t("smartDiff.largeFile")}
            </span>
          )}
          {findingsCount > 0 && (
            <span style={s.findingChip}>{t("smartDiff.findingLines", { count: findingsCount })}</span>
          )}
        </div>
      )}
      {summary && <div style={s.pseudocodeSummary}>{summary}</div>}
      <FileCard file={entry.prFile} commenting={commenting} renderLineMarker={renderLineMarker} />
    </div>
  );
}

/** One severity-coloured marker button (stacked when several findings share
 *  a line). A neutral, generically-labelled marker when the finding hasn't
 *  resolved against the loaded review data yet — never nothing, so markers
 *  don't flicker in and out (§8). */
function LineMarker({ record, onClick }: { record: FindingRecord | undefined; onClick: () => void }) {
  const color = record ? (SEV_COLOR[record.severity] ?? SEV_COLOR_FALLBACK) : SEV_COLOR_FALLBACK;
  const label = record ? `${record.severity}: ${record.title}` : "Finding";
  return <button type="button" onClick={onClick} title={label} aria-label={label} style={s.markerDot(color)} />;
}
