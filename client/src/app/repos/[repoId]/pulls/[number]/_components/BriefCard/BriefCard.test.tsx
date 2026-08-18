import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BriefEnvelope, PrRunSummary } from "@devdigest/shared";
import briefMessages from "../../../../../../../../messages/en/brief.json";

const get = vi.fn();
const post = vi.fn();
vi.mock("@/lib/api", () => ({
  api: { get: (p: string) => get(p), post: (p: string) => post(p), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
  API_BASE: "http://localhost:3001",
}));

import { BriefCard } from "./BriefCard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const READY_BRIEF: BriefEnvelope = {
  status: "ready",
  reason: null,
  brief: {
    pr_id: "pr1",
    head_sha: "sha1",
    what: "Introduces a token-bucket limiter in front of the public API endpoints.",
    why: "Prevents unauthenticated clients from overwhelming the API with no throttling.",
    risk_level: "high",
    risks: [],
    review_focus: [],
  },
};

const ABSENT_BRIEF: BriefEnvelope = { status: "absent", brief: null, reason: null };

const RUN_SUMMARY: PrRunSummary = {
  verdict: "request_changes",
  findings_count: 3,
  blockers_count: 1,
  score: 55,
};

/** Routes the shared `api.get` mock to the right fixture by URL, mirroring
 *  BriefCard's two independent reads (`usePrBrief`, `usePrRunSummary`). */
function mockGet(brief: BriefEnvelope | null, runSummary: PrRunSummary | null) {
  get.mockImplementation((url: string) =>
    Promise.resolve(url.includes("/run-summary") ? runSummary : brief),
  );
}

function renderCard(prId: string | null = "pr1") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
        <BriefCard prId={prId} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("BriefCard", () => {
  it("presents the verdict, finding count and blocker count of the latest run", async () => {
    mockGet(READY_BRIEF, RUN_SUMMARY);

    renderCard();

    // AC-1 (also binding on this component, per client/insights.md
    // 2026-08-18): what/why/risk level render above everything else in the card.
    expect(await screen.findByText(READY_BRIEF.brief!.what)).toBeInTheDocument();
    expect(screen.getByText(READY_BRIEF.brief!.why)).toBeInTheDocument();
    expect(screen.getByText("High risk")).toBeInTheDocument();

    // AC-3: verdict + finding/blocker counts.
    expect(screen.getByText("Request changes")).toBeInTheDocument();
    expect(screen.getByText(/3 findings/)).toBeInTheDocument();
    expect(screen.getByText(/1 blockers/)).toBeInTheDocument();

    // AC-4: the score itself.
    expect(screen.getByText("55")).toBeInTheDocument();
    expect(screen.getByText("PR SCORE")).toBeInTheDocument();
  });

  it("presents the score as unavailable and no verdict or counts when there has been no run", async () => {
    mockGet(READY_BRIEF, null);

    renderCard();

    expect(await screen.findByText("No score yet")).toBeInTheDocument();
    expect(screen.queryByText(/^\d+$/)).not.toBeInTheDocument(); // no numeric score rendered
    expect(screen.queryByText("Request changes")).not.toBeInTheDocument();
    expect(screen.queryByText(/findings/)).not.toBeInTheDocument();
    expect(screen.queryByText(/blockers/)).not.toBeInTheDocument();
  });

  it("presents the card as generating and shows no partial brief while the generation is pending", async () => {
    mockGet(ABSENT_BRIEF, null);
    // Never resolves within this test — asserts the PENDING window only.
    post.mockImplementation(() => new Promise<BriefEnvelope>(() => {}));

    renderCard();

    expect(await screen.findByText("Generating the PR brief…")).toBeInTheDocument();
    expect(screen.queryByText(READY_BRIEF.brief!.what)).not.toBeInTheDocument();
    expect(screen.queryByText(READY_BRIEF.brief!.why)).not.toBeInTheDocument();
    expect(post).toHaveBeenCalledWith("/pulls/pr1/brief");
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("rebuilds the whole brief when the regenerate control is activated", async () => {
    mockGet(READY_BRIEF, RUN_SUMMARY);
    const regenerated: BriefEnvelope = {
      status: "ready",
      reason: null,
      brief: { ...READY_BRIEF.brief!, what: "A rebuilt what statement, distinct from the first." },
    };
    post.mockResolvedValue(regenerated);

    renderCard();
    expect(await screen.findByText(READY_BRIEF.brief!.what)).toBeInTheDocument();

    const button = screen.getByRole("button", { name: "Regenerate the PR brief" });
    fireEvent.click(button);

    expect(await screen.findByText(regenerated.brief!.what)).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith("/pulls/pr1/brief/regenerate");
    expect(screen.queryByText(READY_BRIEF.brief!.what)).not.toBeInTheDocument();
  });

  it("presents the card as unavailable when the generation fails", async () => {
    mockGet(ABSENT_BRIEF, null);
    post.mockRejectedValue(new Error("model call failed"));

    renderCard();

    expect(await screen.findByText("model call failed")).toBeInTheDocument();
    expect(screen.queryByText("Generating the PR brief…")).not.toBeInTheDocument();
  });

  it("renders the stored brief without triggering a generation", async () => {
    mockGet(READY_BRIEF, RUN_SUMMARY);

    renderCard();

    expect(await screen.findByText(READY_BRIEF.brief!.what)).toBeInTheDocument();
    expect(screen.getByText(READY_BRIEF.brief!.why)).toBeInTheDocument();
    expect(screen.getByText("High risk")).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
});
