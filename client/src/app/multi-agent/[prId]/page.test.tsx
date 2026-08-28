import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AgentColumn, FindingRecord, MultiAgentRun } from "@devdigest/shared";
import runsMessages from "../../../../messages/en/runs.json";
import prReviewMessages from "../../../../messages/en/prReview.json";
import evalMessages from "../../../../messages/en/eval.json";
import commonMessages from "../../../../messages/en/common.json";

const get = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    get: (p: string) => get(p),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class extends Error {},
  API_BASE: "http://localhost:3001",
}));

// The shell pulls in repo/theme context and nav chrome this test does not
// exercise (mirrors client/src/app/evals/page.test.tsx).
vi.mock("../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// RunTraceDrawer has its own colocated test (RunTraceDrawer.test.tsx); here
// we only need to see whether/with-what-props the page mounted it.
const traceDrawerProps = vi.fn();
vi.mock("../../../components/run-trace-drawer/RunTraceDrawer", () => ({
  default: (props: { runId: string; agentName: string; running?: boolean; onClose: () => void }) => {
    traceDrawerProps(props);
    return <div data-testid="trace-drawer">trace for {props.agentName}</div>;
  },
}));

let currentSearch = new URLSearchParams();
const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({ prId: "pr1" }),
  useRouter: () => ({ push, replace }),
  useSearchParams: () => currentSearch,
}));

import MultiAgentResultsPage from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  currentSearch = new URLSearchParams();
});

