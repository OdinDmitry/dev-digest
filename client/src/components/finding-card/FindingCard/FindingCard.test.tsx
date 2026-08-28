import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FindingRecord, EvalCaseSeed } from "@devdigest/shared";
import messages from "../../../../messages/en/prReview.json";
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

import { FindingCard } from "./FindingCard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

const SEED: EvalCaseSeed = {
  agent_id: "ag-real",
  agent_name: "Test Quality Reviewer",
  repo_id: "repo1",
  repo_full_name: "acme/widgets",
  name: "seeded-from-finding",
  input_diff: "--- a/src/config.ts\n+++ b/src/config.ts\n@@\n+  stripeKey: 'sk_live_...'",
  expectations: [
    {
      kind: "must_find",
      file: "src/config.ts",
      start_line: 11,
      end_line: 11,
      title: "Hardcoded Stripe secret key",
      severity: null,
      category: null,
    },
  ],
  origin: { finding_id: "f1", pr_id: "pr1", pr_number: 42, finding_title: FINDING.title },
  existing_case_id: null,
};

function renderWithIntl(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider
        locale="en"
        messages={{ prReview: messages, eval: evalMessages, common: commonMessages }}
      >
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function mockSeedGet() {
  get.mockImplementation((path: string) => {
    if (path.includes("/eval-case-seed")) return Promise.resolve(SEED);
    if (path === "/repos") return Promise.resolve([]);
    throw new Error(`unexpected GET ${path}`);
  });
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });

  it("renders exactly three action buttons — Accept, Dismiss, Turn into eval case — and no Learn or Reply to author control (AC-17)", () => {
    // repoFullName + headSha turn the file:line MonoLink into a real <a>
    // (not a <button>, per client/insights.md's MonoLink note) so the only
    // buttons left in the DOM are the three action buttons themselves.
    renderWithIntl(
      <FindingCard
        f={FINDING}
        defaultExpanded
        onAction={() => {}}
        repoFullName="acme/widgets"
        headSha="a1b2c3d4"
      />,
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);
    expect(buttons.map((b) => b.textContent)).toEqual(["Accept", "Dismiss", "Turn into eval case"]);

    expect(screen.queryByRole("button", { name: /learn/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reply to author/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/reply to author/i)).not.toBeInTheDocument();
  });
});

describe("FindingCard — turn into eval case (SPEC-03 AC-1/AC-2/AC-44)", () => {
  it("disables the control when the finding carries neither an accepted nor a dismissed timestamp", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={() => {}} />);

    expect(screen.getByRole("button", { name: "Turn into eval case" })).toBeDisabled();
  });

  it("an accepted finding's control opens the dialog, prefilled from the mocked seed response", async () => {
    mockSeedGet();
    const accepted: FindingRecord = { ...FINDING, accepted_at: "2026-08-20T00:00:00Z" };
    renderWithIntl(<FindingCard f={accepted} defaultExpanded onAction={() => {}} />);

    const control = screen.getByRole("button", { name: "Turn into eval case" });
    expect(control).not.toBeDisabled();
    fireEvent.click(control);

    // Verifies the "known implementation smell" (agentId="" on the
    // from-finding path) really is inert: the dialog still loads and
    // prefills from the seed despite the empty agentId prop.
    expect(await screen.findByDisplayValue(SEED.name)).toBeInTheDocument();
    // Multi-line, exact value — getByDisplayValue's default normalizer
    // collapses whitespace (including newlines), so it's checked directly
    // against the raw textarea instead. Dialog is portaled to document.body.
    const diffTextarea = document.body.querySelectorAll("textarea")[0];
    expect(diffTextarea).toHaveValue(SEED.input_diff);
    // AC-46: from-finding association is fixed — no repository field at all.
    expect(document.body.querySelector("select")).toBeNull();
    expect(screen.queryByText(/Repository/i)).not.toBeInTheDocument();
  });

  it("a dismissed finding's control opens the dialog, prefilled from the mocked seed response", async () => {
    mockSeedGet();
    const dismissed: FindingRecord = { ...FINDING, dismissed_at: "2026-08-20T00:00:00Z" };
    renderWithIntl(<FindingCard f={dismissed} defaultExpanded onAction={() => {}} />);

    const control = screen.getByRole("button", { name: "Turn into eval case" });
    expect(control).not.toBeDisabled();
    fireEvent.click(control);

    expect(await screen.findByDisplayValue(SEED.name)).toBeInTheDocument();
  });

  it("closing the dialog returns focus to the control that opened it", async () => {
    mockSeedGet();
    const accepted: FindingRecord = { ...FINDING, accepted_at: "2026-08-20T00:00:00Z" };
    renderWithIntl(<FindingCard f={accepted} defaultExpanded onAction={() => {}} />);

    const control = screen.getByRole("button", { name: "Turn into eval case" });
    control.focus();
    fireEvent.click(control);
    await screen.findByDisplayValue(SEED.name);

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(document.activeElement).toBe(control));
  });
});
