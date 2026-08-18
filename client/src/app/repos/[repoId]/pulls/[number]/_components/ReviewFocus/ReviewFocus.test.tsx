import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BriefEnvelope, BriefFocusItem } from "@devdigest/shared";
import briefMessages from "../../../../../../../../messages/en/brief.json";

const get = vi.fn();
vi.mock("@/lib/api", () => ({
  api: { get: (p: string) => get(p), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
  API_BASE: "http://localhost:3001",
}));

import { ReviewFocus } from "./ReviewFocus";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function briefWithFocus(review_focus: BriefFocusItem[]): BriefEnvelope {
  return {
    status: "ready",
    reason: null,
    brief: {
      pr_id: "pr1",
      head_sha: "sha1",
      what: "Introduces a token-bucket limiter in front of the public API endpoints.",
      why: "Prevents unauthenticated clients from overwhelming the API.",
      risk_level: "medium",
      risks: [],
      review_focus,
    },
  };
}

function mockGet(brief: BriefEnvelope) {
  get.mockResolvedValue(brief);
}

function renderFocus(onJumpToFile = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
        <ReviewFocus prId="pr1" onJumpToFile={onJumpToFile} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("ReviewFocus", () => {
  it("states a count equal to the number of items it lists", async () => {
    const items: BriefFocusItem[] = [
      {
        reason: "Start with the limiter itself",
        refs: [{ path: "src/middleware/ratelimit.ts", start_line: null, end_line: null, endpoint: null }],
      },
      {
        reason: "Confirm no secret material is committed",
        refs: [{ path: "src/config.ts", start_line: null, end_line: null, endpoint: null }],
      },
      {
        reason: "Check the webhook handler applies the same limiter",
        refs: [{ path: "src/api/public/webhooks.ts", start_line: null, end_line: null, endpoint: null }],
      },
    ];
    mockGet(briefWithFocus(items));

    renderFocus();

    await screen.findByText(items[0]!.reason);
    expect(screen.getByText("3")).toBeInTheDocument();
    // Stored order, not client-resorted.
    const reasons = items.map((i) => screen.getByText(i.reason));
    expect(reasons[0]!.compareDocumentPosition(reasons[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(reasons[1]!.compareDocumentPosition(reasons[2]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("presents a zero count and the no-starting-point text when there are no review-focus items", async () => {
    mockGet(briefWithFocus([]));

    renderFocus();

    expect(await screen.findByText("No starting point was identified.")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("presents two identical references in one item once", async () => {
    const dupPath = "src/api/public/webhooks.ts";
    const items: BriefFocusItem[] = [
      {
        reason: "Check the webhook handler applies the same limiter as the other public endpoints",
        refs: [
          { path: dupPath, start_line: null, end_line: null, endpoint: null },
          { path: dupPath, start_line: null, end_line: null, endpoint: null },
        ],
      },
    ];
    mockGet(briefWithFocus(items));

    renderFocus();

    await screen.findByText(items[0]!.reason);
    const refButtons = screen.getAllByRole("button", { name: `Go to ${dupPath} in Files changed` });
    expect(refButtons).toHaveLength(1);
  });

  it("requests the changed-files view for the referenced file when a reference is activated", async () => {
    const onJumpToFile = vi.fn();
    const items: BriefFocusItem[] = [
      {
        reason: "Start with the limiter itself",
        refs: [{ path: "src/middleware/ratelimit.ts", start_line: null, end_line: null, endpoint: null }],
      },
    ];
    mockGet(briefWithFocus(items));

    renderFocus(onJumpToFile);

    const refButton = await screen.findByRole("button", {
      name: "Go to src/middleware/ratelimit.ts in Files changed",
    });
    fireEvent.click(refButton);

    expect(onJumpToFile).toHaveBeenCalledWith("src/middleware/ratelimit.ts");
    expect(onJumpToFile).toHaveBeenCalledTimes(1);
  });
});
