import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import runsMessages from "../../../../../../../../messages/en/runs.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

const AGENTS = [
  { id: "a1", name: "Security", model: "gpt-4.1", enabled: true },
  { id: "a2", name: "Performance", model: "gpt-4.1", enabled: true },
];
// Mutable so the "no agents configured" test can swap the returned list
// without a second, statically-hoisted `vi.mock` call for the same module.
let agentsData: typeof AGENTS = AGENTS;
vi.mock("../../../../../../../lib/hooks/agents", () => ({
  useAgents: () => ({ data: agentsData }),
}));

// a1 carries an estimate; a2 has none, so its row must show the "—" placeholder.
const ESTIMATES = [{ agent_id: "a1", duration_ms: 8000, cost_usd: 0.12 }];
const mutateAsync = vi.fn().mockResolvedValue({
  multi_agent_run_id: "group-1",
  runs: [
    { run_id: "run-a1", agent_id: "a1", agent_name: "Security" },
    { run_id: "run-a2", agent_id: "a2", agent_name: "Performance" },
  ],
});
vi.mock("../../../../../../../lib/hooks/multi-agent", () => ({
  useAgentEstimates: () => ({ data: ESTIMATES }),
  useStartMultiAgentReview: () => ({ mutateAsync, isPending: false }),
}));

import { RunReviewDropdown } from "./RunReviewDropdown";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  agentsData = AGENTS;
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages, runs: runsMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function openPicker() {
  fireEvent.click(screen.getByRole("button", { name: "Run Review" }));
}

describe("RunReviewDropdown — agent picker (AC-1, AC-2, AC-3, AC-7, AC-8)", () => {
  it("renders the trigger label", () => {
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    expect(screen.getByText("Run Review")).toBeInTheDocument();
  });

  it("opening the trigger renders one checkbox per agent, each named for its agent (AC-1)", () => {
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    openPicker();

    expect(screen.getByRole("checkbox", { name: "Security" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Performance" })).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(AGENTS.length);
  });

  it("the run control is disabled with zero selected, enabled after checking one, and Clear returns it to disabled (AC-2)", () => {
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    openPicker();

    const runControl = screen.getByRole("button", { name: "Run multi-agent review (0)" });
    expect(runControl).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Security" }));
    expect(screen.getByRole("button", { name: "Run multi-agent review (1)" })).not.toBeDisabled();

    fireEvent.click(screen.getByText("Clear"));
    expect(screen.getByRole("button", { name: "Run multi-agent review (0)" })).toBeDisabled();
  });

  it("each agent row renders its estimate, and — for an agent with none (AC-7, AC-8)", () => {
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    openPicker();

    // a1 has duration_ms: 8000, cost_usd: 0.12 — rendered as "8.0s · $0.12"
    // style figures via formatDuration/formatCost; assert the duration and
    // cost text are both present rather than pinning the exact separator.
    expect(screen.getByText(/8\.0s/)).toBeInTheDocument();
    expect(screen.getByText(/\$0\.12/)).toBeInTheDocument();

    // a2 has NO entry in ESTIMATES — falls back to the unavailable placeholder.
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("submitting calls the mutation with exactly the checked ids, then onRunsStarted with the returned run ids — router.push is never called (AC-3)", async () => {
    const onRunsStarted = vi.fn();
    renderWithIntl(<RunReviewDropdown prId="pr1" onRunsStarted={onRunsStarted} />);
    openPicker();

    fireEvent.click(screen.getByRole("checkbox", { name: "Security" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Performance" }));

    fireEvent.click(screen.getByRole("button", { name: "Run multi-agent review (2)" }));

    await waitFor(() => expect(onRunsStarted).toHaveBeenCalled());

    expect(mutateAsync).toHaveBeenCalledWith({ prId: "pr1", agentIds: ["a1", "a2"] });
    expect(onRunsStarted).toHaveBeenCalledWith(["run-a1", "run-a2"]);
    expect(push).not.toHaveBeenCalled();
  });
});

describe("RunReviewDropdown — no agents configured", () => {
  it("with useAgents() empty, the no-agents statement renders and the control stays disabled", () => {
    agentsData = [];
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    openPicker();

    expect(screen.getByText("No agents yet — create one in Agents.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run multi-agent review (0)" })).toBeDisabled();
  });
});