function finding(overrides: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: "f1",
    severity: "WARNING",
    category: "bug",
    title: "Missing null check",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "because",
    suggestion: null,
    confidence: 0.8,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

function column(overrides: Partial<AgentColumn> = {}): AgentColumn {
  return {
    run_id: "run-1",
    agent_id: "agent-1",
    agent_name: "Security",
    agent_description: null,
    provider: "anthropic",
    model: "claude",
    status: "done",
    verdict: "comment",
    score: 80,
    summary: null,
    duration_ms: 8200,
    cost_usd: 0.05,
    error: null,
    findings: [],
    ...overrides,
  };
}

function runFixture(overrides: Partial<MultiAgentRun> = {}): MultiAgentRun {
  return {
    id: "group-1",
    pr_id: "pr1",
    pr_number: 482,
    ran_at: "2026-08-27T00:00:00Z",
    agent_count: 3,
    total_duration_ms: 25000,
    total_cost_usd: 0.3,
    columns: [],
    conflicts: [],
    ...overrides,
  };
}

function mockRun(run: MultiAgentRun | null) {
  get.mockImplementation((path: string) => {
    if (path === "/pulls/pr1/multi-agent") return Promise.resolve(run);
    throw new Error(`unexpected GET ${path}`);
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider
        locale="en"
        messages={{ runs: runsMessages, prReview: prReviewMessages, eval: evalMessages, common: commonMessages }}
      >
        <MultiAgentResultsPage />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("Multi-agent results page — simultaneous states (AC-10, AC-11)", () => {
  it("renders running/done/failed simultaneously, the failed column's error, and the done column's findings + score unchanged", async () => {
    mockRun(
      runFixture({
        columns: [
          column({ run_id: "run-running", agent_id: "a-running", agent_name: "Running Agent", status: "running", score: null }),
          column({
            run_id: "run-done",
            agent_id: "a-done",
            agent_name: "Done Agent",
            status: "done",
            score: 91,
            findings: [finding({ title: "Missing null check" })],
          }),
          column({ run_id: "run-failed", agent_id: "a-failed", agent_name: "Failed Agent", status: "failed", score: null, error: "ANTHROPIC_API_KEY is not configured" }),
        ],
      }),
    );

    renderPage();

    expect(await screen.findByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();

    // failed column's own error
    expect(screen.getByText("ANTHROPIC_API_KEY is not configured")).toBeInTheDocument();
    // done column's score + findings, unaffected by its failed sibling
    expect(screen.getByText("91")).toBeInTheDocument();
    expect(screen.getByText("Missing null check")).toBeInTheDocument();
  });
});

describe("Multi-agent results page — no cross-agent merging (AC-15)", () => {
  it("renders an identical finding (same title, same file:start_line) once per column, not merged into one", async () => {
    const shared = finding({ id: "shared-1", title: "Hardcoded secret", file: "src/config.ts", start_line: 11, end_line: 11 });
    mockRun(
      runFixture({
        columns: [
          column({ run_id: "run-a", agent_id: "agent-a", agent_name: "Security Reviewer", findings: [shared] }),
          column({ run_id: "run-b", agent_id: "agent-b", agent_name: "Perf Reviewer", findings: [shared] }),
        ],
      }),
    );

    renderPage();

    await screen.findByText("Security Reviewer");
    expect(screen.getAllByText("Hardcoded secret")).toHaveLength(2);
    expect(screen.getByText("Perf Reviewer")).toBeInTheDocument();
  });
});

describe("Multi-agent results page — no normalisation of duration figures (AC-16)", () => {
  it("renders the group total verbatim and each column's own duration unchanged — no substitution of max or sum", async () => {
    mockRun(
      runFixture({
        total_duration_ms: 25000, // NOT max(8200,7400,6900)=8200 nor sum=22500
        columns: [
          column({ run_id: "r1", agent_id: "a1", agent_name: "A1", duration_ms: 8200 }),
          column({ run_id: "r2", agent_id: "a2", agent_name: "A2", duration_ms: 7400 }),
          column({ run_id: "r3", agent_id: "a3", agent_name: "A3", duration_ms: 6900 }),
        ],
      }),
    );

    renderPage();

    expect(await screen.findByText(/25\.0s/)).toBeInTheDocument();
    expect(screen.getByText("8.2s")).toBeInTheDocument();
    expect(screen.getByText("7.4s")).toBeInTheDocument();
    expect(screen.getByText("6.9s")).toBeInTheDocument();
    // Neither the max(8.2s, already covered above) nor a summed 22.5s appear
    // as the TOTAL — the total text itself is asserted above via 25.0s.
    expect(screen.queryByText(/22\.5s/)).not.toBeInTheDocument();
  });
});

describe("Multi-agent results page — View trace (AC-12)", () => {
  it("clicking a panel's View trace navigates to ?trace=<run_id>", async () => {
    mockRun(
      runFixture({
        columns: [column({ run_id: "run-running", agent_id: "a-running", agent_name: "Running Agent", status: "running", score: null })],
      }),
    );

    renderPage();
    await screen.findByText("Running Agent");

    fireEvent.click(screen.getByRole("button", { name: "View trace — Running Agent" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/multi-agent/pr1?trace=run-running"));
  });

  it("mounts the drawer with running: true when ?trace= points at a running column", async () => {
    currentSearch = new URLSearchParams("trace=run-running");
    mockRun(
      runFixture({
        columns: [column({ run_id: "run-running", agent_id: "a-running", agent_name: "Running Agent", status: "running", score: null })],
      }),
    );

    renderPage();

    await waitFor(() => expect(traceDrawerProps).toHaveBeenCalled());
    const props = traceDrawerProps.mock.calls.at(-1)![0];
    expect(props.runId).toBe("run-running");
    expect(props.running).toBe(true);
  });
});

describe("Multi-agent results page — empty state (AC-14)", () => {
  it("a null response renders the empty state and its cta navigates to /multi-agent", async () => {
    mockRun(null);

    renderPage();

    expect(await screen.findByText("No multi-agent review yet")).toBeInTheDocument();
    const cta = screen.getByRole("button", { name: "Configure a run" });
    fireEvent.click(cta);
    expect(push).toHaveBeenCalledWith("/multi-agent");
  });
});

describe("Multi-agent results page — ?view= handling (AC-13)", () => {
  it("?view=tabs on load renders tabs mode", async () => {
    currentSearch = new URLSearchParams("view=tabs");
    mockRun(
      runFixture({
        columns: [
          column({ run_id: "r1", agent_id: "a1", agent_name: "A1" }),
          column({ run_id: "r2", agent_id: "a2", agent_name: "A2" }),
        ],
      }),
    );

    renderPage();

    expect(await screen.findByRole("tablist")).toBeInTheDocument();
  });

  it("an unknown ?view= value falls back to columns mode", async () => {
    currentSearch = new URLSearchParams("view=grid-of-nonsense");
    mockRun(
      runFixture({
        columns: [
          column({ run_id: "r1", agent_id: "a1", agent_name: "A1" }),
          column({ run_id: "r2", agent_id: "a2", agent_name: "A2" }),
        ],
      }),
    );

    renderPage();

    await screen.findByText("A1");
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    // Columns mode renders every column's own panel, both agents visible.
    expect(screen.getByText("A2")).toBeInTheDocument();
  });
});

describe("Multi-agent results page — section order (design refs 04/05)", () => {
  it("renders the agent panels above the disagreement block, in both view modes", async () => {
    for (const view of ["columns", "tabs"]) {
      currentSearch = new URLSearchParams(`view=${view}`);
      mockRun(
        runFixture({
          columns: [
            column({ run_id: "r1", agent_id: "a1", agent_name: "A1" }),
            column({ run_id: "r2", agent_id: "a2", agent_name: "A2" }),
          ],
        }),
      );

      renderPage();

      // Tabs mode renders the agent name twice (the tab and the panel header),
      // so anchor on the LAST occurrence: the block must follow all of them.
      const matches = await screen.findAllByText("A1");
      const lastPanelNode = matches[matches.length - 1]!;
      const disagree = screen.getByText("Where agents disagree");

      // The panels are the primary result; the block that reads across them
      // comes second. DOCUMENT_POSITION_FOLLOWING === the block follows them.
      expect(
        lastPanelNode.compareDocumentPosition(disagree) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      cleanup();
    }
  });
});
