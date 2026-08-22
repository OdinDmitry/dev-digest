import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentVersion, EvalInvokedSkill, EvalSuiteRun } from "@devdigest/shared";
import evalMessages from "../../../../messages/en/eval.json";

// RunCompareDialog's only network-shaped dependency is `useAgentVersion`
// (`hooks/agents.ts`) — mocked here per-version so a 404 (→ `null`) and a
// resolved config can both be exercised without a QueryClient.
const useAgentVersion = vi.fn();
vi.mock("@/lib/hooks/agents", () => ({
  useAgentVersion: (...a: unknown[]) => useAgentVersion(...a),
}));

import { RunCompareDialog } from "./RunCompareDialog";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function invokedSkill(overrides: Partial<EvalInvokedSkill> & { skill_id: string }): EvalInvokedSkill {
  return { skill_version: 1, name: "Security Rubric", ...overrides };
}

function run(overrides: Partial<EvalSuiteRun> & { id: string; agent_version: number }): EvalSuiteRun {
  return {
    agent_id: "ag1",
    agent_name: "Security Reviewer",
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
    recall: 0.5,
    precision: 0.6,
    citation_accuracy: 0.5,
    cost_usd: 0.02,
    case_ids: ["c1", "c2"],
    ...overrides,
  };
}

function agentVersion(version: number, systemPrompt: string): AgentVersion {
  return {
    agent_id: "ag1",
    version,
    config: {
      provider: "openai",
      model: "gpt-4.1",
      system_prompt: systemPrompt,
      output_schema: null,
      strategy: "single-pass",
      ci_fail_on: "critical",
      repo_intel: true,
      skills: [],
    },
    created_at: "2026-08-10T10:00:00.000Z",
  };
}

/** Maps a queried `version` number to a resolved config or `null` (404). */
function mockVersions(byVersion: Record<number, AgentVersion | null>) {
  useAgentVersion.mockImplementation((_agentId: string, version: number) => ({
    data: byVersion[version],
    isLoading: false,
  }));
}

function renderDialog(earlier: EvalSuiteRun, later: EvalSuiteRun, onClose = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <RunCompareDialog agentId="ag1" earlier={earlier} later={later} onClose={onClose} />
    </NextIntlClientProvider>,
  );
  return { onClose };
}

