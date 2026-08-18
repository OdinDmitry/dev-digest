import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BriefEnvelope, PrIntentRecord } from "@devdigest/shared";
import briefMessages from "../../../../../../../../messages/en/brief.json";

const get = vi.fn();
const post = vi.fn();
vi.mock("@/lib/api", () => ({
  api: { get: (p: string) => get(p), post: (p: string) => post(p), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
  API_BASE: "http://localhost:3001",
}));

import { OverviewTab } from "./OverviewTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const INTENT: PrIntentRecord = {
  pr_id: "pr1",
  intent: "Adds token-bucket rate limiting to the public API endpoints.",
  in_scope: [],
  out_of_scope: [],
};

const BRIEF: BriefEnvelope = {
  status: "ready",
  reason: null,
  brief: {
    pr_id: "pr1",
    head_sha: "sha1",
    what: "Introduces a token-bucket limiter in front of the public API endpoints.",
    why: "Prevents unauthenticated clients from overwhelming the API.",
    risk_level: "medium",
    risks: [],
    review_focus: [
      {
        reason: "Start with the limiter itself",
        refs: [{ path: "src/middleware/ratelimit.ts", start_line: null, end_line: null, endpoint: null }],
      },
    ],
  },
};

/** Routes `api.get` across the three reads OverviewTab's children make —
 *  IntentCard's `/intent`, BriefCard's `/run-summary`, and everyone's shared
 *  `/brief`. Both `/intent` and `/brief` are already persisted here so
 *  neither card's auto-start guard fires (no `post` call, no interference
 *  with the DOM-order assertions). */
function mockGet() {
  get.mockImplementation((url: string) => {
    if (url.includes("/run-summary")) return Promise.resolve(null);
    if (url.includes("/intent")) return Promise.resolve(INTENT);
    return Promise.resolve(BRIEF);
  });
}

function renderOverview(onJumpToFile = vi.fn(), prBody: string | null = "A description of the change.") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
        <OverviewTab prId="pr1" prBody={prBody} onJumpToFile={onJumpToFile} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

/** True iff `before` precedes `after` in document order. */
function precedes(before: Element, after: Element): boolean {
  return Boolean(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe("OverviewTab", () => {
  it("renders the brief card above the intent card and the description", async () => {
    mockGet();

    renderOverview();

    const briefRegion = await screen.findByRole("region", { name: "PR BRIEF" });
    const intentHeading = screen.getByText("Intent");
    const descriptionText = screen.getByText("A description of the change.");

    expect(precedes(briefRegion, intentHeading)).toBe(true);
    expect(precedes(briefRegion, descriptionText)).toBe(true);
  });

  it("renders the review focus section below the intent card and above the description", async () => {
    mockGet();

    renderOverview();

    const intentHeading = await screen.findByText("Intent");
    const focusRegion = await screen.findByRole("region", { name: "REVIEW FOCUS — READ THESE FIRST" });
    const descriptionText = screen.getByText("A description of the change.");

    expect(precedes(intentHeading, focusRegion)).toBe(true);
    // The author's PR body must not sit between Intent and Review Focus:
    // asserting only "intent precedes focus" passes with Description wedged
    // in between, which is exactly the layout this assertion exists to reject.
    expect(precedes(focusRegion, descriptionText)).toBe(true);
  });

  it("routes a review-focus reference to the changed-files view", async () => {
    const onJumpToFile = vi.fn();
    mockGet();

    renderOverview(onJumpToFile);

    const refButton = await screen.findByRole("button", {
      name: "Go to src/middleware/ratelimit.ts in Files changed",
    });
    fireEvent.click(refButton);

    expect(onJumpToFile).toHaveBeenCalledWith("src/middleware/ratelimit.ts");
    expect(onJumpToFile).toHaveBeenCalledTimes(1);
  });
});
