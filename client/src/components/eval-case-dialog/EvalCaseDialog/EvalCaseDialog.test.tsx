import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import type { EvalCase, EvalExpectation } from "@devdigest/shared";
import evalMessages from "../../../../messages/en/eval.json";
import commonMessages from "../../../../messages/en/common.json";

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    get: (p: string) => get(p),
    post: (p: string, body?: unknown) => post(p, body),
    put: (p: string, body?: unknown) => put(p, body),
    patch: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class extends Error {},
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

/** The two `<textarea>`s always in DOM order: [diff input, expected-output editor]. */
function editorTextarea(container: HTMLElement): HTMLTextAreaElement {
  const textareas = container.querySelectorAll("textarea");
  return textareas[1] as HTMLTextAreaElement;
}

describe("EvalCaseDialog", () => {
  it("projects [] into the editor for a negative case, with its stored zones listed read-only beside it, and states the forbidden zone in the banner", async () => {
    get.mockResolvedValue([]);
    const caseRecord = makeCase({ expectations: NEGATIVE_EXPECTATIONS, polarity: "must_not_flag" });
    const { container } = renderDialog({ mode: "edit", caseRecord });

    // AC-7: the editor itself shows a fixed [] projection, read-only.
    const editor = editorTextarea(container);
    expect(editor).toHaveValue("[]");
    expect(editor).toHaveAttribute("readonly");

    // AC-10: the real stored forbidden zones render read-only beside it.
    expect(screen.getByText("src/db/pool.ts:4-9")).toBeInTheDocument();
    expect(screen.getByText("src/db/pool.ts:20-25")).toBeInTheDocument();

    // AC-48 (negative variant): banner names the forbidden zone.
    expect(
      screen.getByText("NEGATIVE CASE — MUST NOT flag src/db/pool.ts:4"),
    ).toBeInTheDocument();
  });

  it("states the finding, file and line in the banner for a positive case", async () => {
    get.mockResolvedValue([]);
    const caseRecord = makeCase();
    renderDialog({ mode: "edit", caseRecord });

    expect(
      screen.getByText('POSITIVE CASE — MUST find "Hardcoded Stripe secret key" at src/config.ts:11'),
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

  it("rejects a mixed-kind expected-output list on a positive case and sends no request", async () => {
    get.mockResolvedValue([]);
    const caseRecord = makeCase();
    const { container } = renderDialog({ mode: "edit", caseRecord });

    const editor = editorTextarea(container);
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
    const { container } = renderDialog({ mode: "edit", caseRecord });

    const editor = editorTextarea(container);
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
    const { container } = renderDialog({ mode: "new", agentId: "ag7", onClose });

    // Empty dialog: no name, no diff prefilled.
    expect(screen.getByPlaceholderText("stripe-key-leak")).toHaveValue("");
    const diffTextarea = container.querySelectorAll("textarea")[0] as HTMLTextAreaElement;
    expect(diffTextarea).toHaveValue("");

    fireEvent.change(screen.getByPlaceholderText("stripe-key-leak"), {
      target: { value: "new-case-name" },
    });
    const editor = editorTextarea(container);
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
    const [path] = post.mock.calls[0] as [string, unknown];
    expect(path).toBe("/agents/ag7/eval-cases");
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
