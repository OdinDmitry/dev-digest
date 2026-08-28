import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import runsMessages from "../../../../../messages/en/runs.json";
import prReviewMessages from "../../../../../messages/en/prReview.json";

// Mutable module-level search params — swapped per test BEFORE render (a
// mocked router that mutates state after render does not trigger a
// re-render on its own; see client/insights.md 2026-08-04).
let currentSearch = new URLSearchParams();
const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => currentSearch,
}));

vi.mock("../../../../lib/repo-context", () => ({
  useActiveRepo: () => ({
    repoId: "repo1",
    setRepoId: vi.fn(),
    repos: [],
    activeRepo: null,
    reposLoaded: true,
  }),
}));

const AGENTS = [
  { id: "a1", name: "Security", model: "gpt-4.1", enabled: true },
  { id: "a2", name: "Performance", model: "gpt-4.1", enabled: true },
  { id: "a3", name: "No Estimate Agent", model: "gpt-4.1", enabled: true },
];
const ESTIMATES = [
  { agent_id: "a1", duration_ms: 5000, cost_usd: 0.05 },
  { agent_id: "a2", duration_ms: 9000, cost_usd: 0.2 },
  // a3 deliberately absent — no prior successful run.
];

const mutateAsync = vi.fn().mockResolvedValue({
  multi_agent_run_id: "group-1",
  runs: [{ run_id: "run-a1", agent_id: "a1", agent_name: "Security" }],
});

// Whether the chosen PR already has a multi-agent run. Swapped per test BEFORE
// render, like `currentSearch` above; null = no prior run, which is the default
// every pre-existing case in this file assumes.
let existingRun: { id: string } | null = null;

vi.mock("../../../../lib/hooks", () => ({
  useAgents: () => ({ data: AGENTS }),
  useAgentEstimates: () => ({ data: ESTIMATES }),
  // Deliberately NOT in `updated_at` order — the PR select must sort these
  // itself, the way the Pull Requests list does (newest first).
  usePulls: () => ({
    data: [
      { id: "pr1", number: 482, title: "Add rate limiting", updated_at: "2026-08-20T10:00:00Z" },
      { id: "pr2", number: 7, title: "Smart Diff", updated_at: "2026-08-27T10:00:00Z" },
      { id: "pr3", number: 3, title: "Severity counters", updated_at: "2026-08-10T10:00:00Z" },
    ],
  }),
  useMultiAgentRun: () => ({ data: existingRun }),
  useStartMultiAgentReview: () => ({ mutateAsync, isPending: false }),
}));

import { ConfigureRun } from "./ConfigureRun";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  existingRun = null;
  currentSearch = new URLSearchParams();
});

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: runsMessages, prReview: prReviewMessages }}>
      <ConfigureRun />
    </NextIntlClientProvider>,
  );
}

describe("ConfigureRun — no PR selected (AC-2, AC-4)", () => {
  it('renders the "Pick a pull request first" empty state and disables the start control', () => {
    renderWithIntl();

    expect(screen.getByText("Pick a pull request first")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run multi-agent review (0)" })).toBeDisabled();
  });
});

describe("ConfigureRun — a PR is selected (AC-9, AC-8)", () => {
  it("checking two agents with estimates aggregates to the greatest duration and the summed cost, and becomes startable", () => {
    currentSearch = new URLSearchParams("pr=pr1");
    renderWithIntl();

    fireEvent.click(screen.getByRole("checkbox", { name: "Security" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Performance" }));

    // Scope to the footer (aggregate line + Run control) — "9.0s" alone is
    // ambiguous with the Performance row's own per-agent estimate.
    const runControl = screen.getByRole("button", { name: "Run multi-agent review (2)" });
    const footer = runControl.closest("div")!;

    // duration: max(5000, 9000) = 9000ms → "9.0s"; cost: 0.05 + 0.20 = 0.25 → "$0.25".
    expect(within(footer).getByText(/9\.0s/)).toBeInTheDocument();
    expect(within(footer).getByText(/\$0\.25/)).toBeInTheDocument();
    expect(within(footer).queryByText(/Estimate incomplete/)).not.toBeInTheDocument();

    expect(runControl).not.toBeDisabled();
  });

  it("marks the aggregate incomplete when one selected agent has no estimate", () => {
    currentSearch = new URLSearchParams("pr=pr1");
    renderWithIntl();

    fireEvent.click(screen.getByRole("checkbox", { name: "Security" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "No Estimate Agent" }));

    expect(screen.getByText(/Estimate incomplete — some agents have no prior run./)).toBeInTheDocument();
  });
});

describe("ConfigureRun — submit (AC-5)", () => {
  it("submitting starts the run and pushes /multi-agent/<prId>", async () => {
    currentSearch = new URLSearchParams("pr=pr1");
    renderWithIntl();

    fireEvent.click(screen.getByRole("checkbox", { name: "Security" }));
    fireEvent.click(screen.getByRole("button", { name: "Run multi-agent review (1)" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/multi-agent/pr1"));
    expect(mutateAsync).toHaveBeenCalledWith({ prId: "pr1", agentIds: ["a1"] });
  });
});

describe("ConfigureRun — PR select ordering", () => {
  it("lists pull requests newest-first, matching the Pull Requests list's default sort", () => {
    renderWithIntl();

    const options = [...screen.getByRole("combobox").querySelectorAll("option")].map(
      (o) => (o as HTMLOptionElement).value,
    );

    // Placeholder first, then updated_at DESC — not the order usePulls returned.
    expect(options).toEqual(["", "pr2", "pr1", "pr3"]);
  });
});

describe("ConfigureRun — reaching an existing review", () => {
  it("offers no way back when the chosen PR has no run yet", () => {
    currentSearch = new URLSearchParams("pr=pr1");
    renderWithIntl();

    expect(screen.queryByRole("button", { name: "View latest results" })).toBeNull();
  });

  it("offers 'View latest results' once the chosen PR already has a run, without starting a new one", () => {
    currentSearch = new URLSearchParams("pr=pr1");
    existingRun = { id: "group-1" };
    renderWithIntl();

    fireEvent.click(screen.getByRole("button", { name: "View latest results" }));

    expect(push).toHaveBeenCalledWith("/multi-agent/pr1");
    // The whole point of the link: reading a finished review must not cost a
    // fresh set of model calls.
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("offers no way back before a PR is chosen", () => {
    existingRun = { id: "group-1" };
    renderWithIntl();

    expect(screen.queryByRole("button", { name: "View latest results" })).toBeNull();
  });
});
