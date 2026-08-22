import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalAgentSummary, EvalSuiteRun } from "@devdigest/shared";
import evalMessages from "../../../../../messages/en/eval.json";

// The shell pulls in nav chrome this test does not exercise (mirrors
// `ConventionsView.test.tsx`'s convention for the same reason).
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// D21: the dashboard reads the per-agent summary endpoint (AC-63), not
// `useAgents` — `RunHistoryTable` no longer fetches on its own (D20), so the
// SAME `hooks/eval` mock covers this view's own recent-runs/agent-runs reads
// too.
const useEvalAgentSummaries = vi.fn();
const useRecentEvalRuns = vi.fn();
const useAgentEvalRuns = vi.fn();
vi.mock("@/lib/hooks/eval", () => ({
  useEvalAgentSummaries: (...a: unknown[]) => useEvalAgentSummaries(...a),
  useRecentEvalRuns: (...a: unknown[]) => useRecentEvalRuns(...a),
  useAgentEvalRuns: (...a: unknown[]) => useAgentEvalRuns(...a),
}));

import { EvalDashboardView } from "./EvalDashboardView";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function run(overrides: Partial<EvalSuiteRun> & { id: string }): EvalSuiteRun {
  return {
    agent_id: "ag1",
    agent_name: "Security Reviewer",
    agent_version: 1,
    invoked_skills: [],
    status: "completed",
    started_at: "2026-08-19T10:00:00.000Z",
    completed_at: "2026-08-19T10:01:00.000Z",
    cases_total: 2,
    cases_completed: 2,
    cases_passed: 2,
    cases_failed_to_complete: 0,
    recall: 1,
    precision: 1,
    citation_accuracy: 1,
    cost_usd: 0.01,
    case_ids: ["c1", "c2"],
    ...overrides,
  };
}

const SEC_RUN = run({
  id: "run-sec",
  agent_id: "ag1",
  agent_name: "Security Reviewer",
  agent_version: 5,
  started_at: "2026-08-19T10:00:00.000Z",
  recall: 1,
  precision: 1,
  citation_accuracy: 1,
  cases_passed: 2,
  cases_total: 2,
});

const SUMMARY_SEC: EvalAgentSummary = { agent_id: "ag1", agent_name: "Security Reviewer", latest_run: SEC_RUN };
// A never-run agent — no default metric is invented for it (AC-4, AC-63).
const SUMMARY_TEST: EvalAgentSummary = { agent_id: "ag2", agent_name: "Test Quality Reviewer", latest_run: null };

function mockHooks({
  summaries = [SUMMARY_SEC, SUMMARY_TEST],
  recent = [] as EvalSuiteRun[],
  agentRuns = [] as EvalSuiteRun[],
}: {
  summaries?: EvalAgentSummary[];
  recent?: EvalSuiteRun[];
  agentRuns?: EvalSuiteRun[];
}) {
  useEvalAgentSummaries.mockReturnValue({ data: summaries, isLoading: false });
  useRecentEvalRuns.mockReturnValue({ data: recent, isLoading: false });
  useAgentEvalRuns.mockReturnValue({ data: agentRuns, isLoading: false });
}

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <EvalDashboardView />
    </NextIntlClientProvider>,
  );
}

