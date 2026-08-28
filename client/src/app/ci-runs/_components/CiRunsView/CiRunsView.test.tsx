import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CiRefreshResult, CiRun } from "@devdigest/shared";
import ciMessages from "../../../../../messages/en/ci.json";

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

import { CiRunsView } from "./CiRunsView";

function run(over: Partial<CiRun> = {}): CiRun {
  return {
    id: "run1",
    ci_installation_id: "inst1",
    agent_id: "ag1",
    agent_name: "Security Reviewer",
    repo: "acme/payments-api",
    pr_number: 42,
    head_sha: "abc123",
    status: "recorded",
    verdict: "approved",
    unavailable_reason: null,
    findings_count: 3,
    critical: 1,
    warning: 1,
    suggestion: 1,
    cost_usd: 0.12,
    duration_ms: 5200,
    ran_at: "2026-08-20T00:00:00Z",
    job_url: "https://github.com/acme/payments-api/actions/runs/1",
    model: "gpt-4.1",
    manifest_version: 1,
    runner_build: "1",
    ...over,
  };
}

function mockRuns(runs: CiRun[]) {
  get.mockImplementation((path: string) => {
    if (path === "/ci/runs") return Promise.resolve(runs);
    throw new Error(`unexpected GET ${path}`);
  });
}

function mockRefresh(result: CiRefreshResult) {
  post.mockImplementation((path: string) => {
    if (path === "/ci/refresh") return Promise.resolve(result);
    throw new Error(`unexpected POST ${path}`);
  });
}

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ ci: ciMessages }}>
        <CiRunsView />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CiRunsView — a recorded run (AC-16)", () => {
  it("renders repository, pull request, agent, verdict, findings, cost, duration and a job link", async () => {
    mockRuns([run()]);
    renderView();

    const row = (await screen.findByText("acme/payments-api")).closest("tr")!;
    expect(within(row).getByText("#42")).toBeInTheDocument();
    expect(within(row).getByText("Security Reviewer")).toBeInTheDocument();
    expect(within(row).getByText("Approved")).toBeInTheDocument();
    expect(within(row).getByText("3")).toBeInTheDocument();
    expect(within(row).getByText("$0.12")).toBeInTheDocument();
    expect(within(row).getByText("5.2s")).toBeInTheDocument();
    const link = within(row).getByRole("link", { name: "View job" });
    expect(link).toHaveAttribute("href", run().job_url);
  });
});

describe("CiRunsView — in-progress run", () => {
  it("renders no verdict and no counts", async () => {
    mockRuns([run({ status: "in_progress", verdict: null, findings_count: null, cost_usd: null, duration_ms: null })]);
    renderView();

    const row = (await screen.findByText("acme/payments-api")).closest("tr")!;
    expect(within(row).getByText("In progress")).toBeInTheDocument();
    expect(within(row).queryByText("Approved")).not.toBeInTheDocument();
    // Verdict and findings cells both fall back to the placeholder.
    const dashes = within(row).getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });
});

describe("CiRunsView — unavailable run", () => {
  it("renders its reason and never a zero finding count", async () => {
    mockRuns([
      run({
        status: "unavailable",
        verdict: null,
        findings_count: null,
        unavailable_reason: "The uploaded artifact was malformed.",
      }),
    ]);
    renderView();

    const row = (await screen.findByText("acme/payments-api")).closest("tr")!;
    expect(within(row).getByText("Unavailable")).toBeInTheDocument();
    expect(within(row).getByText("The uploaded artifact was malformed.")).toBeInTheDocument();
    // Never a "0" — the findings cell shows the placeholder, not a real count.
    expect(within(row).queryByText("0")).not.toBeInTheDocument();
  });
});

describe("CiRunsView — skipped (fork) run", () => {
  it("renders the fork explanation and is not presented as a failure", async () => {
    mockRuns([
      run({
        status: "recorded",
        verdict: "skipped",
        findings_count: null,
        cost_usd: null,
        duration_ms: null,
      }),
    ]);
    renderView();

    const row = (await screen.findByText("acme/payments-api")).closest("tr")!;
    expect(within(row).getByText("Skipped")).toBeInTheDocument();
    expect(
      within(row).getByText("Skipped — pull requests from forks don't receive secrets, so the review could not run."),
    ).toBeInTheDocument();
    // The run status itself is still "Recorded" — a fork skip is not an
    // unavailable/failed run.
    expect(within(row).getByText("Recorded")).toBeInTheDocument();
    expect(within(row).queryByText("Unavailable")).not.toBeInTheDocument();
  });
});

describe("CiRunsView — ordering", () => {
  it("renders rows most-recent-first regardless of the API's own order", async () => {
    mockRuns([
      run({ id: "old", repo: "acme/oldest", ran_at: "2026-08-01T00:00:00Z" }),
      run({ id: "newest", repo: "acme/newest", ran_at: "2026-08-25T00:00:00Z" }),
      run({ id: "mid", repo: "acme/mid", ran_at: "2026-08-10T00:00:00Z" }),
    ]);
    renderView();

    await screen.findByText("acme/newest");
    const repoCells = screen.getAllByText(/^acme\/(oldest|newest|mid)$/);
    expect(repoCells.map((el) => el.textContent)).toEqual(["acme/newest", "acme/mid", "acme/oldest"]);
  });
});

describe("CiRunsView — refresh rejections", () => {
  it("renders one line naming the rejected job", async () => {
    mockRuns([]);
    mockRefresh({
      runs: [],
      recorded: 0,
      skipped_existing: 0,
      rejected: [{ job_url: "https://github.com/acme/payments-api/actions/runs/9", reason: "missing artifact" }],
      installations_checked: 1,
    });
    renderView();
    await screen.findByText("No CI installations yet");

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await screen.findByText("Some runs could not be recorded");
    expect(
      screen.getByText("https://github.com/acme/payments-api/actions/runs/9: missing artifact"),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/missing artifact/)).toHaveLength(1);
  });
});

describe("CiRunsView — empty states", () => {
  it("shows the no-installation copy before any refresh", async () => {
    mockRuns([]);
    renderView();

    expect(await screen.findByText("No CI installations yet")).toBeInTheDocument();
    expect(
      screen.getByText("Export an agent to CI from its CI tab to start recording runs here."),
    ).toBeInTheDocument();
  });

  it("shows the plain empty-runs copy once a refresh proves installations exist", async () => {
    mockRuns([]);
    mockRefresh({ runs: [], recorded: 0, skipped_existing: 0, rejected: [], installations_checked: 2 });
    renderView();
    await screen.findByText("No CI installations yet");

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(screen.getByText("No CI runs yet")).toBeInTheDocument());
    expect(
      screen.getByText("Once you export an agent to CI, every automated review shows up here."),
    ).toBeInTheDocument();
    expect(screen.queryByText("No CI installations yet")).not.toBeInTheDocument();
  });
});

describe("CiRunsView — job link security (A05)", () => {
  it("renders no anchor for a non-https job_url", async () => {
    mockRuns([run({ job_url: "http://insecure.example/job" })]);
    renderView();

    const row = (await screen.findByText("acme/payments-api")).closest("tr")!;
    expect(within(row).queryByRole("link")).not.toBeInTheDocument();
    expect(within(row).getByText("—")).toBeInTheDocument();
  });
});
