"use client";

import React from "react";
import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { usePrComments, useCreatePrComment } from "@/lib/hooks/reviews";
import { usePrSmartDiff } from "@/lib/hooks/smart-diff";
import { notify } from "@/lib/toast";
import { SmartDiffViewer } from "./_components/SmartDiffViewer";
import type { FindingRecord, PrFile, SmartDiff } from "@devdigest/shared";

type DiffOrderMode = "smart" | "original";

const bannerStyles = {
  wrap: {
    marginBottom: 16,
    padding: "12px 16px",
    borderRadius: 8,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
  } satisfies CSSProperties,
  title: { fontWeight: 700, fontSize: 14, color: "var(--warn)" } satisfies CSSProperties,
  body: { fontSize: 13, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,
  list: { margin: "8px 0 0", paddingLeft: 18, fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
} as const;

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  /** Every loaded finding for this PR — used to resolve Smart Diff's
   *  `finding_id` refs to severity/title for the per-line markers (§10). */
  findings: FindingRecord[];
  /** Marker click handoff — routes to that finding's card on the Agent runs
   *  tab. Owned by `page.tsx`, never called with a `router` inside this tree. */
  onOpenFinding: (findingId: string) => void;
}

export function DiffTab({ prId, filesCount, files, canComment, findings, onOpenFinding }: DiffTabProps) {
  const t = useTranslations("prReview");
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);
  // Smart order / Original order toggle (§7) — client state only, defaults
  // to Smart (matches the product mockup); not persisted to the URL/storage.
  const [mode, setMode] = React.useState<DiffOrderMode>("smart");

  const { data: smartDiff, isLoading: smartDiffLoading, isError: smartDiffError } = usePrSmartDiff(prId);

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  // A smart-diff failure/loading/no-prId state can never break this tab: fall
  // back to today's flat Original-mode view regardless of the toggle. The
  // toggle itself stays visible and usable either way (§7).
  const showSmart = mode === "smart" && !smartDiffLoading && !smartDiffError && !!smartDiff;

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", gap: 4 }} role="group" aria-label="Diff order">
              <Button
                kind="tertiary"
                size="sm"
                active={mode === "smart"}
                aria-pressed={mode === "smart"}
                onClick={() => setMode("smart")}
              >
                {t("smartDiff.orderSmart")}
              </Button>
              <Button
                kind="tertiary"
                size="sm"
                active={mode === "original"}
                aria-pressed={mode === "original"}
                onClick={() => setMode("original")}
              >
                {t("smartDiff.orderOriginal")}
              </Button>
            </div>
            {commentCount > 0 && (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {showComments ? "Hide comments" : "Show comments"} ({commentCount})
              </Button>
            )}
          </div>
        }
      >
        Files changed · {filesCount} files
      </SectionLabel>

      {showSmart && smartDiff.split_suggestion.too_big && (
        <SplitSuggestionBanner suggestion={smartDiff.split_suggestion} />
      )}

      {showSmart ? (
        <SmartDiffViewer
          files={files}
          smartDiff={smartDiff}
          findings={findings}
          commenting={commenting}
          onOpenFinding={onOpenFinding}
        />
      ) : (
        // Original mode: exactly today's code path, no `renderLineMarker` prop
        // at all — zero finding markers, structurally (not just hidden).
        <DiffViewer files={files} commenting={commenting} />
      )}
    </section>
  );
}

function SplitSuggestionBanner({ suggestion }: { suggestion: SmartDiff["split_suggestion"] }) {
  const t = useTranslations("prReview");
  return (
    <div style={bannerStyles.wrap}>
      <div style={bannerStyles.title}>{t("smartDiff.largeTitle", { lines: suggestion.total_lines })}</div>
      <div style={bannerStyles.body}>{t("smartDiff.largeBody")}</div>
      <ul style={bannerStyles.list}>
        {suggestion.proposed_splits.map((split) => (
          <li key={split.name}>
            {split.name} ({split.files.length})
          </li>
        ))}
      </ul>
    </div>
  );
}
