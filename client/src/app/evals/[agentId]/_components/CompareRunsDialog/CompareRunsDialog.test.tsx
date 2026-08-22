import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import type { EvalComparison, EvalRunRecord } from "@devdigest/shared";
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

import { CompareRunsDialog } from "./CompareRunsDialog";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeRunRecord(overrides: Partial<EvalRunRecord> = {}): EvalRunRecord {
  return {
    id: "run-earlier",
    agent_id: "ag1",
    started_at: "2026-08-20T10:00:00Z",
    state: "completed",
    recall: 0.7,
    precision: 0.6,
    citation_accuracy: 0.5,
    traces_passed: 3,
    traces_total: 5,
    errored_count: 0,
    cost_usd: 0.04,
    duration_ms: 9000,
    delta: null,
    ...overrides,
  };
}

const EARLIER = makeRunRecord({ id: "run-earlier", started_at: "2026-08-20T10:00:00Z", recall: 0.7, precision: 0.6, citation_accuracy: 0.5, cost_usd: 0.04 });
const LATER = makeRunRecord({ id: "run-later", started_at: "2026-08-22T10:00:00Z", recall: 0.85, precision: 0.55, citation_accuracy: 0.5, cost_usd: 0.03 });

function makeComparison(overrides: Partial<EvalComparison> = {}): EvalComparison {
  return {
    earlier: EARLIER,
    later: LATER,
    metrics: [
      { key: "recall", earlier: 0.7, later: 0.85, delta: 0.15 },
      { key: "precision", earlier: 0.6, later: 0.55, delta: -0.05 },
      { key: "citation_accuracy", earlier: 0.5, later: 0.5, delta: 0 },
      { key: "cost_usd", earlier: 0.04, later: 0.03, delta: -0.01 },
    ],
    prompt_diff: [
      { kind: "same", text: "You are a code reviewer." },
      { kind: "removed", text: "Flag anything suspicious." },
      { kind: "added", text: "Flag only findings grounded in the diff." },
    ],
    case_sets_differ: false,
    earlier_case_count: 8,
    later_case_count: 8,
    context_differs: false,
    ...overrides,
  };
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function mockComparison(comparison: EvalComparison) {
  get.mockImplementation((path: string) => {
    if (path.includes("/eval-compare")) return Promise.resolve(comparison);
    throw new Error(`unexpected GET ${path}`);
  });
}

function renderDialog(props: { runIdA: string; runIdB: string; onClose?: () => void }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = props.onClose ?? vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, common: commonMessages }}>
        <CompareRunsDialog agentId="ag1" runIdA={props.runIdA} runIdB={props.runIdB} onClose={onClose} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { ...utils, onClose };
}

describe("CompareRunsDialog", () => {
  it("renders the two runs earlier-first even when selected later-first, with both values and the difference for all four metrics (AC-40)", async () => {
    mockComparison(makeComparison());
    // Selected later-first: the caller passed the LATER run's id as `runIdA`.
    renderDialog({ runIdA: LATER.id, runIdB: EARLIER.id });

    await waitFor(() =>
      expect(screen.getByText(`${formatWhen(EARLIER.started_at)} → ${formatWhen(LATER.started_at)}`)).toBeInTheDocument(),
    );

    // recall: 70% → 85%, up 15pts
    expect(screen.getByText("70%")).toBeInTheDocument();
    expect(screen.getByText("85%")).toBeInTheDocument();
    expect(screen.getByText("up 15pts")).toBeInTheDocument();

    // precision: 60% → 55%, down 5pts
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("55%")).toBeInTheDocument();
    expect(screen.getByText("down 5pts")).toBeInTheDocument();

    // citation accuracy: 50% → 50%, up 0pts (delta >= 0)
    expect(screen.getAllByText("50%")).toHaveLength(2);
    expect(screen.getByText("up 0pts")).toBeInTheDocument();

    // cost: $0.04 → $0.03, down $0.01
    expect(screen.getByText("$0.04")).toBeInTheDocument();
    expect(screen.getByText("$0.03")).toBeInTheDocument();
    expect(screen.getByText("down $0.01")).toBeInTheDocument();
  });

  it("renders the prompt diff with added and removed lines carrying a text marker (AC-41)", async () => {
    mockComparison(makeComparison());
    renderDialog({ runIdA: EARLIER.id, runIdB: LATER.id });

    expect(await screen.findByText(/Flag anything suspicious\./)).toHaveTextContent("- Flag anything suspicious.");
    expect(screen.getByText(/Flag only findings grounded/)).toHaveTextContent(
      "+ Flag only findings grounded in the diff.",
    );
    expect(screen.getByText(/You are a code reviewer\./)).toHaveTextContent("You are a code reviewer.");
  });

  it("renders dashboard.caseSetsDiffer with both counts, and omits it when the sets match (AC-42)", async () => {
    mockComparison(makeComparison({ case_sets_differ: true, earlier_case_count: 6, later_case_count: 9 }));
    renderDialog({ runIdA: EARLIER.id, runIdB: LATER.id });

    expect(
      await screen.findByText("These runs evaluated different case sets — 6 cases and 9 cases."),
    ).toBeInTheDocument();

    cleanup();
    vi.clearAllMocks();
    mockComparison(makeComparison({ case_sets_differ: false }));
    renderDialog({ runIdA: EARLIER.id, runIdB: LATER.id });

    await screen.findByText("Compare runs");
    expect(screen.queryByText(/different case sets/)).not.toBeInTheDocument();
  });

  it("renders dashboard.contextDiffers, and omits it when false (AC-54)", async () => {
    mockComparison(makeComparison({ context_differs: true }));
    renderDialog({ runIdA: EARLIER.id, runIdB: LATER.id });

    expect(await screen.findByText("These runs used different project context.")).toBeInTheDocument();

    cleanup();
    vi.clearAllMocks();
    mockComparison(makeComparison({ context_differs: false }));
    renderDialog({ runIdA: EARLIER.id, runIdB: LATER.id });

    await screen.findByText("Compare runs");
    expect(screen.queryByText("These runs used different project context.")).not.toBeInTheDocument();
  });

  it("confines focus while open and returns it to the opener on close (AC-43, AC-44)", async () => {
    mockComparison(makeComparison());

    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Opener
          </button>
          {open && <CompareRunsDialog agentId="ag1" runIdA={EARLIER.id} runIdB={LATER.id} onClose={() => setOpen(false)} />}
        </>
      );
    }

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, common: commonMessages }}>
          <Harness />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );

    const opener = screen.getByRole("button", { name: "Opener" });
    opener.focus();
    expect(document.activeElement).toBe(opener);

    fireEvent.click(opener);
    await waitFor(() => expect(document.activeElement).not.toBe(opener));
    expect(document.activeElement).toHaveAttribute("aria-label", "Close");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
