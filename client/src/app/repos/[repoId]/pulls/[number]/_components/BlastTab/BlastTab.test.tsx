import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrBlastRadius } from "@devdigest/shared";
import blastMessages from "../../../../../../../../messages/en/blast.json";
import { githubBlobUrl } from "@/lib/github-urls";

const get = vi.fn();
vi.mock("@/lib/api", () => ({
  api: { get: (p: string) => get(p), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
  API_BASE: "http://localhost:3001",
}));

import { BlastTab } from "./BlastTab";

afterEach(cleanup);

const REPO_FULL_NAME = "acme/widgets";
const HEAD_SHA = "abc123";

// Two symbols in the same file (each with a line) plus one symbol in a
// second file (with no recorded line) — so grouping, the line display, and
// the null-line case are all observable from one fixture.
const BASE: PrBlastRadius = {
  pr_id: "pr1",
  repo_id: "repo1",
  state: "ok",
  reason: null,
  changed_files: ["src/util.ts", "src/other.ts"],
  changed_symbols: [
    { file: "src/util.ts", name: "doThing", kind: "function", line: 12 },
    { file: "src/util.ts", name: "doOtherThing", kind: "function", line: 30 },
    { file: "src/other.ts", name: "helper", kind: "function", line: null },
  ],
  callers: [
    {
      file: "src/caller.ts",
      symbol: "handler",
      via_symbol: "doThing",
      line: 42,
      rank: 0.87,
      percentile: 80,
    },
  ],
  callers_total: 1,
  callers_truncated: false,
  impacted_endpoints: [{ endpoint: "GET /api/thing", file: "src/routes/thing.ts", hops: 1 }],
  endpoints_truncated: false,
};

function renderTab({
  repoFullName = REPO_FULL_NAME,
  headSha = HEAD_SHA,
  diffFilePaths = new Set<string>(),
  onJumpToFile = vi.fn(),
}: {
  repoFullName?: string | null;
  headSha?: string | null;
  diffFilePaths?: ReadonlySet<string>;
  onJumpToFile?: (path: string) => void;
} = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ blast: blastMessages }}>
        <BlastTab
          prId="pr1"
          repoFullName={repoFullName}
          headSha={headSha}
          diffFilePaths={diffFilePaths}
          onJumpToFile={onJumpToFile}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("BlastTab", () => {
  it("renders changed symbols, callers and endpoints, and links a caller's file:line to GitHub", async () => {
    get.mockResolvedValue(BASE);

    renderTab();

    expect(await screen.findByText("doThing")).toBeInTheDocument();
    expect(screen.getByText("handler")).toBeInTheDocument();
    expect(screen.getByText("GET /api/thing")).toBeInTheDocument();

    const callerLink = screen.getByRole("link", { name: "src/caller.ts:42" });
    expect(callerLink).toHaveAttribute(
      "href",
      githubBlobUrl(REPO_FULL_NAME, HEAD_SHA, "src/caller.ts", 42),
    );
    expect(callerLink).toHaveAttribute("target", "_blank");
  });

  it("links a caller's file:line to GitHub even when that caller's file is in this PR's diff", async () => {
    get.mockResolvedValue(BASE);

    renderTab({ diffFilePaths: new Set(["src/caller.ts"]) });

    const callerLink = await screen.findByRole("link", { name: "src/caller.ts:42" });
    expect(callerLink).toHaveAttribute(
      "href",
      githubBlobUrl(REPO_FULL_NAME, HEAD_SHA, "src/caller.ts", 42),
    );
    expect(screen.queryByRole("button", { name: "src/caller.ts:42" })).not.toBeInTheDocument();
  });

  it("renders the caller's file:line as plain text (no link) when repoFullName is unknown", async () => {
    get.mockResolvedValue(BASE);

    renderTab({ repoFullName: null });

    expect(await screen.findByText("src/caller.ts:42")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "src/caller.ts:42" })).not.toBeInTheDocument();
  });

  it("groups changed symbols from the same file under one file header, not one box per symbol", async () => {
    get.mockResolvedValue(BASE);

    renderTab();

    expect(await screen.findByText("doThing")).toBeInTheDocument();
    expect(screen.getByText("doOtherThing")).toBeInTheDocument();
    // The shared file path renders exactly once as the group header.
    expect(screen.getAllByText("src/util.ts")).toHaveLength(1);
  });

  it("renders each symbol's declaration line, and no line text (no crash) when the indexer recorded none", async () => {
    get.mockResolvedValue(BASE);

    renderTab();

    expect(await screen.findByText("line 12")).toBeInTheDocument();
    expect(screen.getByText("line 30")).toBeInTheDocument();
    // "helper" has line: null — it still renders, with no "line …" text of its own.
    expect(screen.getByText("helper")).toBeInTheDocument();
    expect(screen.queryAllByText(/^line \d+$/)).toHaveLength(2);

    // A symbol's own declaration line is always a GitHub deep link, never an
    // in-diff jump — even though "src/util.ts" is not in this test's diffFilePaths.
    const lineLink = screen.getByRole("link", { name: "line 12" });
    expect(lineLink).toHaveAttribute(
      "href",
      githubBlobUrl(REPO_FULL_NAME, HEAD_SHA, "src/util.ts", 12),
    );
  });

  it("shows the caller's file_rank percentile as 'top N%' and drops the old raw-rank display", async () => {
    get.mockResolvedValue(BASE); // percentile: 80 -> top 20%

    renderTab();

    expect(await screen.findByText("top 20%")).toBeInTheDocument();
    expect(screen.queryByText(/0\.00/)).not.toBeInTheDocument();
  });

  it("renders a changed symbol's file header as a button when that file is in this PR's diff, and jumps on click", async () => {
    get.mockResolvedValue(BASE);
    const onJumpToFile = vi.fn();

    renderTab({ diffFilePaths: new Set(["src/util.ts"]), onJumpToFile });

    const groupButton = await screen.findByRole("button", { name: "src/util.ts" });
    fireEvent.click(groupButton);

    expect(onJumpToFile).toHaveBeenCalledWith("src/util.ts");
    expect(screen.queryByRole("link", { name: "src/util.ts" })).not.toBeInTheDocument();
  });

  it("renders an impacted endpoint's file as a button too when it is in this PR's diff", async () => {
    get.mockResolvedValue(BASE);
    const onJumpToFile = vi.fn();

    renderTab({ diffFilePaths: new Set(["src/routes/thing.ts"]), onJumpToFile });

    const endpointButton = await screen.findByRole("button", { name: "src/routes/thing.ts" });
    fireEvent.click(endpointButton);

    expect(onJumpToFile).toHaveBeenCalledWith("src/routes/thing.ts");
  });

  it("shows a warning banner and never renders results as 'no impact' when the index is degraded", async () => {
    get.mockResolvedValue({
      ...BASE,
      state: "degraded",
      reason: "index_failed",
      changed_symbols: [],
      callers: [],
      impacted_endpoints: [],
    });

    renderTab();

    expect(await screen.findByText("This repository isn't indexed, so blast radius can't be computed.")).toBeInTheDocument();
    expect(screen.getByText("The last indexing attempt for this repository failed.")).toBeInTheDocument();
    expect(screen.queryByText(/no impact/i)).not.toBeInTheDocument();
    // Degraded must not fall back to the ok-but-empty state either.
    expect(screen.queryByText(blastMessages.empty.title)).not.toBeInTheDocument();
  });

  it("shows an informational banner ABOVE results when the index is only partial", async () => {
    get.mockResolvedValue({ ...BASE, state: "partial", reason: "index_partial" });

    renderTab();

    expect(
      await screen.findByText("The repo-intel index is still incomplete — some callers may be missing."),
    ).toBeInTheDocument();
    // Results are still rendered alongside the banner.
    expect(screen.getByText("doThing")).toBeInTheDocument();
    expect(screen.getByText("GET /api/thing")).toBeInTheDocument();
  });

  it("shows the empty state when the diff touches no indexed symbols", async () => {
    get.mockResolvedValue({ ...BASE, changed_symbols: [], callers: [] });

    renderTab();

    expect(await screen.findByText(blastMessages.empty.title)).toBeInTheDocument();
  });

  it("shows a caller count for every symbol, including zero, and never the old 'no downstream callers' sentence", async () => {
    get.mockResolvedValue(BASE);

    renderTab();

    expect(await screen.findByText("doThing")).toBeInTheDocument();
    // doOtherThing and helper have no callers; doThing has one.
    expect(screen.getAllByText("0 callers")).toHaveLength(2);
    expect(screen.getByText("1 callers")).toBeInTheDocument();
    expect(screen.queryByText(/no downstream callers/i)).not.toBeInTheDocument();
  });

  it("falls back to a generic message for an unrecognised degraded reason instead of crashing or showing the raw value", async () => {
    get.mockResolvedValue({
      ...BASE,
      state: "degraded",
      reason: "some_future_reason_this_client_has_never_seen",
      changed_symbols: [],
      callers: [],
      impacted_endpoints: [],
    });

    renderTab();

    expect(await screen.findByText(blastMessages.reason.unknown)).toBeInTheDocument();
    expect(screen.queryByText("some_future_reason_this_client_has_never_seen")).not.toBeInTheDocument();
  });
});
