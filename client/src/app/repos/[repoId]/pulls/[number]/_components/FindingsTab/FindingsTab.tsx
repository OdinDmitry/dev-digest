"use client";

import React, { useCallback } from "react";
import { Icon, Badge, Button, SectionLabel, EmptyState } from "@devdigest/ui";
import { RunStatus } from "../RunStatus";
import { RunHistory } from "../RunHistory/RunHistory";
import { ReviewRunAccordion } from "../ReviewRunAccordion";
import { SeverityCounts, type SeverityKey } from "../../../_components/SeverityCounts";
import { latestReviewPerAgent } from "../../../helpers";
import { buildFindingsByRunId } from "./helpers";
import { s } from "./styles";
import type { FindingRecord, ReviewRecord, RunSummary, PrCommit } from "@devdigest/shared";
import type { UseMutationResult } from "@tanstack/react-query";

/** Undismissed findings tallied by severity — same shape as the server's
 *  `rollupSeverities` (pulls/status.ts), computed client-side here since the
 *  full findings are already on the page. */
function countBySeverity(findings: FindingRecord[]) {
  const c = { critical: 0, warning: 0, suggestion: 0 };
  for (const f of findings) {
    if (f.dismissed_at) continue;
    if (f.severity === "CRITICAL") c.critical += 1;
    else if (f.severity === "WARNING") c.warning += 1;
    else if (f.severity === "SUGGESTION") c.suggestion += 1;
  }
  return c;
}

interface FindingsTabProps {
  prId: string | null;
  liveRunIds: string[];
  reviewRunning: boolean;
  lethalTrifecta: FindingRecord[];
  runs: ReviewRecord[];
  prRuns: RunSummary[] | undefined;
  prCommits: PrCommit[];
  cancelMutation: UseMutationResult<any, any, string, any>;
  /** owner/repo + head sha — used to deep-link a finding's file:line to GitHub. */
  repoFullName?: string | null;
  headSha?: string | null;
  onOpenTrace: (id: string) => void;
  onDelete: (id: string) => void;
  onRunDone: () => void;
  /** Finding-level navigation target (Smart Diff marker → Agent runs tab,
   *  §10) — owned by `page.tsx` so it survives this tab unmounting. */
  targetFindingId?: string | null;
  targetFindingNonce?: number;
}

