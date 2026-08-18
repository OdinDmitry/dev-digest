"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { BriefCard } from "../BriefCard";
import { IntentCard } from "../IntentCard";
import { ReviewFocus } from "../ReviewFocus";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null;
  prBody: string | null | undefined;
  /** Switches to the Files-changed tab and scrolls to this file's card —
   *  threaded down to every SPEC-02 file reference (IntentCard's risk rows,
   *  ReviewFocus' items). Owned by `page.tsx` (client/insights.md
   *  2026-08-05): both the trigger (this tab) and the destination (the
   *  Files-changed tab) are separately-mounted tabs on the same route. */
  onJumpToFile: (path: string) => void;
}

/** SPEC-02 order (AC-1, AC-24): the PR brief above everything else, then
 *  Intent (with its RISK AREAS subsection), then Review Focus IMMEDIATELY
 *  below Intent, then the author's Description last. The spec places review
 *  focus "below the INTENT card"; the PR body is the one block here the
 *  reviewer did not ask for, so it must not sit between the two generated
 *  sections. No new tab, no new route. */
export function OverviewTab({ prId, prBody, onJumpToFile }: OverviewTabProps) {
  return (
    <>
      <BriefCard prId={prId} />
      <IntentCard prId={prId} onJumpToFile={onJumpToFile} />
      <ReviewFocus prId={prId} onJumpToFile={onJumpToFile} />
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
