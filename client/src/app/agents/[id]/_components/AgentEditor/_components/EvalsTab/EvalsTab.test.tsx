import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalCaseRecord, EvalSuiteRun } from "@devdigest/shared";
import evalMessages from "../../../../../../../../messages/en/eval.json";

// SPEC-04 removed the run history from this surface entirely (AC-59) — it no
// longer renders `RunHistoryTable`, so mocking `hooks/eval` only needs the
// hooks EvalsTab itself calls: cases, this agent's own runs (for the latest
// COMPLETED run's metrics, AC-57), starting a run, editing/deleting a case,
// and verifying one case on its own (AC-46).
const useAgentEvalCases = vi.fn();
const useAgentEvalRuns = vi.fn();
const useStartEvalRun = vi.fn();
const useUpdateEvalCase = vi.fn();
const useDeleteEvalCase = vi.fn();
const useVerifyEvalCase = vi.fn();
vi.mock("@/lib/hooks/eval", () => ({
  useAgentEvalCases: (...a: unknown[]) => useAgentEvalCases(...a),
  useAgentEvalRuns: (...a: unknown[]) => useAgentEvalRuns(...a),
  useStartEvalRun: (...a: unknown[]) => useStartEvalRun(...a),
  useUpdateEvalCase: (...a: unknown[]) => useUpdateEvalCase(...a),
  useDeleteEvalCase: (...a: unknown[]) => useDeleteEvalCase(...a),
  useVerifyEvalCase: (...a: unknown[]) => useVerifyEvalCase(...a),
}));

import { EvalsTab } from "./EvalsTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 3,
};

// A `must_find` case, hit: expected 1 finding, got 1 (AC-53's "expected 1
// finding, got 1" row).
const CASE_HIT: EvalCaseRecord = {
  id: "case1",
  agent_id: "ag1",
  name: "stripe-key-leak",
  source_finding_id: "f1",
  file: "src/config.ts",
  start_line: 10,
  end_line: 12,
  fragment: "diff --git a/src/config.ts b/src/config.ts",
  expectations: [{ id: "e1", kind: "must_find", file: "src/config.ts", start_line: 10, end_line: 12 }],
  created_at: "2026-08-20T10:00:00.000Z",
  severity: "CRITICAL",
  category: "security",
  latest_result: {
    completed: true,
    passed: true,
    error: null,
    findings: [
      { file: "src/config.ts", start_line: 10, end_line: 12, grounded: true, severity: "CRITICAL", title: "Hardcoded key" },
    ],
    matched_count: 1,
    ran_at: "2026-08-20T11:00:00.000Z",
  },
};

// A `must_not_flag` case the agent correctly stayed silent on: expected 0,
// got 0.
const CASE_SILENT: EvalCaseRecord = {
  id: "case2",
  agent_id: "ag1",
  name: "safe-config-silence",
  source_finding_id: "f2",
  file: "src/other.ts",
  start_line: 5,
  end_line: 5,
  fragment: "diff --git a/src/other.ts b/src/other.ts",
  expectations: [{ id: "e2", kind: "must_not_flag", file: "src/other.ts", start_line: 5, end_line: 5 }],
  created_at: "2026-08-20T10:00:00.000Z",
  severity: "LOW",
  category: "style",
  latest_result: {
    completed: true,
    passed: true,
    error: null,
    findings: [],
    matched_count: 0,
    ran_at: "2026-08-20T11:00:00.000Z",
  },
};

// A `must_not_flag` case the agent flagged anyway: expected 0, got 1 — fails.
const CASE_FLAGGED: EvalCaseRecord = {
  id: "case3",
  agent_id: "ag1",
  name: "noisy-config",
  source_finding_id: "f3",
  file: "src/noisy.ts",
  start_line: 8,
  end_line: 8,
  fragment: "diff --git a/src/noisy.ts b/src/noisy.ts",
  expectations: [{ id: "e3", kind: "must_not_flag", file: "src/noisy.ts", start_line: 8, end_line: 8 }],
  created_at: "2026-08-20T10:00:00.000Z",
  severity: "LOW",
  category: "style",
  latest_result: {
    completed: true,
    passed: false,
    error: null,
    findings: [{ file: "src/noisy.ts", start_line: 8, end_line: 8, grounded: true, severity: null, title: null }],
    matched_count: 1,
    ran_at: "2026-08-20T11:00:00.000Z",
  },
};

