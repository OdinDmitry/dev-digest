import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import type { EvalCase, EvalExpectation } from "@devdigest/shared";
import evalMessages from "../../../../messages/en/eval.json";
import commonMessages from "../../../../messages/en/common.json";

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();

const { MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, code?: string) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.code = code;
    }
  }
  return { MockApiError };
});

vi.mock("@/lib/api", () => ({
  api: {
    get: (p: string) => get(p),
    post: (p: string, body?: unknown) => post(p, body),
    put: (p: string, body?: unknown) => put(p, body),
    patch: vi.fn(),
    del: vi.fn(),
  },
  ApiError: MockApiError,
  API_BASE: "http://localhost:3001",
}));

import { EvalCaseDialog, type EvalCaseDialogProps } from "./EvalCaseDialog";

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

const NEGATIVE_EXPECTATIONS: EvalExpectation[] = [
  {
    kind: "must_not_flag",
    file: "src/db/pool.ts",
    start_line: 4,
    end_line: 9,
    title: null,
    severity: null,
    category: null,
  },
  {
    kind: "must_not_flag",
    file: "src/db/pool.ts",
    start_line: 20,
    end_line: 25,
    title: null,
    severity: null,
    category: null,
  },
];

function makeCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    id: "case1",
    owner_kind: "agent",
    owner_id: "ag1",
    name: "stripe-key-leak",
    input_diff: "--- a/src/config.ts\n+++ b/src/config.ts\n@@\n+  stripeKey: 'sk_live_...'",
    repo_id: null,
    repo_full_name: null,
    expectations: [POSITIVE_EXPECTATION],
    polarity: "must_find",
    origin: null,
    notes: null,
    resolves_context: false,
    last_outcome: null,
    created_at: "2026-08-20T00:00:00Z",
    updated_at: "2026-08-20T00:00:00Z",
    ...overrides,
  };
}

function renderDialog(props: Partial<EvalCaseDialogProps> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = props.onClose ?? vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, common: commonMessages }}>
        <EvalCaseDialog mode="new" agentId="ag1" onClose={onClose} {...props} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { ...utils, onClose };
}

/** The two `<textarea>`s always in DOM order: [diff input, expected-output editor].
 *  Queried from `document.body` because the dialog is portaled out of the
 *  render container (escapes FindingCard's muted opacity stacking context). */
function editorTextarea(): HTMLTextAreaElement {
  const textareas = document.body.querySelectorAll("textarea");
  return textareas[1] as HTMLTextAreaElement;
}

