import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/runs.json"; // apps/web/messages/en/runs.json

// Mock the trace hooks so the drawer renders without a query client / SSE.
const TRACE: RunTrace = {
  config: { agent: "Security", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
  stats: { duration_ms: 8200, tokens_in: 12000, tokens_out: 1500, cost_usd: 0.06, findings: 2, grounding: "2/2 passed" },
  prompt_assembly: { system: "You are a reviewer.", skills: "### skill", memory: null, specs: null, user: "Review PR #482" },
  tool_calls: [{ tool: "review_file", args: "src/config.ts", meta: "single-pass", ms: 1200 }],
  raw_output: '{"verdict":"request_changes"}',
  memory_pulled: [{ pr: 471, text: "rate-limit public endpoints" }],
  specs_read: [],
  // Required since docs/plans/2026-08-16-project-context-run-injection.md
  // (U1/U2) added `specs_excluded` to the RunTrace contract with a Zod
  // `.default([])` — that makes the field REQUIRED in z.infer's output type,
  // so a hand-built literal (never run through `.parse()`) must supply it or
  // TraceBody.tsx's `trace.specs_excluded.length` throws at render time
  // (client/insights.md 2026-08-17).
  specs_excluded: [],
  log: [
    { t: "00.10", kind: "info", msg: "Starting review with agent Security" },
    { t: "00.90", kind: "result", msg: "Citation grounding: 2/2 passed" },
  ],
};

/** A trace carrying a project-context prompt block plus two excluded
 *  attachments — the fixture for the U15 project-context assertions below.
 *  Held in a mutable variable so the single `useRunTrace` mock can serve a
 *  different trace per test without re-mocking the module. */
let mockedTrace: RunTrace = TRACE;

vi.mock("../../../../../../../lib/hooks/trace", () => ({
  useRunTrace: () => ({ data: mockedTrace, isLoading: false }),
}));
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useRunEvents: () => ({ events: [], running: false }),
}));

import RunTraceDrawer from "./RunTraceDrawer";

afterEach(() => {
  cleanup();
  mockedTrace = TRACE;
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <div data-theme="dark">{ui}</div>
    </NextIntlClientProvider>,
  );
}

describe("A5 Run Trace drawer (smoke)", () => {
  it("renders the trace tabs and stats", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Stats")).toBeInTheDocument();
    expect(screen.getByText("2/2 passed")).toBeInTheDocument();
    expect(screen.getByText("Tool calls")).toBeInTheDocument();
  });

  it("switches to the live log tab", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    fireEvent.click(screen.getByText("log"));
    // LiveLogStream renders its filter input
    expect(screen.getByPlaceholderText("Filter log…")).toBeInTheDocument();
  });
});

describe("A5 Run Trace drawer — project context (U8, run injection plan)", () => {
  it("lists each excluded attachment with its reason, and labels the project-context prompt segment as attached + untrusted", () => {
    // AC-28 (view side). fireEvent, not user-event — not an installed
    // dependency in this package (client/insights.md 2026-08-08).
    mockedTrace = {
      ...TRACE,
      prompt_assembly: {
        ...TRACE.prompt_assembly,
        specs:
          '<untrusted source="project-context">\n' +
          '### docs/security-baseline.md\nDISTINCTIVE-PROJECT-CONTEXT-TEXT\n' +
          '</untrusted>',
      },
      specs_read: ["docs/security-baseline.md"],
      specs_excluded: [
        { path: "docs/architecture.md", reason: "over_budget" },
        { path: "docs/removed-doc.md", reason: "absent" },
      ],
    };
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);

    // Configuration section (open by default) lists each excluded document's
    // path next to its human-readable reason label.
    expect(screen.getByText("docs/architecture.md — over token budget")).toBeInTheDocument();
    expect(screen.getByText("docs/removed-doc.md — absent from working copy")).toBeInTheDocument();

    // Prompt assembly is collapsed by default — expand it to reach the
    // project-context segment's label.
    fireEvent.click(screen.getByText("Prompt assembly"));
    expect(
      screen.getByText("Project context — attached specs (untrusted)"),
    ).toBeInTheDocument();
  });

  it("renders a legacy trace document that predates specs_excluded", () => {
    // Every `run_traces` row written before this feature is a jsonb document
    // with NO `specs_excluded` key. The server now applies the contract's
    // `.default([])` on read, but the client casts rather than parses, so the
    // drawer must survive the field being absent regardless. The cast models
    // exactly that payload — a fixture that supplies the key cannot catch this.
    const { specs_excluded: _dropped, ...legacy } = TRACE;
    mockedTrace = legacy as RunTrace;
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Project context — excluded")).toBeInTheDocument();
  });
});