describe("RunCompareDialog", () => {
  // Bound to AC-66 (SPEC-04) — retired SPEC-03 AC-31 covered the same
  // behaviour under a comparison that could be opened from any selection;
  // SPEC-04 narrows WHERE it opens from (the dashboard, AC-66) but not what
  // it shows once open, so this test's assertions carry over unchanged.
  it("compare_dialog_shows_both_values_and_the_delta", () => {
    mockVersions({ 2: agentVersion(2, "prompt A"), 3: agentVersion(3, "prompt A") });
    const earlier = run({ id: "r1", agent_version: 2, recall: 0.5, precision: 0.6, citation_accuracy: null });
    const later = run({ id: "r2", agent_version: 3, recall: 0.75, precision: 0.4, citation_accuracy: 0.8 });
    renderDialog(earlier, later);

    // Recall: 50% → 75%, +25pt.
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("(+25pt)")).toBeInTheDocument();

    // Precision: 60% → 40%, -20pt.
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getByText("(-20pt)")).toBeInTheDocument();

    // Citation accuracy: earlier absent → delta is absent too, an em dash,
    // never a stray percentage or a zero-point delta.
    expect(screen.getByText("80%")).toBeInTheDocument();
    // Exactly two absent values (citation's earlier value and its delta) —
    // if a `?? 0` crept into the render path, `null` would render as "0%"/
    // "0pt" instead and this count would drop to zero.
    const notAvailable = screen.getAllByLabelText("not available");
    expect(notAvailable).toHaveLength(2);
    notAvailable.forEach((el) => expect(el).toHaveTextContent("—"));
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("compare_dialog_shows_both_costs_and_the_delta", () => {
    mockVersions({ 2: agentVersion(2, "prompt A"), 3: agentVersion(3, "prompt A") });
    const earlier = run({ id: "r1", agent_version: 2, cost_usd: 0.02 });
    const later = run({ id: "r2", agent_version: 3, cost_usd: 0.05 });
    renderDialog(earlier, later);

    expect(screen.getByText("$0.02")).toBeInTheDocument();
    expect(screen.getByText("$0.05")).toBeInTheDocument();
    expect(screen.getByText("(+$0.03)")).toBeInTheDocument();
  });

  it("a null cost on either run renders an em dash cost delta, never a $0.00 one", () => {
    mockVersions({ 2: agentVersion(2, "prompt A"), 3: agentVersion(3, "prompt A") });
    const earlier = run({ id: "r1", agent_version: 2, cost_usd: null });
    const later = run({ id: "r2", agent_version: 3, cost_usd: 0.05 });
    renderDialog(earlier, later);

    expect(screen.queryByText("(+$0.00)")).not.toBeInTheDocument();
    expect(screen.queryByText("(-$0.00)")).not.toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("compare_dialog_diffs_the_two_system_prompts", () => {
    mockVersions({
      2: agentVersion(2, "You are a security reviewer.\nBe strict."),
      3: agentVersion(3, "You are a security reviewer.\nBe thorough."),
    });
    renderDialog(run({ id: "r1", agent_version: 2 }), run({ id: "r2", agent_version: 3 }));

    expect(screen.getByText("Be strict.")).toBeInTheDocument();
    expect(screen.getByText("Be thorough.")).toBeInTheDocument();
    expect(screen.queryByText("The prompt diff can't be shown — a compared configuration version no longer exists.")).not.toBeInTheDocument();
  });

  it("renders the 'cannot be shown' statement when a compared configuration version is gone", () => {
    mockVersions({ 2: agentVersion(2, "prompt A"), 3: null });
    renderDialog(run({ id: "r1", agent_version: 2 }), run({ id: "r2", agent_version: 3 }));

    expect(
      screen.getByText("The prompt diff can't be shown — a compared configuration version no longer exists."),
    ).toBeInTheDocument();
  });

  it("compare_dialog_states_differing_case_sets", () => {
    mockVersions({ 2: agentVersion(2, "prompt A"), 3: agentVersion(3, "prompt A") });
    const earlier = run({ id: "r1", agent_version: 2, case_ids: ["c1", "c2"] });
    const later = run({ id: "r2", agent_version: 3, case_ids: ["c1", "c3"] });
    renderDialog(earlier, later);

    expect(
      screen.getByText("These two runs did not cover the same set of eval cases."),
    ).toBeInTheDocument();
  });

  it("says nothing about case sets when the two runs cover the identical set", () => {
    mockVersions({ 2: agentVersion(2, "prompt A"), 3: agentVersion(3, "prompt A") });
    const earlier = run({ id: "r1", agent_version: 2, case_ids: ["c1", "c2"] });
    const later = run({ id: "r2", agent_version: 3, case_ids: ["c2", "c1"] });
    renderDialog(earlier, later);

    expect(
      screen.queryByText("These two runs did not cover the same set of eval cases."),
    ).not.toBeInTheDocument();
  });

  it("compare_dialog_states_differing_invoked_skills", () => {
    mockVersions({ 2: agentVersion(2, "prompt A"), 3: agentVersion(3, "prompt A") });

    // Different SET of skill ids.
    const earlierDiffSet = run({
      id: "r1",
      agent_version: 2,
      invoked_skills: [invokedSkill({ skill_id: "s1", skill_version: 1, name: "Security Rubric" })],
    });
    const laterDiffSet = run({
      id: "r2",
      agent_version: 3,
      invoked_skills: [invokedSkill({ skill_id: "s2", skill_version: 1, name: "Other Rubric" })],
    });
    renderDialog(earlierDiffSet, laterDiffSet);
    expect(screen.getByText(/These two runs invoked different skills:/)).toBeInTheDocument();
    expect(screen.getByText(/Security Rubric \(v1 → v—\)/)).toBeInTheDocument();
    expect(screen.getByText(/Other Rubric \(v— → v1\)/)).toBeInTheDocument();
    cleanup();
    vi.clearAllMocks();

    // Same skill id, two different `skill_version` values.
    mockVersions({ 2: agentVersion(2, "prompt A"), 3: agentVersion(3, "prompt A") });
    const earlierDiffVersion = run({
      id: "r1",
      agent_version: 2,
      invoked_skills: [invokedSkill({ skill_id: "s1", skill_version: 1, name: "Security Rubric" })],
    });
    const laterDiffVersion = run({
      id: "r2",
      agent_version: 3,
      invoked_skills: [invokedSkill({ skill_id: "s1", skill_version: 2, name: "Security Rubric" })],
    });
    renderDialog(earlierDiffVersion, laterDiffVersion);
    expect(screen.getByText(/These two runs invoked different skills:/)).toBeInTheDocument();
    expect(screen.getByText(/Security Rubric \(v1 → v2\)/)).toBeInTheDocument();
    cleanup();
    vi.clearAllMocks();

    // Identical invoked skills → neither statement renders.
    mockVersions({ 2: agentVersion(2, "prompt A"), 3: agentVersion(3, "prompt A") });
    const same = invokedSkill({ skill_id: "s1", skill_version: 1, name: "Security Rubric" });
    renderDialog(
      run({ id: "r1", agent_version: 2, invoked_skills: [same] }),
      run({ id: "r2", agent_version: 3, invoked_skills: [{ ...same }] }),
    );
    expect(screen.queryByText(/These two runs invoked different skills:/)).not.toBeInTheDocument();
  });

  it("keeps Tab focus inside the dialog and restores it to the opening control on close", () => {
    mockVersions({ 2: agentVersion(2, "prompt A"), 3: agentVersion(3, "prompt A") });
    const earlier = run({ id: "r1", agent_version: 2 });
    const later = run({ id: "r2", agent_version: 3 });

    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open compare</button>
          {open && (
            <RunCompareDialog agentId="ag1" earlier={earlier} later={later} onClose={() => setOpen(false)} />
          )}
        </>
      );
    }

    render(
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
        <Harness />
      </NextIntlClientProvider>,
    );

    const opener = screen.getByRole("button", { name: "Open compare" });
    opener.focus();
    fireEvent.click(opener);

    const closeButtons = screen.getAllByRole("button", { name: "Close" });
    expect(closeButtons).toHaveLength(2);
    const [headerClose, footerClose] = closeButtons as [HTMLElement, HTMLElement];

    // Mounting the dialog moves focus inside it, to the first focusable node.
    expect(document.activeElement).toBe(headerClose);

    // Shift+Tab from the first focusable wraps to the last.
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(footerClose);

    // Tab from the last wraps back to the first.
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(headerClose);

    // Closing the dialog returns focus to the control that opened it.
    fireEvent.click(footerClose);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(opener);
  });
});
