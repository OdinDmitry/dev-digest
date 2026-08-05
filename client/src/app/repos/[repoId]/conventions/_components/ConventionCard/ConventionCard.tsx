/* ConventionCard — one convention candidate: rule, evidence (file:line,
   clickable to GitHub), confidence, and an Accept/Reject toggle pair.
   Sibling in shape to FindingCard, reusing the same primitives. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, IconBtn, MonoLink, PercentProgress } from "@devdigest/ui";
import type { ConventionCandidate, ConventionStatus } from "@devdigest/shared";
import { githubBlobUrl } from "../../../../../../lib/github-urls";
import { s } from "./styles";

/** Same thresholds as ConfidenceNum: ok ≥85, warn ≥65, muted otherwise. */
function confidenceColor(pct: number): string {
  return pct >= 85 ? "var(--ok)" : pct >= 65 ? "var(--warn)" : "var(--text-muted)";
}

export function ConventionCard({
  convention,
  repoFullName,
  defaultBranch,
  onStatusChange,
  onDelete,
  pending,
}: {
  convention: ConventionCandidate;
  repoFullName?: string | null;
  defaultBranch?: string | null;
  onStatusChange: (status: ConventionStatus) => void;
  onDelete: () => void;
  pending?: boolean;
}) {
  const t = useTranslations("conventions");
  const ref = convention.scanned_sha ?? defaultBranch;
  const fileHref =
    repoFullName && ref && convention.evidence_path
      ? githubBlobUrl(
          repoFullName,
          ref,
          convention.evidence_path,
          convention.evidence_start_line ?? undefined,
          convention.evidence_end_line ?? undefined,
        )
      : undefined;
  const lineLabel =
    convention.evidence_start_line == null
      ? null
      : convention.evidence_end_line != null &&
          convention.evidence_end_line !== convention.evidence_start_line
        ? `${convention.evidence_start_line}-${convention.evidence_end_line}`
        : String(convention.evidence_start_line);

  return (
    <div style={s.card(convention.status)}>
      <div style={s.header}>
        <div style={{ minWidth: 0, flex: 1 }}>
          {convention.category && <div style={s.categoryTag}>{convention.category}</div>}
          <div style={s.title}>{convention.rule}</div>
        </div>
        <div style={s.actions}>
          <Button
            kind={convention.status === "accepted" ? "primary" : "secondary"}
            size="sm"
            icon="Check"
            disabled={pending}
            onClick={() => onStatusChange(convention.status === "accepted" ? "pending" : "accepted")}
          >
            {convention.status === "accepted" ? t("card.accepted") : t("card.accept")}
          </Button>
          <Button
            kind={convention.status === "rejected" ? "danger" : "ghost"}
            size="sm"
            icon="X"
            disabled={pending}
            onClick={() => onStatusChange(convention.status === "rejected" ? "pending" : "rejected")}
          >
            {convention.status === "rejected" ? t("card.rejected") : t("card.reject")}
          </Button>
          <IconBtn icon="Trash" label={t("card.delete")} danger onClick={() => !pending && onDelete()} />
        </div>
      </div>

      {convention.evidence_path && (
        <div style={s.evidence}>
          <div style={s.evidenceHeader}>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("card.detectedIn")}</span>
            <MonoLink href={fileHref}>
              {convention.evidence_path}
              {lineLabel ? `:${lineLabel}` : ""}
            </MonoLink>
          </div>
          {convention.evidence_snippet && <pre style={s.snippet}>{convention.evidence_snippet}</pre>}
        </div>
      )}

      {convention.confidence != null && (
        <div style={s.footer}>
          <PercentProgress
            label={t("card.confidence")}
            value={convention.confidence * 100}
            color={confidenceColor(convention.confidence * 100)}
          />
        </div>
      )}
    </div>
  );
}
