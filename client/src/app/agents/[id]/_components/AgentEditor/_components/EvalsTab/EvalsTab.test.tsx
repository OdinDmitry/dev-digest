import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EvalCase, EvalExpectation, EvalPerTrace, EvalRun, EvalRunRecord } from "@devdigest/shared";
import evalMessages from "../../../../../../../../messages/en/eval.json";

const get = vi.fn();
const post = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    get: (p: string) => get(p),
    post: (p: string, body?: unknown) => post(p, body),
    put: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class extends Error {},
  API_BASE: "http://localhost:3001",
}));

import { EvalsTab } from "./EvalsTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const POSITIVE_EXPECTATION: EvalExpectation = {
  kind: "must_find",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  title: "Hardcoded Stripe secret key",
  severity: null,
  category: null,
};

let caseSeq = 0;
function makeCase(overrides: Partial<EvalCase> = {}): EvalCase {
  caseSeq += 1;
  return {
    id: `case-${caseSeq}`,
    owner_kind: "agent",
    owner_id: "ag1",
    name: `case-${caseSeq}`,
    input_diff: "--- a/x\n+++ b/x",
    repo_id: "repo1",
    repo_full_name: "acme/widgets",
    expectations: [POSITIVE_EXPECTATION],
    polarity: "must_find",
    origin: null,
    notes: null,
    resolves_context: true,
    last_outcome: null,
    created_at: "2026-08-20T00:00:00Z",
    updated_at: "2026-08-20T00:00:00Z",
    ...overrides,
  };
}

function makeOutcome(overrides: Partial<EvalPerTrace> = {}): EvalPerTrace {
  return {
    case_id: "case-1",
    name: "case-1",
    status: "passed",
    pass: true,
    errored: false,
    error: null,
    findings: [],
    raw_findings_count: 1,
    expected_count: 1,
    matched_count: 1,
    cost_usd: 0.01,
    duration_ms: 500,
    stored: true,
    ...overrides,
  };
}

function makeRunRecord(overrides: Partial<EvalRunRecord> = {}): EvalRunRecord {
  return {
    id: "run1",
    agent_id: "ag1",
    started_at: "2026-08-20T00:00:00Z",
    state: "completed",
    recall: 0.8,
    precision: 0.9,
    citation_accuracy: 0.7,
    traces_passed: 4,
    traces_total: 5,
    errored_count: 0,
    cost_usd: 0.05,
    duration_ms: 12000,
    delta: null,
    ...overrides,
  };
}

function makeActiveRun(overrides: Partial<EvalRun> = {}): EvalRun {
  return {
    id: "run-active",
    agent_id: "ag1",
    agent_name: "Test Quality Reviewer",
    state: "running",
    started_at: "2026-08-22T00:00:00Z",
    finished_at: null,
    system_prompt: "prompt",
    provider: "anthropic",
    model: "claude",
    strategy: "default",
    skills: [],
    captured_context: { documents: [], excluded: [] },
    recall: null,
    precision: null,
    citation_accuracy: null,
    traces_passed: 0,
    traces_total: 0,
    errored_count: 0,
    duration_ms: null,
    cost_usd: null,
    per_trace: [],
    ...overrides,
  };
}

function setupGet(opts: { cases: EvalCase[]; runs: EvalRunRecord[]; active: EvalRun | null }) {
  get.mockImplementation((path: string) => {
    if (path.endsWith("/eval-runs/active")) return Promise.resolve(opts.active);
    if (path.endsWith("/eval-runs")) return Promise.resolve(opts.runs);
    if (path.endsWith("/eval-cases")) return Promise.resolve(opts.cases);
    throw new Error(`unexpected GET ${path}`);
  });
}

function renderTab(agentId = "ag1", qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const utils = render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
        <EvalsTab agentId={agentId} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { ...utils, qc };
}