export function FindingsTab({
  prId,
  liveRunIds,
  reviewRunning,
  lethalTrifecta,
  runs,
  prRuns,
  prCommits,
  cancelMutation,
  repoFullName,
  headSha,
  onOpenTrace,
  onDelete,
  onRunDone,
  targetFindingId = null,
  targetFindingNonce = 0,
}: FindingsTabProps) {
  const handleCancelAll = useCallback(() => {
    liveRunIds.forEach((id) => cancelMutation.mutate(id));
  }, [liveRunIds, cancelMutation]);

  const handleOpenFirstTrace = useCallback(() => {
    if (liveRunIds[0]) onOpenTrace(liveRunIds[0]);
  }, [liveRunIds, onOpenTrace]);

  const handleOpenTrace = useCallback(
    (id: string) => {
      onOpenTrace(id);
    },
    [onOpenTrace],
  );

  const handleDelete = useCallback(
    (id: string) => {
      onDelete(id);
    },
    [onDelete],
  );

  // Timeline → Review-runs navigation: clicking an agent name in the timeline
  // opens + scrolls to that run's accordion below. The nonce re-triggers the
  // scroll even when the same run is clicked twice.
  const [target, setTarget] = React.useState<{ runId: string; n: number } | null>(null);
  const handleGoToReview = useCallback((runId: string) => {
    setTarget((p) => ({ runId, n: (p?.n ?? 0) + 1 }));
  }, []);

  // Page-level severity click-filter: the COUNTER sums each agent's OWN
  // latest review (a re-run of the SAME agent supersedes its own older
  // review, but every distinct agent's latest review counts — matches the
  // PR-list badge's scope). Once a severity is selected the filter narrows
  // every open run's FindingsPanel.
  const [selectedSeverity, setSelectedSeverity] = React.useState<SeverityKey | null>(null);
  const handleSelectSeverity = useCallback((key: SeverityKey) => {
    setSelectedSeverity((cur) => (cur === key ? null : key));
  }, []);
  // A NEW finding target (nonce changed) escapes the severity filter — it
  // must never hide the finding the user just navigated to (§10).
  React.useEffect(() => {
    if (targetFindingId) setSelectedSeverity(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetFindingNonce]);
  const aggregateCounts = React.useMemo(
    () => countBySeverity(latestReviewPerAgent(runs).flatMap((r) => r.findings)),
    [runs],
  );

  const findingsByRunId = React.useMemo(() => buildFindingsByRunId(runs), [runs]);

  return (
    <section>
      {liveRunIds.length > 0 && (
        <div style={s.liveRunSection}>
          <SectionLabel
            icon="Sparkles"
            right={
              <div style={s.cancelActions}>
                <Button
                  kind="danger"
                  size="sm"
                  icon="X"
                  loading={cancelMutation.isPending}
                  onClick={handleCancelAll}
                >
                  Cancel
                </Button>
                <Button kind="ghost" size="sm" icon="FileText" onClick={handleOpenFirstTrace}>
                  Open run trace
                </Button>
              </div>
            }
          >
            Live review
          </SectionLabel>
          <RunStatus runIds={liveRunIds} onDone={onRunDone} />
        </div>
      )}

      {reviewRunning && (
        <div style={s.reviewInProgress}>
          <Icon.RefreshCw size={16} style={{ color: "var(--accent)", animation: "ddspin 1s linear infinite" }} />
          <span style={s.reviewInProgressText}>Review in progress…</span>
          <span style={s.reviewInProgressSub}>
            the agent is analyzing the diff — this can take a while on large PRs.
          </span>
        </div>
      )}

      {lethalTrifecta.length > 0 && (
        <div style={s.lethalTrifecta}>
          <Icon.Shield size={16} style={{ color: "var(--crit)" }} />
          <span style={s.lethalTrifectaTitle}>Lethal Trifecta detected</span>
          <Badge color="var(--crit)" bg="transparent">
            {lethalTrifecta.length} finding(s)
          </Badge>
        </div>
      )}

      {((prRuns && prRuns.length > 0) || prCommits.length > 0) && (
        <div style={s.timelineSection}>
          <SectionLabel
            icon="Activity"
            right={<span style={{ fontSize: 12, color: "var(--text-muted)" }}>runs &amp; commits · newest first</span>}
          >
            Timeline
          </SectionLabel>
          <RunHistory
            runs={prRuns ?? []}
            commits={prCommits}
            findingsByRunId={findingsByRunId}
            onOpenTrace={handleOpenTrace}
            onGoToReview={handleGoToReview}
            onDelete={handleDelete}
          />
        </div>
      )}

      <SectionLabel
        icon="AlertOctagon"
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <SeverityCounts
              counts={aggregateCounts}
              selected={selectedSeverity}
              onSelect={handleSelectSeverity}
            />
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>grouped by run · newest first</span>
          </div>
        }
      >
        Review runs
      </SectionLabel>
      {runs.length === 0 ? (
        reviewRunning || liveRunIds.length > 0 ? null : (
          <EmptyState
            icon="Sparkles"
            title="No findings yet"
            body="Run a review to generate findings. Use Run Review ▾ above (run all enabled agents or a specific one)."
          />
        )
      ) : (
        prId &&
        runs.map((review, i) => (
          <ReviewRunAccordion
            key={review.id}
            review={review}
            prId={prId}
            defaultOpen={i === 0}
            repoFullName={repoFullName}
            headSha={headSha}
            targetRunId={target?.runId ?? null}
            targetNonce={target?.n ?? 0}
            targetFindingId={targetFindingId}
            targetFindingNonce={targetFindingNonce}
            severityFilter={selectedSeverity}
          />
        ))
      )}
    </section>
  );
}
