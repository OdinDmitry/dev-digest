import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalSuiteRun } from "@devdigest/shared";
import evalMessages from "../../../../messages/en/eval.json";

// D20: RunHistoryTable is now source-agnostic — it takes `{ runs, agentId,
// isLoading }` instead of fetching by agent id, so it needs no `hooks/eval`
// mock at all. It still renders `RunCompareDialog` (which reads
// `hooks/agents`), but only once the user has selected two rows AND
// activated Compare — none of these tests do, so `hooks/agents` needs no
// mock here either.
import { RunHistoryTable } from "./RunHistoryTable";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function run(overrides: Partial<EvalSuiteRun> & { id: string }): EvalSuiteRun {
  return {
    agent_id: "ag1",
    agent_name: "Security Reviewer",
    agent_version: 3,
    // REQUIRED field on EvalSuiteRun (client/insights.md 2026-08-17 shape) —
    // every hand-built literal in this file supplies it.
    invoked_skills: [],
    status: "completed",
    started_at: "2026-08-19T10:00:00.000Z",
    completed_at: "2026-08-19T10:01:00.000Z",
    cases_total: 4,
    cases_completed: 4,
    cases_passed: 3,
    cases_failed_to_complete: 1,
    recall: 0.8,
    precision: 0.9,
    citation_accuracy: 0.75,
    cost_usd: 0.05,
    case_ids: ["c1", "c2", "c3", "c4"],
    ...overrides,
  };
}

function renderTable(runs: EvalSuiteRun[], agentId: string | null = "ag1", isLoading = false) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <RunHistoryTable runs={runs} agentId={agentId} isLoading={isLoading} />
    </NextIntlClientProvider>,
  );
}

describe("RunHistoryTable", () => {
  it("run_history_states_no_run_and_renders_no_metrics", () => {
    renderTable([]);

    expect(screen.getByText("No runs yet.")).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("run_history_states_failed_to_complete_count", () => {
    renderTable([run({ id: "r1", cases_failed_to_complete: 7 })]);

    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("run_history_compare_needs_exactly_two", () => {
    // With no agent selected (the dashboard's unfiltered cross-agent list),
    // two runs of different agents are not comparable and the selection UI
    // must not be offered at all (AC-30 + SPEC-04's edge case).
    renderTable(
      [run({ id: "r1", agent_id: "ag1" }), run({ id: "r2", agent_id: "ag2" })],
      null,
    );
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compare" })).not.toBeInTheDocument();
    cleanup();

    // With an agent selected, the existing invariant holds: 0/1 selected
    // disables Compare, exactly 2 enables it, and a user can never reach
    // three selections because the third row's checkbox disables itself.
    renderTable([
      run({ id: "r1", started_at: "2026-08-17T10:00:00.000Z" }),
      run({ id: "r2", started_at: "2026-08-18T10:00:00.000Z" }),
      run({ id: "r3", started_at: "2026-08-19T10:00:00.000Z" }),
    ]);

    const compare = screen.getByRole("button", { name: "Compare" });
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(3);

    // Zero selected.
    expect(compare).toBeDisabled();

    // One selected.
    fireEvent.click(checkboxes[0]!);
    expect(compare).toBeDisabled();

    // Exactly two selected.
    fireEvent.click(checkboxes[1]!);
    expect(compare).not.toBeDisabled();

    // AC-30's guarantee is enforced at the checkbox level: once two rows are
    // selected, every other row's checkbox becomes disabled, so a user
    // physically cannot reach three — clicking it changes nothing.
    expect(checkboxes[2]).toBeDisabled();
    fireEvent.click(checkboxes[2]!);
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).toBeChecked();
    expect(checkboxes[2]).not.toBeChecked();
    expect(compare).not.toBeDisabled();
  });

  it("run_history_row_shows_cost_next_to_metrics", () => {
    renderTable([run({ id: "r1", recall: 0.8, precision: 0.9, citation_accuracy: 0.75, cost_usd: 0.05 })]);

    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("$0.05")).toBeInTheDocument();
  });

  it("run_history_absent_cost_is_not_zero", () => {
    renderTable([
      run({
        id: "r1",
        recall: 0.8,
        precision: 0.9,
        citation_accuracy: 0.75,
        cases_passed: 3,
        cases_failed_to_complete: 1,
        cost_usd: null,
      }),
    ]);

    // The only absent value in this fixture is the cost — exactly one em
    // dash, carrying the "not available" accessible label, and the string
    // "0" (nor "$0.00") appears nowhere as a result of the missing cost.
    const dash = screen.getByText("—");
    expect(dash).toHaveAttribute("aria-label", "not available");
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
