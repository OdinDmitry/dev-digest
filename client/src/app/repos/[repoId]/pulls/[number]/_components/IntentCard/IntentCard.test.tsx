import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BriefEnvelope, BriefRisk, PrIntentRecord } from "@devdigest/shared";
import briefMessages from "../../../../../../../../messages/en/brief.json";

const get = vi.fn();
const post = vi.fn();
vi.mock("@/lib/api", () => ({
  api: { get: (p: string) => get(p), post: (p: string) => post(p), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
  API_BASE: "http://localhost:3001",
}));

import { IntentCard } from "./IntentCard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const INTENT: PrIntentRecord = {
  pr_id: "pr1",
  intent: "Adds token-bucket rate limiting to the public API endpoints.",
  in_scope: ["public API rate limiting"],
  out_of_scope: ["authentication changes"],
};

function risk(title: string, severity: BriefRisk["severity"], overrides: Partial<BriefRisk> = {}): BriefRisk {
  return {
    kind: "security",
    title,
    explanation: `Explanation for ${title}.`,
    severity,
    refs: [{ path: "src/middleware/ratelimit.ts", start_line: null, end_line: null, endpoint: null }],
    ...overrides,
  };
}

function briefWithRisks(risks: BriefRisk[]): BriefEnvelope {
  return {
    status: "ready",
    reason: null,
    brief: {
      pr_id: "pr1",
      head_sha: "sha1",
      what: "Introduces a token-bucket limiter in front of the public API endpoints.",
      why: "Prevents unauthenticated clients from overwhelming the API.",
      risk_level: "high",
      risks,
      review_focus: [],
    },
  };
}

/** Routes the shared `api.get` mock to `/intent` vs `/brief` by URL. */
function mockGet(intent: PrIntentRecord | null, brief: BriefEnvelope) {
  get.mockImplementation((url: string) => {
    if (url.includes("/intent")) return Promise.resolve(intent);
    return Promise.resolve(brief);
  });
}

function renderCard(onJumpToFile = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
        <IntentCard prId="pr1" onJumpToFile={onJumpToFile} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("IntentCard — risk areas subsection", () => {
  it("lists risks in descending severity, preserving stored order within a severity", async () => {
    // Stored order: M1, H1, L1, H2 — two "high" risks with H1 stored BEFORE
    // H2. Expected render order: H1, H2 (both high, stored order preserved),
    // then M1 (medium), then L1 (low).
    mockGet(INTENT, briefWithRisks([risk("M1", "medium"), risk("H1", "high"), risk("L1", "low"), risk("H2", "high")]));

    renderCard();
    await screen.findByText(INTENT.intent);

    const titles = screen.getAllByText(/^(H1|H2|M1|L1)$/).map((el) => el.textContent);
    expect(titles).toEqual(["H1", "H2", "M1", "L1"]);
  });

  it("does not render a risk explanation before the row is expanded", async () => {
    mockGet(INTENT, briefWithRisks([risk("Limiter bypass", "high", { explanation: "EXPLANATION-MARKER" })]));

    renderCard();
    await screen.findByText("Limiter bypass");

    expect(screen.queryByText("EXPLANATION-MARKER")).not.toBeInTheDocument();
  });

  it("expands a risk row from the keyboard alone", async () => {
    const theRisk = risk("Limiter bypass", "high", { explanation: "EXPLANATION-MARKER" });
    mockGet(INTENT, briefWithRisks([theRisk]));

    renderCard();
    await screen.findByText(theRisk.title);

    const expandButton = screen.getByRole("button", {
      name: `Expand explanation for risk: ${theRisk.title}`,
    });
    expect(expandButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("EXPLANATION-MARKER")).not.toBeInTheDocument();

    // Keyboard activation: focus the control, then the keydown/click pair a
    // real browser fires when Enter activates a focused <button> (jsdom does
    // not auto-translate keydown into click — see client/insights.md 2026-08-08
    // on user-event not being installed; RiskRow relies on native <button>
    // Enter/Space semantics, with no custom onKeyDown of its own).
    expandButton.focus();
    expect(expandButton).toHaveFocus();
    fireEvent.keyDown(expandButton, { key: "Enter", code: "Enter" });
    fireEvent.click(expandButton);

    expect(await screen.findByText("EXPLANATION-MARKER")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `Collapse explanation for risk: ${theRisk.title}` }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("rebuilds the whole brief when the recalculate control is activated", async () => {
    const original = risk("Limiter bypass", "high");
    mockGet(INTENT, briefWithRisks([original]));
    const regenerated = briefWithRisks([risk("Rebuilt risk title", "high")]);
    post.mockImplementation((url: string) =>
      url.includes("/brief/regenerate") ? Promise.resolve(regenerated) : Promise.resolve(INTENT),
    );

    renderCard();
    await screen.findByText(original.title);

    const recalcButton = screen.getByRole("button", { name: "Recalculate risk areas" });
    fireEvent.click(recalcButton);

    expect(await screen.findByText("Rebuilt risk title")).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith("/pulls/pr1/brief/regenerate");
    expect(screen.queryByText(original.title)).not.toBeInTheDocument();
  });
});
