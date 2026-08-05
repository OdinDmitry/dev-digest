/**
 * Integration-style coverage for the finding-level navigation target (§10):
 * clicking a Smart Diff marker eventually calls `onOpenFinding(findingId)`,
 * which page.tsx turns into `targetFindingId`/`targetFindingNonce` props
 * threaded down to here. This suite drives those props directly (mirroring
 * how page.tsx sets them BEFORE switching to this tab) and asserts the two
 * named failure modes never happen: the card stays hidden behind "hide low
 * confidence", or behind the severity filter.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, within, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReviewRecord, FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteReview: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { FindingsTab } from "./FindingsTab";

afterEach(cleanup);

function finding(o: Partial<FindingRecord> & { id: string; review_id: string }): FindingRecord {
  return {
    severity: "WARNING",
    category: "bug",
    title: "A finding",
    file: "src/a.ts",
    start_line: 1,
    end_line: 1,
    rationale: "x",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

function review(o: Partial<ReviewRecord> & { id: string }): ReviewRecord {
  return {
    pr_id: "pr1",
    agent_id: null,
    run_id: null,
    agent_name: null,
    kind: "review",
    verdict: null,
    summary: null,
    score: null,
    model: null,
    grounding: null,
    created_at: "2026-01-01T00:00:00.000Z",
    findings: [],
    ...o,
  };
}

function renderTab(props: Partial<React.ComponentProps<typeof FindingsTab>>) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <FindingsTab
        prId="pr1"
        liveRunIds={[]}
        reviewRunning={false}
        lethalTrifecta={[]}
        prRuns={[]}
        prCommits={[]}
        cancelMutation={{ isPending: false, mutate: vi.fn() } as never}
        onOpenTrace={vi.fn()}
        onDelete={vi.fn()}
        onRunDone={vi.fn()}
        runs={[]}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe("FindingsTab — finding-level navigation target", () => {
  it("opens the owning (non-default-open) run's accordion and scrolls to the target card", () => {
    const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    const runA = review({
      id: "rA",
      run_id: "run-a",
      agent_id: "agentA",
      agent_name: "Agent A",
      findings: [finding({ id: "fA1", review_id: "rA", title: "Finding in run A", severity: "CRITICAL" })],
    });
    const runB = review({
      id: "rB",
      run_id: "run-b",
      agent_id: "agentB",
      agent_name: "Agent B",
      findings: [finding({ id: "fB1", review_id: "rB", title: "Finding in run B", severity: "WARNING" })],
    });

    // Mounts WITH the target already set — the realistic cold-tab case (§10):
    // page.tsx sets the target before switching to this tab.
    renderTab({ runs: [runA, runB], targetFindingId: "fB1", targetFindingNonce: 1 });

    // Run B is not the default-open accordion (index 1) — it must still open
    // because it owns the target finding, and the card must be revealed.
    expect(screen.getByText("Finding in run B")).toBeInTheDocument();
    expect(scrollSpy).toHaveBeenCalled();

    scrollSpy.mockRestore();
  });

  it("reveals a target finding hidden behind 'hide low confidence'", () => {
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    const run = review({
      id: "r1",
      run_id: "run-1",
      agent_id: "agentA",
      agent_name: "Agent A",
      findings: [
        finding({ id: "f1", review_id: "r1", title: "Warning finding", severity: "WARNING", confidence: 0.9 }),
        finding({ id: "f2", review_id: "r1", title: "Low confidence critical", severity: "CRITICAL", confidence: 0.2 }),
      ],
    });

    const { rerender } = renderTab({ runs: [run] });

    // Hide low-confidence findings — the low-confidence target becomes hidden.
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.queryByText("Low confidence critical")).not.toBeInTheDocument();

    // A new target arrives pointing at the now-hidden finding.
    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <FindingsTab
          prId="pr1"
          liveRunIds={[]}
          reviewRunning={false}
          lethalTrifecta={[]}
          prRuns={[]}
          prCommits={[]}
          cancelMutation={{ isPending: false, mutate: vi.fn() } as never}
          onOpenTrace={vi.fn()}
          onDelete={vi.fn()}
          onRunDone={vi.fn()}
          runs={[run]}
          targetFindingId="f2"
          targetFindingNonce={1}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText("Low confidence critical")).toBeInTheDocument();
  });

  it("escapes an active severity filter that would hide the target", () => {
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    const runA = review({
      id: "rA",
      run_id: "run-a",
      agent_id: "agentA",
      agent_name: "Agent A",
      findings: [finding({ id: "fA1", review_id: "rA", title: "Critical in run A", severity: "CRITICAL" })],
    });
    const runB = review({
      id: "rB",
      run_id: "run-b",
      agent_id: "agentB",
      agent_name: "Agent B",
      findings: [finding({ id: "fB1", review_id: "rB", title: "Warning in run B", severity: "WARNING" })],
    });

    const { rerender } = renderTab({ runs: [runA, runB] });

    // Select the CRITICAL severity filter via the aggregate counter.
    const sectionRow = screen.getByText("Review runs").parentElement!;
    const rightWrap = sectionRow.lastElementChild as HTMLElement;
    const severityButtons = within(rightWrap).getAllByRole("button");
    fireEvent.click(severityButtons[0]!);

    // A target finding of a DIFFERENT severity, in the non-open run, arrives.
    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <FindingsTab
          prId="pr1"
          liveRunIds={[]}
          reviewRunning={false}
          lethalTrifecta={[]}
          prRuns={[]}
          prCommits={[]}
          cancelMutation={{ isPending: false, mutate: vi.fn() } as never}
          onOpenTrace={vi.fn()}
          onDelete={vi.fn()}
          onRunDone={vi.fn()}
          runs={[runA, runB]}
          targetFindingId="fB1"
          targetFindingNonce={1}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText("Warning in run B")).toBeInTheDocument();
  });
});
