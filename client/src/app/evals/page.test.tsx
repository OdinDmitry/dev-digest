import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EvalDashboard, EvalDashboardEntry } from "@devdigest/shared";
import evalMessages from "../../../messages/en/eval.json";
import commonMessages from "../../../messages/en/common.json";

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

// The shell pulls in repo/theme context and nav chrome this test does not
// exercise (mirrors client/src/.../SkillsView.test.tsx).
vi.mock("../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import EvalDashboardPage from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function entry(overrides: Partial<EvalDashboardEntry> = {}): EvalDashboardEntry {
  return {
    agent_id: "ag1",
    agent_name: "Test Quality Reviewer",
    model: "claude-opus",
    cases_total: 4,
    never_run: false,
    running: false,
    last_run_started_at: "2026-08-20T00:00:00Z",
    traces_passed: 3,
    traces_total: 4,
    recall: 0.8,
    precision: 0.9,
    citation_accuracy: 0.7,
    ...overrides,
  };
}

function mockDashboard(dashboard: EvalDashboard) {
  get.mockImplementation((path: string) => {
    if (path === "/evals/dashboard") return Promise.resolve(dashboard);
    throw new Error(`unexpected GET ${path}`);
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, common: commonMessages }}>
        <EvalDashboardPage />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("Eval Dashboard page", () => {
  it("renders one row per agent, including one with never_run: true (AC-35)", async () => {
    mockDashboard({
      agents: [
        entry({ agent_id: "ag1", agent_name: "Never Ran Agent", never_run: true, last_run_started_at: null, traces_passed: null, traces_total: null, recall: null, precision: null, citation_accuracy: null }),
        entry({ agent_id: "ag2", agent_name: "Ran Before Agent" }),
      ],
      run_all: { agent_count: 2, case_count: 8 },
    });

    renderPage();

    expect(await screen.findByText("Never Ran Agent")).toBeInTheDocument();
    expect(screen.getByText("Ran Before Agent")).toBeInTheDocument();
    // the never-run agent states so instead of showing (empty) metric bars.
    expect(screen.getByText("Never run")).toBeInTheDocument();
  });

  it("renders dashboard.emptyAgents and a non-activatable run-all control for the empty payload", async () => {
    mockDashboard({ agents: [], run_all: { agent_count: 0, case_count: 0 } });

    renderPage();

    expect(await screen.findByText("No agent has an eval set yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run all agents" })).toBeDisabled();
  });

  it("activating run-all shows the confirmation naming agent_count and cases_count before any request fires (AC-32)", async () => {
    mockDashboard({
      agents: [
        entry({ agent_id: "ag1", agent_name: "Agent One" }),
        entry({ agent_id: "ag2", agent_name: "Agent Two" }),
        entry({ agent_id: "ag3", agent_name: "Agent Three" }),
      ],
      run_all: { agent_count: 3, case_count: 11 },
    });

    renderPage();
    // The control is rendered (and disabled) even before the dashboard data
    // has loaded — wait until it reflects the loaded agent_count before
    // treating it as activatable.
    const runAllBtn = screen.getByRole("button", { name: "Run all agents" });
    await waitFor(() => expect(runAllBtn).not.toBeDisabled());

    fireEvent.click(runAllBtn);

    expect(
      await screen.findByText("This will start 3 agent runs and evaluate 11 cases."),
    ).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("confirming the run-all dialog posts exactly once (AC-31)", async () => {
    mockDashboard({
      agents: [entry({ agent_id: "ag1" })],
      run_all: { agent_count: 1, case_count: 4 },
    });
    post.mockResolvedValue({ runs: [] });

    renderPage();
    const runAllBtn = screen.getByRole("button", { name: "Run all agents" });
    await waitFor(() => expect(runAllBtn).not.toBeDisabled());
    fireEvent.click(runAllBtn);
    await screen.findByText("This will start 1 agent runs and evaluate 4 cases.");

    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/evals/run-all", undefined);
  });
});
