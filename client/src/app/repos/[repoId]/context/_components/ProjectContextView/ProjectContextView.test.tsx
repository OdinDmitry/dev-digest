import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ContextDocument, ContextListing } from "@devdigest/shared";
import contextMessages from "../../../../../../../messages/en/context.json";

const get = vi.fn();
vi.mock("@/lib/api", () => ({
  api: { get: (p: string) => get(p), post: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
}));

// The shell pulls in nav chrome this test does not exercise.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    repoId: "r1",
    activeRepo: { id: "r1", full_name: "acme/payments-api", default_branch: "main" },
  }),
  useRepoNotFound: () => false,
}));

import { ProjectContextView } from "./ProjectContextView";

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ context: contextMessages }}>
        <ProjectContextView />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const DOCUMENTS: ContextDocument[] = [
  { path: "README.md", folder: "", size_bytes: 20, token_count: 12, usage_count: 2 },
  { path: "docs/guide.md", folder: "docs", size_bytes: 40, token_count: 34, usage_count: 0 },
];

function listing(over: Partial<ContextListing> = {}): ContextListing {
  return {
    documents: DOCUMENTS,
    document_count: DOCUMENTS.length,
    total_tokens: 46,
    partial: false,
    not_listed: 0,
    last_synced_at: "2026-08-16T10:00:00Z",
    synced: true,
    ...over,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("ProjectContextView", () => {
  it("presents the listing as unavailable and not the empty message before the first sync", async () => {
    get.mockImplementation((p: string) => {
      if (p === "/repos/r1/context/documents") {
        return Promise.resolve(
          listing({ documents: [], document_count: 0, total_tokens: 0, synced: false, last_synced_at: null }),
        );
      }
      throw new Error(`unexpected GET ${p}`);
    });

    renderView();

    expect(
      await screen.findByText(/Document listing unavailable/),
    ).toBeInTheDocument();
    expect(screen.queryByText("No spec files yet")).not.toBeInTheDocument();
  });

  it("states the repository contains no markdown documents when the synced set is empty", async () => {
    get.mockImplementation((p: string) => {
      if (p === "/repos/r1/context/documents") {
        return Promise.resolve(listing({ documents: [], document_count: 0, total_tokens: 0 }));
      }
      throw new Error(`unexpected GET ${p}`);
    });

    renderView();

    expect(await screen.findByText("No spec files yet")).toBeInTheDocument();
    expect(screen.queryByText(/Document listing unavailable/)).not.toBeInTheDocument();
  });

  it("renders each document's token count", async () => {
    get.mockImplementation((p: string) => {
      if (p === "/repos/r1/context/documents") return Promise.resolve(listing());
      if (p.startsWith("/repos/r1/context/document")) return Promise.resolve({ path: "README.md", text: "# Hello" });
      throw new Error(`unexpected GET ${p}`);
    });

    renderView();

    expect(await screen.findByText("12 tokens")).toBeInTheDocument();
    expect(screen.getByText("34 tokens")).toBeInTheDocument();
  });

  it("shows the combined token count of the listed documents in the footer", async () => {
    get.mockImplementation((p: string) => {
      // Generated at call time so `relativeTime` (real clock, not frozen)
      // reliably lands in the "just now" bucket regardless of when the test
      // suite runs.
      if (p === "/repos/r1/context/documents") {
        return Promise.resolve(listing({ last_synced_at: new Date().toISOString() }));
      }
      if (p.startsWith("/repos/r1/context/document")) return Promise.resolve({ path: "README.md", text: "# Hello" });
      throw new Error(`unexpected GET ${p}`);
    });

    renderView();

    // Match on the document count and combined token total; the trailing
    // "last synced …" clause is a relative-time string computed against the
    // real clock at render time, deliberately not pinned here.
    const matches = await screen.findAllByText(
      (_, el) => el?.textContent === "2 documents · 46 tokens total · last synced just now",
    );
    expect(matches.length).toBeGreaterThan(0);
  });

  it("renders the requested document as inert markdown", async () => {
    const guideText =
      "# Guide\n\n![evil](http://evil.example/tracker.png)\n\n[click me](javascript:alert(1))\n\n[real link](https://devdigest.example/docs)\n\nSafe paragraph text.";
    get.mockImplementation((p: string) => {
      if (p === "/repos/r1/context/documents") return Promise.resolve(listing());
      if (p === "/repos/r1/context/document?path=README.md") {
        return Promise.resolve({ path: "README.md", text: "# root readme" });
      }
      if (p === "/repos/r1/context/document?path=docs%2Fguide.md") {
        return Promise.resolve({ path: "docs/guide.md", text: guideText });
      }
      throw new Error(`unexpected GET ${p}`);
    });

    renderView();
    // README.md is the default preview (first document); request guide.md's
    // preview explicitly via its row's preview control.
    const guideRow = await screen.findByRole("button", { name: "Preview docs/guide.md" });
    fireEvent.click(guideRow);

    await waitFor(() => expect(screen.getByText("Safe paragraph text.")).toBeInTheDocument());

    // The <img> never renders as a real element — only its alt text does, so
    // the tracker URL is never fetched.
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("evil")).toBeInTheDocument();

    // A javascript: URL never becomes a real anchor — only its link text
    // renders, inert.
    expect(screen.queryByRole("link", { name: "click me" })).not.toBeInTheDocument();
    expect(screen.getByText("click me")).toBeInTheDocument();

    // An https: URL still renders as a real, safe anchor.
    const realLink = screen.getByRole("link", { name: "real link" });
    expect(realLink).toHaveAttribute("href", "https://devdigest.example/docs");
    expect(realLink).toHaveAttribute("rel", "noopener noreferrer");
  });
});
