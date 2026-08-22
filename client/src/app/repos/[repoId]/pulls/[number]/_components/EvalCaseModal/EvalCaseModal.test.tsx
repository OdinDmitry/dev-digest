import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EvalCaseDraft } from "@devdigest/shared";
import evalMessages from "../../../../../../../../messages/en/eval.json";

// `EvalCaseModal` talks to the API only through `useEvalCaseDraft`/`useCreateEvalCase`
// (`hooks/eval.ts`), which both go through the shared `api` client — mocking that one
// module lets the real hooks (and their real mutation/query lifecycle) run, matching
// `BriefCard.test.tsx`'s pattern rather than mocking the hooks themselves.
const get = vi.fn();
const post = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    get: (p: string) => get(p),
    post: (p: string, b?: unknown) => post(p, b),
    put: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  },
  API_BASE: "http://localhost:3001",
}));

import { ApiError } from "@/lib/api";
import { EvalCaseModal } from "./EvalCaseModal";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const BASE_DRAFT: EvalCaseDraft = {
  finding_id: "f1",
  agent_id: "a1",
  agent_name: "Security Reviewer",
  suggested_name: "stripe-key-leak",
  file: "src/config.ts",
  start_line: 10,
  end_line: 12,
  fragment:
    'diff --git a/src/config.ts b/src/config.ts\n--- a/src/config.ts\n+++ b/src/config.ts\n@@ -10,3 +10,3 @@\n+  stripeKey: "sk_live_...",',
  // The expectation type is derived server-side, never chosen (AC-40); this
  // field replaces SPEC-03's `default_expectation_kind`.
  expectation_kind: null,
  existing_case: null,
};

function mockDraft(draft: EvalCaseDraft) {
  get.mockImplementation((path: string) =>
    path === `/findings/${draft.finding_id}/eval-case-draft`
      ? Promise.resolve(draft)
      : Promise.reject(new Error(`unexpected GET ${path}`)),
  );
}

function renderModal(findingId = "f1", onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
        <EvalCaseModal findingId={findingId} onClose={onClose} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { onClose };
}

describe("EvalCaseModal", () => {
  it("eval_case_modal_states_the_derived_expectation", async () => {
    // Accepted finding → the form states "Must find", with no control that
    // could change it (AC-40): no radiogroup, no radio at all.
    mockDraft({ ...BASE_DRAFT, expectation_kind: "must_find" });
    renderModal();
    expect(await screen.findByText(/Must find — the agent should flag this/)).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.queryByText(/Must not flag/)).not.toBeInTheDocument();
    cleanup();
    vi.clearAllMocks();

    // Dismissed finding → the form states "Must not flag" instead, still with
    // no control offering a choice.
    mockDraft({ ...BASE_DRAFT, expectation_kind: "must_not_flag" });
    renderModal();
    expect(await screen.findByText(/Must not flag — this is not a real issue/)).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.queryByText(/Must find/)).not.toBeInTheDocument();
  });

  it("shows the existing case instead of the form when the finding already has one", async () => {
    mockDraft({
      ...BASE_DRAFT,
      existing_case: {
        id: "case1",
        agent_id: "a1",
        name: "existing-stripe-case",
        source_finding_id: "f1",
        file: "src/config.ts",
        start_line: 10,
        end_line: 12,
        fragment: BASE_DRAFT.fragment,
        expectations: [
          { id: "e1", kind: "must_find", file: "src/config.ts", start_line: 10, end_line: 12 },
        ],
        created_at: "2026-08-20T10:00:00.000Z",
        severity: "high",
        category: "security",
        latest_result: null,
      },
    });
    renderModal();

    expect(await screen.findByText("existing-stripe-case")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create eval case" })).not.toBeInTheDocument();
  });

  it("eval_case_modal_reopen_reflects_a_decision_that_changed_while_closed", async () => {
    // Same QueryClient across both opens — mirrors the real app, where
    // `FindingsPanel`'s `{evalCaseFindingId && <EvalCaseModal .../>}` fully
    // unmounts/remounts the modal but the query cache (default 5 min
    // `gcTime`, no override) survives the round trip.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const open = () =>
      render(
        <QueryClientProvider client={qc}>
          <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
            <EvalCaseModal findingId="f1" onClose={vi.fn()} />
          </NextIntlClientProvider>
        </QueryClientProvider>,
      );

    // First open: the finding is accepted → the form states "Must find".
    mockDraft({ ...BASE_DRAFT, expectation_kind: "must_find" });
    const first = open();
    expect(await screen.findByText(/Must find — the agent should flag this/)).toBeInTheDocument();

    // User closes the modal — `FindingsPanel` unmounts it entirely
    // (`{evalCaseFindingId && <EvalCaseModal .../>}`).
    first.unmount();

    // …then dismisses the same finding (accepted → dismissed) before
    // reopening the form for it.
    mockDraft({ ...BASE_DRAFT, expectation_kind: "must_not_flag" });

    // Reopen on the SAME finding — the query refetches, and the statement
    // must reflect the FRESH decision. Unlike SPEC-03's radio pre-selection,
    // the expectation is read straight off `draft.expectation_kind` on every
    // render rather than mirrored into local state, so there is no seeding
    // effect that could go stale here.
    open();
    await waitFor(() =>
      expect(screen.getByText(/Must not flag — this is not a real issue/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Must find —/)).not.toBeInTheDocument();
  });

  it("renders the reason when the fragment cannot be cut", async () => {
    get.mockImplementation(() => Promise.reject(new ApiError("No hunk of this file's patch intersects the finding's line range.", 422)));
    renderModal();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No hunk of this file's patch intersects the finding's line range.",
    );
  });
});
