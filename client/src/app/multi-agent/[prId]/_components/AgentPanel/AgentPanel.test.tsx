import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AgentColumn, FindingRecord } from "@devdigest/shared";
import runsMessages from "../../../../../../messages/en/runs.json";
import prReviewMessages from "../../../../../../messages/en/prReview.json";
import evalMessages from "../../../../../../messages/en/eval.json";
import commonMessages from "../../../../../../messages/en/common.json";

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

import { AgentPanel } from "./AgentPanel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider
        locale="en"
        messages={{ runs: runsMessages, prReview: prReviewMessages, eval: evalMessages, common: commonMessages }}
      >
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("AgentPanel — per-column state text (AC-10)", () => {
  it('renders "Running" for a running column', () => {
    renderWithProviders(
      <AgentPanel column={column({ status: "running" })} prId="pr1" onViewTrace={() => {}} />,
    );
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it('renders "Done" for a done column', () => {
    renderWithProviders(
      <AgentPanel column={column({ status: "done" })} prId="pr1" onViewTrace={() => {}} />,
    );
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it('renders "Failed" for a failed column', () => {
    renderWithProviders(
      <AgentPanel column={column({ status: "failed", score: null, error: "boom" })} prId="pr1" onViewTrace={() => {}} />,
    );
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });
});

describe("AgentPanel — failure vs success isolation (AC-11)", () => {
  it("a failed column renders its error text", () => {
    renderWithProviders(
      <AgentPanel
        column={column({ status: "failed", score: null, error: "ANTHROPIC_API_KEY is not configured" })}
        prId="pr1"
        onViewTrace={() => {}}
      />,
    );
    expect(screen.getByText("ANTHROPIC_API_KEY is not configured")).toBeInTheDocument();
  });

  it("a done column still renders its findings and score, unchanged by a sibling's failure", () => {
    renderWithProviders(
      <AgentPanel
        column={column({ status: "done", score: 73, findings: [finding({ title: "Missing null check" })] })}
        prId="pr1"
        onViewTrace={() => {}}
      />,
    );
    expect(screen.getByText("73")).toBeInTheDocument();
    expect(screen.getByText("Missing null check")).toBeInTheDocument();
  });
});

describe("AgentPanel — figures rendered verbatim per column", () => {
  it("shows this column's own duration and cost, not any aggregate", () => {
    renderWithProviders(
      <AgentPanel column={column({ duration_ms: 8200, cost_usd: 0.05 })} prId="pr1" onViewTrace={() => {}} />,
    );
    expect(screen.getByText("8.2s")).toBeInTheDocument();
    expect(screen.getByText("$0.05")).toBeInTheDocument();
  });
});

describe("AgentPanel — findings use the promoted FindingCard (AC-17)", () => {
  it("an expanded finding inside the panel offers exactly the three FindingCard actions — no Learn or Reply to author", () => {
    renderWithProviders(
      <AgentPanel
        column={column({ findings: [finding({ title: "Missing null check" })] })}
        prId="pr1"
        onViewTrace={() => {}}
      />,
    );

    // AgentPanel doesn't pass defaultExpanded — expand the finding first.
    fireEvent.click(screen.getByText("Missing null check"));

    // Scope to the finding card itself (id="finding-<id>") so the panel
    // header's own "View trace" button, and the file:line MonoLink button
    // (AgentPanel doesn't pass repoFullName/headSha here, so it renders as a
    // <button>, not an <a>), can't be mistaken for a fourth action.
    const card = document.getElementById("finding-f1")!;
    const buttons = within(card).getAllByRole("button", {
      name: (name) => ["Accept", "Dismiss", "Turn into eval case"].includes(name),
    });
    expect(buttons.map((b) => b.textContent)).toEqual(["Accept", "Dismiss", "Turn into eval case"]);
    expect(within(card).queryByRole("button", { name: /learn/i })).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /reply to author/i })).not.toBeInTheDocument();
  });
});

describe("AgentPanel — no cross-agent merging (AC-15)", () => {
  it("two panels each carrying a finding with the SAME title at the SAME file:start_line render that title TWICE, once per agent's own panel", () => {
    const sharedFinding = finding({ id: "shared-1", title: "Hardcoded secret", file: "src/config.ts", start_line: 11, end_line: 11 });
    const columnA = column({ run_id: "run-a", agent_id: "agent-a", agent_name: "Security Reviewer", findings: [sharedFinding] });
    const columnB = column({ run_id: "run-b", agent_id: "agent-b", agent_name: "Perf Reviewer", findings: [sharedFinding] });

    renderWithProviders(
      <div>
        <AgentPanel column={columnA} prId="pr1" onViewTrace={() => {}} />
        <AgentPanel column={columnB} prId="pr1" onViewTrace={() => {}} />
      </div>,
    );

    // An implementation that merged/deduplicated identical findings across
    // panels would render this title once; the real per-column render must
    // show it twice, one inside each agent's own panel.
    expect(screen.getAllByText("Hardcoded secret")).toHaveLength(2);
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Perf Reviewer")).toBeInTheDocument();
  });
});