describe("EvalCaseDialog", () => {
  it("projects [] into the editor for a negative case, with its stored zones listed read-only beside it, and states the forbidden zone in the banner", async () => {
    get.mockResolvedValue([]);
    const caseRecord = makeCase({ expectations: NEGATIVE_EXPECTATIONS, polarity: "must_not_flag" });
    renderDialog({ mode: "edit", caseRecord });

    // AC-7: the editor itself shows a fixed [] projection, read-only.
    const editor = editorTextarea();
    expect(editor).toHaveValue("[]");
    expect(editor).toHaveAttribute("readonly");

    // AC-10: the real stored forbidden zones render read-only beside it.
    expect(screen.getByText("src/db/pool.ts:4-9")).toBeInTheDocument();
    expect(screen.getByText("src/db/pool.ts:20-25")).toBeInTheDocument();

    // AC-48 (negative variant): two-line banner — label + body naming the zone.
    expect(screen.getByText("NEGATIVE CASE")).toBeInTheDocument();
    expect(screen.getByText("MUST NOT flag src/db/pool.ts:4")).toBeInTheDocument();
  });

  it("states the finding, file and line in the banner for a positive case", async () => {
    get.mockResolvedValue([]);
    const caseRecord = makeCase();
    renderDialog({ mode: "edit", caseRecord });

    expect(screen.getByText("POSITIVE CASE")).toBeInTheDocument();
    expect(
      screen.getByText('MUST find "Hardcoded Stripe secret key" at src/config.ts:11'),
    ).toBeInTheDocument();
  });

  it("saving a negative case unchanged sends expectations: [] to the API", async () => {
    get.mockResolvedValue([]);
    put.mockResolvedValue(makeCase({ expectations: NEGATIVE_EXPECTATIONS, polarity: "must_not_flag" }));
    const caseRecord = makeCase({ expectations: NEGATIVE_EXPECTATIONS, polarity: "must_not_flag" });
    const onClose = vi.fn();
    renderDialog({ mode: "edit", caseRecord, onClose });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // Await something that only appears after the mutation resolves before
    // inspecting the mock (client/insights.md 2026-08-18).
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    expect(put).toHaveBeenCalledTimes(1);
    const [, body] = put.mock.calls[0] as [string, { expectations: unknown }];
    expect(body.expectations).toEqual([]);
  });

  it("creating a negative case from a finding sends the canonical must_not_flag zones, not []", async () => {
    const seed = {
      agent_id: "ag1",
      agent_name: "Agent",
      repo_id: "repo1",
      repo_full_name: "acme/widgets",
      name: "dismissed-finding",
      input_diff: "--- a/x\n+++ b/x",
      expectations: NEGATIVE_EXPECTATIONS,
      origin: {
        finding_id: "f1",
        pr_id: "pr1",
        pr_number: 1,
        finding_title: "dismissed-finding",
      },
      existing_case_id: null,
    };
    get.mockImplementation((path: string) => {
      if (path.includes("/eval-case-seed")) return Promise.resolve(seed);
      if (path === "/repos") return Promise.resolve([]);
      throw new Error(`unexpected GET ${path}`);
    });
    post.mockResolvedValue(
      makeCase({
        id: "new-neg",
        name: seed.name,
        expectations: NEGATIVE_EXPECTATIONS,
        polarity: "must_not_flag",
      }),
    );
    const onClose = vi.fn();
    renderDialog({ mode: "from-finding", findingId: "f1", onClose });

    expect(await screen.findByDisplayValue(seed.name)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledTimes(1);
    const [path, body] = post.mock.calls[0] as [string, { expectations: unknown }];
    expect(path).toBe("/findings/f1/eval-case");
    expect(body.expectations).toEqual(NEGATIVE_EXPECTATIONS);
  });

  it("a 409 from create-from-finding shows an inline already-exists message and keeps the dialog open", async () => {
    const seed = {
      agent_id: "ag1",
      agent_name: "Agent",
      repo_id: "repo1",
      repo_full_name: "acme/widgets",
      name: "already-there",
      input_diff: "--- a/x\n+++ b/x",
      expectations: [POSITIVE_EXPECTATION],
      origin: {
        finding_id: "f1",
        pr_id: "pr1",
        pr_number: 1,
        finding_title: "already-there",
      },
      existing_case_id: null,
    };
    get.mockImplementation((path: string) => {
      if (path.includes("/eval-case-seed")) return Promise.resolve(seed);
      if (path === "/repos") return Promise.resolve([]);
      throw new Error(`unexpected GET ${path}`);
    });
    post.mockRejectedValue(
      new MockApiError("An eval case already exists for this finding", 409, "eval_case_exists"),
    );
    const onClose = vi.fn();
    renderDialog({ mode: "from-finding", findingId: "f1", onClose });

    expect(await screen.findByDisplayValue(seed.name)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText(
        "An eval case already exists for this finding. Edit it from the agent's Evals tab.",
      ),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("rejects a mixed-kind expected-output list on a positive case and sends no request", async () => {
    get.mockResolvedValue([]);
    const caseRecord = makeCase();
    renderDialog({ mode: "edit", caseRecord });

    const editor = editorTextarea();
    fireEvent.change(editor, {
      target: {
        value: JSON.stringify([
          { kind: "must_find", file: "a.ts", start_line: 1, end_line: 2 },
          { kind: "must_not_flag", file: "b.ts", start_line: 3, end_line: 4 },
        ]),
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText(
        "Expected output must be a non-empty list of expectations of one kind, each with a file, a start line and an end line.",
      ),
    ).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it("rejects an empty expected-output list on a positive case and sends no request", async () => {
    get.mockResolvedValue([]);
    const caseRecord = makeCase();
    renderDialog({ mode: "edit", caseRecord });

    const editor = editorTextarea();
    fireEvent.change(editor, { target: { value: "[]" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText(
        "Expected output must be a non-empty list of expectations of one kind, each with a file, a start line and an end line.",
      ),
    ).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it("opening from the Evals tab's new-case control renders an empty dialog and saves it owned by that agent", async () => {
    get.mockResolvedValue([]);
    post.mockResolvedValue(makeCase({ id: "new-case", owner_id: "ag7" }));
    const onClose = vi.fn();
    renderDialog({ mode: "new", agentId: "ag7", onClose });

    // Empty dialog: no name, no diff prefilled.
    expect(screen.getByPlaceholderText("stripe-key-leak")).toHaveValue("");
    const diffTextarea = document.body.querySelectorAll("textarea")[0] as HTMLTextAreaElement;
    expect(diffTextarea).toHaveValue("");

    fireEvent.change(screen.getByPlaceholderText("stripe-key-leak"), {
      target: { value: "new-case-name" },
    });
    const editor = editorTextarea();
    fireEvent.change(editor, {
      target: {
        value: JSON.stringify([
          { kind: "must_find", file: "src/x.ts", start_line: 1, end_line: 2 },
        ]),
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledTimes(1);
    const [path, body] = post.mock.calls[0] as [string, { repo_id: unknown }];
    expect(path).toBe("/agents/ag7/eval-cases");
    expect(body.repo_id).toBeNull();
  });

  it("shows Actual output as Never run yet and disables Run case until the case is saved (edit)", async () => {
    get.mockResolvedValue([]);
    renderDialog({ mode: "new", agentId: "ag1" });

    expect(screen.getByText("Actual output")).toBeInTheDocument();
    const actual = Array.from(document.body.querySelectorAll("textarea")).find(
      (el) => (el as HTMLTextAreaElement).value === "Never run yet",
    );
    expect(actual).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run case" })).toBeDisabled();
  });

  it("Run case on an edited case posts a preview and fills Actual output", async () => {
    get.mockResolvedValue([]);
    const caseRecord = makeCase({ last_outcome: null });
    post.mockResolvedValue({
      case_id: caseRecord.id,
      stored: false,
      result: {
        case_id: caseRecord.id,
        name: caseRecord.name,
        status: "passed",
        pass: true,
        errored: false,
        error: null,
        findings: [
          {
            id: "f-preview",
            severity: "CRITICAL",
            category: "security",
            title: "Hardcoded Stripe secret key",
            file: "src/config.ts",
            start_line: 11,
            end_line: 11,
            rationale: "x",
            suggestion: null,
            confidence: 0.9,
            kind: "finding",
            trifecta_components: null,
            evidence: null,
          },
        ],
        raw_findings_count: 1,
        expected_count: 1,
        matched_count: 1,
        cost_usd: 0.01,
        duration_ms: 100,
        stored: false,
      },
    });
    renderDialog({ mode: "edit", caseRecord });

    expect(screen.getByRole("button", { name: "Run case" })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Run case" }));

    await waitFor(() =>
      expect(post.mock.calls.some((c) => c[0] === `/eval-cases/${caseRecord.id}/preview`)).toBe(true),
    );
    await waitFor(() =>
      expect(
        Array.from(document.body.querySelectorAll("textarea")).some((el) =>
          (el as HTMLTextAreaElement).value.includes("passed · expected 1, got 1"),
        ),
      ).toBe(true),
    );
    expect(screen.getByText("Preview — not stored")).toBeInTheDocument();
  });

  it("confines focus while open and returns it to the opener on close", async () => {
    get.mockResolvedValue([]);

    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Opener
          </button>
          {open && <EvalCaseDialog mode="new" agentId="ag1" onClose={() => setOpen(false)} />}
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

    // Opening (from the still-focused opener, mirroring a real click) mounts
    // the dialog; its trap effect captures the opener as "previously
    // focused" and moves focus onto the first focusable node — the Modal
    // header's own Close button.
    fireEvent.click(opener);
    await waitFor(() => expect(document.activeElement).not.toBe(opener));
    expect(document.activeElement).toHaveAttribute("aria-label", "Close");

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