describe("EvalDashboardView", () => {
  it("eval_dashboard_lists_one_run_list_newest_first", () => {
    // The API already returns newest-first (contract § B); the view must
    // render them in the order it received them, not re-sort or reverse.
    const newer = run({ id: "newer", agent_id: "ag1", agent_name: "Security Reviewer", agent_version: 5, started_at: "2026-08-20T10:00:00.000Z" });
    const older = run({ id: "older", agent_id: "ag2", agent_name: "Test Quality Reviewer", agent_version: 2, started_at: "2026-08-18T10:00:00.000Z" });
    mockHooks({ recent: [newer, older] });
    renderView();

    // One run list, not two: exactly as many run rows render as runs were
    // returned — a re-introduced second list would double this count. Each
    // run row's own version indicator ("v5") is a standalone text node,
    // distinct from the agent-row's combined "<date> · v<n>" meta text.
    const versionCells = screen.getAllByText(/^v\d+$/);
    expect(versionCells.map((el) => el.textContent)).toEqual(["v5", "v2"]);
  });

  it("eval_dashboard_row_per_agent_states_its_latest_run", () => {
    mockHooks({ recent: [SEC_RUN] });
    renderView();

    const secRow = screen.getByRole("button", { name: /Security Reviewer/ });
    expect(within(secRow).getByText("2/2")).toBeInTheDocument();
    expect(within(secRow).getAllByText("100%")).toHaveLength(3); // recall, precision, citation

    // The never-run agent's row states every value as absent — an em dash
    // with a "not available" accessible label, never "0" and never an
    // invented default.
    const testRow = screen.getByRole("button", { name: /Test Quality Reviewer/ });
    const dashes = within(testRow).getAllByText("—");
    // meta (start time/version) + pass count + recall + precision + citation
    expect(dashes.length).toBeGreaterThanOrEqual(4);
    dashes.forEach((d) => {
      if (d.tagName.toLowerCase() === "span") {
        expect(d).toHaveAttribute("aria-label", "not available");
      }
    });
    expect(within(testRow).queryByText("0%")).not.toBeInTheDocument();
    expect(within(testRow).queryByText("0/0")).not.toBeInTheDocument();
  });

  it("states that no run has happened yet, rather than an empty table, for a fresh workspace", () => {
    mockHooks({ recent: [] });
    renderView();

    expect(screen.getByText("No runs yet. Create an eval case and run it.")).toBeInTheDocument();
    expect(screen.queryByText("Ran at")).not.toBeInTheDocument();
  });

  it("eval_dashboard_filters_the_run_list_to_the_selected_agent", () => {
    const other = run({ id: "other", agent_id: "ag2", agent_name: "Test Quality Reviewer", agent_version: 9, started_at: "2026-08-18T10:00:00.000Z" });
    mockHooks({ recent: [SEC_RUN, other], agentRuns: [SEC_RUN] });
    renderView();

    // Unfiltered: both agents' runs are in the list.
    expect(screen.getByText("v9")).toBeInTheDocument();
    expect(useAgentEvalRuns).not.toHaveBeenCalledWith("ag1");

    fireEvent.click(screen.getByRole("button", { name: /Security Reviewer/ }));

    expect(useAgentEvalRuns).toHaveBeenCalledWith("ag1");
    // Narrowed to this agent's own runs: v9 (the other agent's run) is gone.
    expect(screen.queryByText("v9")).not.toBeInTheDocument();
    expect(screen.getByText("v5")).toBeInTheDocument();
  });

  it("eval_dashboard_marks_the_selected_agent_row_as_selected", () => {
    mockHooks({ recent: [SEC_RUN], agentRuns: [SEC_RUN] });
    renderView();

    const secRow = screen.getByRole("button", { name: /Security Reviewer/ });
    // Selection is exposed to assistive technology, not conveyed by style
    // alone (AC-65).
    expect(secRow).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(secRow);
    expect(secRow).toHaveAttribute("aria-pressed", "true");

    // Selecting the same agent again clears the filter.
    fireEvent.click(secRow);
    expect(secRow).toHaveAttribute("aria-pressed", "false");
  });

  it("eval_dashboard_selected_agent_with_no_runs_states_so", () => {
    // The workspace has runs (for OTHER agents), but the selected agent has
    // none of its own — the list must not fall back to the unfiltered one,
    // which would look like the filter silently failed (AC-4, AC-64).
    mockHooks({ recent: [SEC_RUN], agentRuns: [] });
    renderView();

    fireEvent.click(screen.getByRole("button", { name: /Test Quality Reviewer/ }));

    expect(useAgentEvalRuns).toHaveBeenCalledWith("ag2");
    // RunHistoryTable's own empty state — distinct copy from the workspace's
    // "no run has happened at all" statement above the run list.
    expect(screen.getByText("No runs yet.")).toBeInTheDocument();
    expect(screen.queryByText("No runs yet. Create an eval case and run it.")).not.toBeInTheDocument();
    expect(screen.queryByText("v5")).not.toBeInTheDocument();
  });
});