// A case created before severity/category were captured and never run — the
// SPEC-04 edge case: unavailable, never a default (client/insights.md,
// `.default()` note; SPEC-04 § Contracts, Eval case).
const CASE_NEVER_RUN: EvalCaseRecord = {
  id: "case4",
  agent_id: "ag1",
  name: "unverified-case",
  source_finding_id: "f4",
  file: "src/legacy.ts",
  start_line: 1,
  end_line: 1,
  fragment: "diff --git a/src/legacy.ts b/src/legacy.ts",
  expectations: [{ id: "e4", kind: "must_find", file: "src/legacy.ts", start_line: 1, end_line: 1 }],
  created_at: "2026-08-01T10:00:00.000Z",
  severity: null,
  category: null,
  latest_result: null,
};

const COMPLETED_RUN: EvalSuiteRun = {
  id: "run1",
  agent_id: "ag1",
  agent_name: "Security Reviewer",
  agent_version: 3,
  invoked_skills: [],
  status: "completed",
  started_at: "2026-08-19T10:00:00.000Z",
  completed_at: "2026-08-19T10:01:00.000Z",
  cases_total: 1,
  cases_completed: 1,
  cases_passed: 1,
  cases_failed_to_complete: 0,
  recall: 1,
  precision: 1,
  citation_accuracy: 1,
  cost_usd: 0.01,
  case_ids: ["case1"],
};

const OLDER_COMPLETED_RUN: EvalSuiteRun = {
  ...COMPLETED_RUN,
  id: "run0",
  started_at: "2026-08-10T10:00:00.000Z",
  completed_at: "2026-08-10T10:01:00.000Z",
  recall: 0.5,
  precision: 0.5,
  citation_accuracy: 0.5,
  cases_passed: 0,
};

const RUNNING_RUN: EvalSuiteRun = {
  ...COMPLETED_RUN,
  id: "run2",
  status: "running",
  completed_at: null,
  cases_completed: 1,
  cases_total: 3,
  cases_passed: null,
  recall: null,
  precision: null,
  citation_accuracy: null,
  cost_usd: null,
};

function mockHooks({
  cases = [CASE_HIT],
  casesLoading = false,
  runs = [] as EvalSuiteRun[],
  startMutate = vi.fn(),
  startPending = false,
  verifyMutate = vi.fn(),
  verifyPending = false,
}: {
  cases?: EvalCaseRecord[];
  casesLoading?: boolean;
  runs?: EvalSuiteRun[];
  startMutate?: ReturnType<typeof vi.fn>;
  startPending?: boolean;
  verifyMutate?: ReturnType<typeof vi.fn>;
  verifyPending?: boolean;
}) {
  useAgentEvalCases.mockReturnValue({ data: cases, isLoading: casesLoading });
  useAgentEvalRuns.mockReturnValue({ data: runs, isLoading: false });
  useStartEvalRun.mockReturnValue({ mutate: startMutate, isPending: startPending });
  useUpdateEvalCase.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useDeleteEvalCase.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useVerifyEvalCase.mockReturnValue({ mutate: verifyMutate, isPending: verifyPending });
  return { startMutate, verifyMutate };
}

beforeEach(() => mockHooks({}));

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <EvalsTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}

