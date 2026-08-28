import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent, CiInstallation, CiRun, Repo } from "@devdigest/shared";
import ciMessages from "../../../../../../../../messages/en/ci.json";
// ExportWizard (mounted by the add-to-CI control) calls
// `useTranslations("common")` unconditionally for its Close button — without
// this the provider below throws MISSING_MESSAGE to stderr on every render
// that opens the wizard (same shape as AgentEditor.test.tsx's ci.json fix,
// client/insights.md 2026-08-16 pattern).
import commonMessages from "../../../../../../../../messages/en/common.json";

// Only "@/lib/api" is mocked — CiTab and the ExportWizard it opens both read
// through the real hooks (client/lib/hooks/ci.ts), matching the SkillsTab
// pattern (client/src/app/.../SkillsTab/SkillsTab.test.tsx): the behavior
// under test is which words/sections render for a given API response, so
// stubbing the hooks themselves would test nothing.
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

import { CiTab } from "./CiTab";

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
  version: 1,
};

const REPO: Repo = {
  id: "repo1",
  workspace_id: "ws1",
  owner: "acme",
  name: "payments-api",
  full_name: "acme/payments-api",
  default_branch: "main",
  clone_path: null,
  last_polled_at: null,
  created_by: null,
};

function installation(over: Partial<CiInstallation> = {}): CiInstallation {
  return {
    id: "inst1",
    agent_id: "ag1",
    agent_name: "Security Reviewer",
    repo: "acme/payments-api",
    target_type: "gha",
    installed_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    workflow_version: "1",
    pr_url: "https://github.com/acme/payments-api/pull/9",
    ci_fail_on: "critical",
    current: true,
    ...over,
  };
}

function run(over: Partial<CiRun> = {}): CiRun {
  return {
    id: "run1",
    ci_installation_id: "inst1",
    agent_id: "ag1",
    agent_name: "Security Reviewer",
    repo: "acme/payments-api",
    pr_number: 12,
    head_sha: "abc123",
    status: "recorded",
    verdict: "approved",
    unavailable_reason: null,
    findings_count: 2,
    critical: 0,
    warning: 1,
    suggestion: 1,
    cost_usd: 0.05,
    duration_ms: 4000,
    ran_at: "2026-08-20T00:00:00Z",
    job_url: "https://github.com/acme/payments-api/actions/runs/1",
    model: "gpt-4.1",
    manifest_version: 1,
    runner_build: "1",
    ...over,
  };
}

function mockApi({
  repos = [REPO],
  installations = [] as CiInstallation[],
  runs = [] as CiRun[],
}: { repos?: Repo[]; installations?: CiInstallation[]; runs?: CiRun[] } = {}) {
  get.mockImplementation((path: string) => {
    if (path === "/repos") return Promise.resolve(repos);
    if (path === "/agents/ag1/ci-installations") return Promise.resolve(installations);
    if (path === "/agents/ag1/ci-runs") return Promise.resolve(runs);
    throw new Error(`unexpected GET ${path}`);
  });
}

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ ci: ciMessages, common: commonMessages }}>
        <CiTab agent={AGENT} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CiTab — add-to-CI control (AC-1)", () => {
  it("opens the wizard at its target step", async () => {
    mockApi();
    renderTab();

    const button = await screen.findByRole("button", { name: "Export to CI" });
    // The button starts disabled until the repos query resolves — wait for
    // it to become enabled before clicking, or the click is a no-op on the
    // native disabled attribute.
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    // The target step's own copy — unique to step 0, proves the wizard did
    // not open on some other step.
    expect(await screen.findByText("Target repository")).toBeInTheDocument();
  });

  it("disables the control and states a repository must be imported first when there are none", async () => {
    mockApi({ repos: [] });
    renderTab();

    const button = await screen.findByRole("button", { name: "Export to CI" });
    expect(button).toBeDisabled();
    expect(await screen.findByText("Connect a repository first")).toBeInTheDocument();
  });
});

describe("CiTab — installation currency word (AC-9)", () => {
  it("a current installation renders the up-to-date word", async () => {
    mockApi({ installations: [installation({ id: "i-current", current: true, workflow_version: "1" })] });
    renderTab();

    expect(await screen.findByText("Up to date")).toBeInTheDocument();
    expect(screen.queryByText("Out of date")).not.toBeInTheDocument();
  });

  it("a non-current installation renders the out-of-date word", async () => {
    mockApi({ installations: [installation({ id: "i-stale", current: false, workflow_version: "1" })] });
    renderTab();

    expect(await screen.findByText("Out of date")).toBeInTheDocument();
    expect(screen.queryByText("Up to date")).not.toBeInTheDocument();
  });

  it("an installation recorded before workflow versions existed (workflow_version: null) renders the same out-of-date word", async () => {
    mockApi({
      installations: [installation({ id: "i-legacy", current: false, workflow_version: null })],
    });
    renderTab();

    expect(await screen.findByText("Out of date")).toBeInTheDocument();
  });
});

describe("CiTab — recent runs (AC-23)", () => {
  it("renders the agent's recent runs", async () => {
    mockApi({
      installations: [installation()],
      runs: [run({ id: "run-a" })],
    });
    renderTab();

    expect(await screen.findByText("Recent CI runs")).toBeInTheDocument();
    expect(screen.getByText("#12")).toBeInTheDocument();
  });

  it("renders no run section for an agent with installations but no runs", async () => {
    mockApi({ installations: [installation()], runs: [] });
    renderTab();

    await screen.findByText("acme/payments-api");
    expect(screen.queryByText("Recent CI runs")).not.toBeInTheDocument();
  });

  it("an installation with no runs recorded renders its own no-run-recorded line", async () => {
    mockApi({
      installations: [installation({ id: "i-no-runs" }), installation({ id: "i-with-run" })],
      runs: [run({ id: "run-a", ci_installation_id: "i-with-run" })],
    });
    renderTab();

    // The installation with a run does NOT show the "no run" line, the one
    // without a matching run does — asserted together so the test would fail
    // if every installation showed (or every installation hid) the line.
    expect(await screen.findByText("No CI run recorded yet.")).toBeInTheDocument();
    expect(screen.getAllByText("No CI run recorded yet.")).toHaveLength(1);
  });
});