describe("EvalsTab", () => {
  it("renders the agent's cases from the mocked payload", async () => {
    setupGet({ cases: [makeCase({ name: "stripe-key-leak" }), makeCase({ name: "no-secret-leak" })], runs: [], active: null });
    renderTab();

    expect(await screen.findByText("stripe-key-leak")).toBeInTheDocument();
    expect(screen.getByText("no-secret-leak")).toBeInTheDocument();
  });

  it("renders no activatable run-all control for an agent with zero eval cases (AC-22)", async () => {
    setupGet({ cases: [], runs: [], active: null });
    renderTab();

    await waitFor(() => expect(screen.getByText(/No eval cases yet\./)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Run all evals" })).not.toBeInTheDocument();
  });

  it("the run-all control is not activatable while a run is active, and dashboard.progress shows cases_done/cases_total (AC-23, AC-24)", async () => {
    setupGet({
      cases: [makeCase()],
      runs: [],
      active: makeActiveRun({
        traces_total: 5,
        per_trace: [
          makeOutcome({ status: "passed" }),
          makeOutcome({ status: "failed" }),
          makeOutcome({ status: "pending" }),
          makeOutcome({ status: "pending" }),
          makeOutcome({ status: "pending" }),
        ],
      }),
    });
    renderTab();

    const btn = await screen.findByRole("button", { name: "Running…" });
    expect(btn).toBeDisabled();
    expect(screen.getByText("2 of 5 cases evaluated")).toBeInTheDocument();
  });

  it("the previous completed run's metrics still render while a newer run is active (AC-25)", async () => {
    setupGet({
      cases: [makeCase()],
      runs: [makeRunRecord({ recall: 0.8, precision: 0.9, citation_accuracy: 0.7, traces_passed: 4, traces_total: 5 })],
      active: makeActiveRun({ traces_total: 5, per_trace: [] }),
    });
    renderTab();

    expect(await screen.findByText(/80%/)).toBeInTheDocument();
    expect(screen.getByText(/90%/)).toBeInTheDocument();
    expect(screen.getByText(/70%/)).toBeInTheDocument();
    expect(screen.getByText("4/5")).toBeInTheDocument();
  });

  it("renders evalsTab.neverRun where there is no completed run and no active run (AC-25)", async () => {
    setupGet({ cases: [makeCase()], runs: [], active: null });
    renderTab();

    expect(await screen.findByText("Never run")).toBeInTheDocument();
  });

  it("re-renders the outcome across pending → running → completed without remounting the tab, and announces completion without moving focus (AC-26, AC-45)", async () => {
    const cases = [makeCase({ id: "case-1", name: "stripe-key-leak" })];
    let active: EvalRun | null = makeActiveRun({ id: "run2", state: "pending", traces_total: 5, per_trace: [] });
    let runs: EvalRunRecord[] = [];

    get.mockImplementation((path: string) => {
      if (path.endsWith("/eval-runs/active")) return Promise.resolve(active);
      if (path.endsWith("/eval-runs")) return Promise.resolve(runs);
      if (path.endsWith("/eval-cases")) return Promise.resolve(cases);
      throw new Error(`unexpected GET ${path}`);
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = renderTab("ag1", qc);

    await waitFor(() => expect(screen.getByText("0 of 5 cases evaluated")).toBeInTheDocument());
    const tabRoot = container.firstElementChild;

    const newCaseBtn = screen.getByRole("button", { name: "New case" });
    newCaseBtn.focus();
    expect(document.activeElement).toBe(newCaseBtn);

    // pending → running: still active, progress advances.
    active = makeActiveRun({
      id: "run2",
      state: "running",
      traces_total: 5,
      per_trace: [makeOutcome({ status: "passed" }), makeOutcome({ status: "pending" })],
    });
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ["evals", "active", "ag1"] });
    });
    await waitFor(() => expect(screen.getByText("1 of 5 cases evaluated")).toBeInTheDocument());
    expect(container.firstElementChild).toBe(tabRoot); // same tab instance, not remounted
    expect(document.activeElement).toBe(newCaseBtn); // focus untouched by the poll

    // running → completed: no longer active; the run now shows up in history.
    active = null;
    runs = [
      makeRunRecord({
        id: "run2",
        recall: 0.9,
        precision: 0.85,
        citation_accuracy: 0.75,
        traces_passed: 5,
        traces_total: 5,
        duration_ms: 8000,
      }),
    ];
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ["evals", "active", "ag1"] });
    });

    expect(await screen.findByText(/90%/)).toBeInTheDocument();
    expect(container.firstElementChild).toBe(tabRoot);
    expect(document.activeElement).toBe(newCaseBtn);

    // AC-45: the aria-live region announces the outcome, never by moving focus.
    expect(await screen.findByText(/Eval run finished:/)).toBeInTheDocument();
    expect(document.activeElement).toBe(newCaseBtn);
  });

  it("the subtext reads 'expected {n}, got {m}' for both a positive and a negative case (AC-20)", async () => {
    const positive = makeCase({
      id: "case-pos",
      name: "must-find-case",
      expectations: [POSITIVE_EXPECTATION],
      last_outcome: makeOutcome({ case_id: "case-pos", expected_count: 1, matched_count: 1 }),
    });
    const negative = makeCase({
      id: "case-neg",
      name: "must-not-flag-case",
      expectations: [{ ...POSITIVE_EXPECTATION, kind: "must_not_flag" }],
      polarity: "must_not_flag",
      last_outcome: makeOutcome({ case_id: "case-neg", expected_count: 0, matched_count: 2 }),
    });
    setupGet({ cases: [positive, negative], runs: [], active: null });
    renderTab();

    // The subtext span also carries a leading " · " separator text node, so
    // its own text content is not an exact match — assert by substring.
    expect(await screen.findByText(/expected 1, got 1/)).toBeInTheDocument();
    expect(screen.getByText(/expected 0, got 2/)).toBeInTheDocument();
  });

  it("a preview result renders evalsTab.previewNotStored, and a case with only a persisted outcome renders that instead (AC-33, AC-34)", async () => {
    const caseA = makeCase({ id: "case-a", name: "case-preview", last_outcome: null });
    const caseB = makeCase({
      id: "case-b",
      name: "case-stored",
      last_outcome: makeOutcome({ case_id: "case-b", status: "failed", expected_count: 2, matched_count: 1 }),
    });
    setupGet({ cases: [caseA, caseB], runs: [], active: null });
    post.mockResolvedValue({
      case_id: "case-a",
      stored: false,
      result: makeOutcome({ case_id: "case-a", status: "passed", stored: false }),
    });

    renderTab();
    await screen.findByText("case-preview");

    // Persisted-only case shows its stored outcome, no preview label yet.
    expect(screen.getByText(/expected 2, got 1/)).toBeInTheDocument();
    expect(screen.queryByText("Preview — not stored")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Run the eval case case-preview"));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));

    expect(await screen.findByText("Preview — not stored")).toBeInTheDocument();
    // The persisted case's own outcome is untouched by the other case's preview.
    expect(screen.getByText(/expected 2, got 1/)).toBeInTheDocument();
  });

  it("a case with resolves_context: false renders evalsTab.noContext (AC-50)", async () => {
    const withContext = makeCase({ id: "case-ctx", name: "has-context", resolves_context: true });
    const noContext = makeCase({ id: "case-noctx", name: "no-context", resolves_context: false });
    setupGet({ cases: [withContext, noContext], runs: [], active: null });
    renderTab();

    await screen.findByText("has-context");
    expect(screen.getAllByText("No project context will be resolved for this case.")).toHaveLength(1);
  });

  it("expectations carrying severity and category render both (AC-56)", async () => {
    const withMeta = makeCase({
      name: "sev-cat-case",
      expectations: [{ ...POSITIVE_EXPECTATION, severity: "critical", category: "security" }],
    });
    setupGet({ cases: [withMeta], runs: [], active: null });
    renderTab();

    expect(await screen.findByText("critical · security")).toBeInTheDocument();
  });

  it("the evalsTab.viewDashboard control links to /evals/{agentId} (AC-55)", async () => {
    setupGet({ cases: [], runs: [], active: null });
    renderTab("ag42");

    await waitFor(() => expect(screen.getByText(/No eval cases yet\./)).toBeInTheDocument());
    const link = screen.getByRole("link", { name: "View full dashboard" });
    expect(link).toHaveAttribute("href", "/evals/ag42");
  });
});