describe("EvalsTab", () => {
  it("evals_tab_shows_the_case_set", () => {
    mockHooks({ cases: [CASE_HIT, CASE_SILENT] });
    renderTab();

    expect(screen.getByText("stripe-key-leak")).toBeInTheDocument();
    expect(screen.getByText("src/config.ts:10-12")).toBeInTheDocument();
    expect(screen.getByText("safe-config-silence")).toBeInTheDocument();
  });

  it("evals_tab_presents_no_run_history", () => {
    // AC-59 positive assertion: two completed runs exist, yet nothing that
    // identifies a RUN (its compare control, its start time, its version)
    // renders on this surface — only the case set does.
    mockHooks({ cases: [CASE_HIT], runs: [COMPLETED_RUN, OLDER_COMPLETED_RUN] });
    renderTab();

    expect(screen.getByText("stripe-key-leak")).toBeInTheDocument();
    expect(screen.queryByText("Compare")).not.toBeInTheDocument();
    expect(
      screen.queryByText(new Date(COMPLETED_RUN.started_at).toLocaleString()),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(new Date(OLDER_COMPLETED_RUN.started_at).toLocaleString()),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(`v${COMPLETED_RUN.agent_version}`)).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("evals_tab_shows_the_latest_completed_run_metrics", () => {
    // Two completed runs — the metrics block must read the NEWER one.
    mockHooks({ cases: [CASE_HIT], runs: [OLDER_COMPLETED_RUN, COMPLETED_RUN] });
    renderTab();

    // recall, precision and citation accuracy all read the newer run's 1
    // (not the older run's 0.5 → "50%") — three metric cards, all "100%".
    expect(screen.getAllByText("100%")).toHaveLength(3);
    expect(screen.queryByText("50%")).not.toBeInTheDocument();
    expect(screen.getByText("1/1")).toBeInTheDocument(); // pass count
  });

  it("evals_tab_states_no_run_has_happened", () => {
    mockHooks({ cases: [CASE_HIT], runs: [] });
    renderTab();

    expect(screen.getByText("No run has happened yet.")).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("evals_tab_shows_no_metrics_for_a_running_run", () => {
    // A running run plus an older completed one — the metrics block must
    // show the completed run's numbers, never anything attributable to the
    // running one (AC-61).
    mockHooks({ cases: [CASE_HIT], runs: [RUNNING_RUN, OLDER_COMPLETED_RUN] });
    renderTab();

    expect(screen.getAllByText("50%")).toHaveLength(3); // the older completed run's three metrics
    expect(screen.getByText("0/1")).toBeInTheDocument(); // its pass count
  });

  it("evals_tab_run_control_shows_progress", () => {
    mockHooks({ cases: [CASE_HIT], runs: [RUNNING_RUN] });
    renderTab();

    // While in progress the control's own label carries "N of M", replacing
    // its accessible name (which is only set while idle).
    const runButton = screen.getByRole("button", { name: "1 of 3 cases run" });
    expect(runButton).toHaveTextContent("1 of 3 cases run");
    expect(runButton).toBeDisabled();

    // A per-case status region (role="status") also exists on the one case
    // row rendered here — the run control's OWN progress announcement is the
    // one carrying this exact text.
    const progress = screen.getAllByRole("status").find((el) => el.textContent === "1 of 3 cases run");
    expect(progress).toBeDefined();
    expect(progress).toHaveAttribute("aria-live", "polite");
  });

  it("evals_tab_counts_cases_passed_in_their_latest_result", () => {
    // AC-58 reads cases' OWN most recent results, independent of run history:
    // two passed (CASE_HIT, CASE_SILENT), one failed (CASE_FLAGGED).
    mockHooks({ cases: [CASE_HIT, CASE_SILENT, CASE_FLAGGED], runs: [] });
    renderTab();

    expect(screen.getByText("2 / 3 passing")).toBeInTheDocument();
  });

  it("evals_tab_empty_set_blocks_the_run_control", () => {
    const { startMutate } = mockHooks({ cases: [], runs: [] });
    renderTab();

    expect(screen.getByText(/No eval cases yet/)).toBeInTheDocument();
    const runButton = screen.getByRole("button", { name: /Run eval set/ });
    expect(runButton).toBeDisabled();

    fireEvent.click(runButton);
    expect(startMutate).not.toHaveBeenCalled();
  });

  it("evals_tab_run_control_starts_one_run", () => {
    const { startMutate } = mockHooks({ cases: [CASE_HIT], runs: [] });
    renderTab();

    const runButton = screen.getByRole("button", { name: /Run eval set/ });
    expect(runButton).not.toBeDisabled();
    fireEvent.click(runButton);

    expect(startMutate).toHaveBeenCalledTimes(1);
    expect(startMutate).toHaveBeenCalledWith("ag1");
  });

  it("evals_tab_case_row_states_pass_kind_severity_and_category", () => {
    mockHooks({ cases: [CASE_HIT, CASE_FLAGGED] });
    renderTab();

    // AC-52: passed/failed state, severity/category AND the expectation type
    // are all stated as text on the COLLAPSED row itself — none of this
    // requires opening the case.
    expect(screen.getByText("passed")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByText("CRITICAL · security")).toBeInTheDocument();
    expect(screen.getByText("LOW · style")).toBeInTheDocument();
    expect(screen.getByText("Must find — the agent should flag this")).toBeInTheDocument();
    expect(screen.getByText("Must not flag — this is not a real issue")).toBeInTheDocument();

    // Opening the case repeats the SAME statement inside its own "Expected
    // outcome" block, beside the returned findings (AC-55). Scoped to that
    // block specifically with `within()` — the row's own copy above stays
    // rendered, so an unscoped query would now find two matches, and an
    // index-based one (`getAllByText(...)[1]`) would pass just as happily if
    // the two ever swapped places, which defeats the point of this
    // assertion: proving WHERE each copy renders, not just that it exists.
    fireEvent.click(screen.getByRole("button", { name: "Edit stripe-key-leak" }));
    const expectationHeading = screen.getByText("Expected outcome");
    expect(
      within(expectationHeading.parentElement!).getByText("Must find — the agent should flag this"),
    ).toBeInTheDocument();
  });

  it("evals_tab_case_row_states_expected_and_returned_counts", () => {
    // AC-53's three shapes, read straight off the server-computed
    // `matched_count` — never recomputed by the test.
    mockHooks({ cases: [CASE_HIT, CASE_SILENT, CASE_FLAGGED] });
    renderTab();

    expect(screen.getByText("expected 1 finding, got 1 finding")).toBeInTheDocument();
    expect(screen.getByText("expected 0 findings, got 0 findings")).toBeInTheDocument();
    expect(screen.getByText("expected 0 findings, got 1 finding")).toBeInTheDocument();
  });

  it("evals_tab_case_never_run_states_so", () => {
    mockHooks({ cases: [CASE_NEVER_RUN] });
    renderTab();

    expect(screen.getByText("never run")).toBeInTheDocument();
    expect(screen.queryByText("passed")).not.toBeInTheDocument();
    expect(screen.queryByText("failed")).not.toBeInTheDocument();
    // No default severity/category is invented for a pre-capture case.
    expect(screen.getByText("not available · not available")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit unverified-case" }));
    expect(screen.getByText("This case hasn't been run yet.")).toBeInTheDocument();
  });

  it("evals_tab_case_form_shows_expectation_beside_last_output", () => {
    mockHooks({ cases: [CASE_HIT] });
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: "Edit stripe-key-leak" }));

    // AC-55: the expectation, scoped to the panel's own "Expected outcome"
    // block — the collapsed row above states the SAME sentence for AC-52
    // (asserted in `evals_tab_case_row_states_pass_kind_severity_and_category`),
    // so an unscoped query here would now find two matches.
    const expectationHeading = screen.getByText("Expected outcome");
    expect(
      within(expectationHeading.parentElement!).getByText("Must find — the agent should flag this"),
    ).toBeInTheDocument();

    const resultsHeading = screen.getByText("Findings returned in the most recent result");
    // AC-55/AC-47: one entry per returned finding, its file and line range,
    // and its grounding state conveyed as text — not the exact composition
    // of that line (title/severity now also render there; asserted by
    // substring rather than one composed string, so this survives that kind
    // of addition unchanged). Scoped to the results section, since the row
    // header above ALSO shows this case's own file:line.
    const results = within(resultsHeading.parentElement!);
    expect(results.getByText(/src\/config\.ts:10-12/)).toBeInTheDocument();
    expect(results.getByText(/\bgrounded\b/)).toBeInTheDocument();
  });

  it("evals_tab_verify_control_verifies_one_case", () => {
    const { verifyMutate } = mockHooks({ cases: [CASE_HIT] });
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: "Verify stripe-key-leak" }));

    expect(verifyMutate).toHaveBeenCalledTimes(1);
    expect(verifyMutate).toHaveBeenCalledWith({ id: "case1", agentId: "ag1" });
  });

  it("evals_tab_verification_presents_the_returned_findings", () => {
    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
        <EvalsTab agent={AGENT} />
      </NextIntlClientProvider>,
    );
    mockHooks({ cases: [CASE_NEVER_RUN] });
    rerender(
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
        <EvalsTab agent={AGENT} />
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit unverified-case" }));
    expect(screen.getByText("This case hasn't been run yet.")).toBeInTheDocument();

    // The verification resolves — the case-set query refetches with this
    // case's `latest_result` now populated (AC-47), and the opened panel
    // (local `open` state survives the rerender) shows what came back.
    const VERIFIED_CASE: EvalCaseRecord = {
      ...CASE_NEVER_RUN,
      latest_result: {
        completed: true,
        passed: true,
        error: null,
        findings: [{ file: "src/legacy.ts", start_line: 1, end_line: 1, grounded: true, severity: null, title: null }],
        matched_count: 1,
        ran_at: "2026-08-22T09:00:00.000Z",
      },
    };
    mockHooks({ cases: [VERIFIED_CASE] });
    rerender(
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
        <EvalsTab agent={AGENT} />
      </NextIntlClientProvider>,
    );

    // Same loosened shape as AC-55's assertion above: identify the returned
    // finding by its file/line and its grounding state as text, not by the
    // exact string composed around them — scoped to the results section,
    // since the row header ALSO shows this case's own file:line.
    const resultsHeading = screen.getByText("Findings returned in the most recent result");
    const results = within(resultsHeading.parentElement!);
    expect(results.getByText(/src\/legacy\.ts:1\b/)).toBeInTheDocument();
    expect(results.getByText(/\bgrounded\b/)).toBeInTheDocument();
    expect(screen.queryByText("This case hasn't been run yet.")).not.toBeInTheDocument();
  });
});
