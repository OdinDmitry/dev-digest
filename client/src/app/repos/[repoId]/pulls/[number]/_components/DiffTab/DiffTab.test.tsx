import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FindingRecord, PrFile, SmartDiff } from "@devdigest/shared";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import shellMessages from "../../../../../../../../messages/en/shell.json";
import { AUTO_EXPAND_MAX_LINES } from "@/components/diff-viewer/constants";
import { diffFileCardId } from "@/components/diff-viewer";

const get = vi.fn();
vi.mock("@/lib/api", () => ({
  api: { get: (p: string) => get(p), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
  API_BASE: "http://localhost:3001",
}));

import { DiffTab } from "./DiffTab";

afterEach(cleanup);

// jsdom does not implement scrollIntoView — stub it so FileCard's scroll
// effect doesn't throw when a target lands on a mounted card.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const PATCH = `@@ -1,2 +1,3 @@\n line1\n+line2\n line3`;

const FILES: PrFile[] = [{ path: "src/a.ts", additions: 1, deletions: 0, patch: PATCH }];

const SMART_DIFF: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [
        {
          path: "src/a.ts",
          pseudocode_summary: null,
          additions: 1,
          deletions: 0,
          findings: [{ line: 2, finding_id: "f1" }],
        },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 1, proposed_splits: [] },
};

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded secret",
  file: "src/a.ts",
  start_line: 2,
  end_line: 2,
  rationale: "x",
  suggestion: null,
  confidence: 0.9,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderTab({
  files = FILES,
  targetFilePath = null,
  targetFileNonce = 0,
}: {
  files?: PrFile[];
  targetFilePath?: string | null;
  targetFileNonce?: number;
} = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages, shell: shellMessages }}>
        <DiffTab
          prId="pr1"
          filesCount={files.length}
          files={files}
          canComment={false}
          findings={[FINDING]}
          onOpenFinding={vi.fn()}
          targetFilePath={targetFilePath}
          targetFileNonce={targetFileNonce}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("DiffTab — Smart order / Original order toggle", () => {
  it("Smart mode (default) shows the finding marker; Original mode shows zero markers and the same files-changed header", async () => {
    get.mockImplementation((path: string) => {
      if (path.includes("/smart-diff")) return Promise.resolve(SMART_DIFF);
      if (path.includes("/comments")) return Promise.resolve([]);
      return Promise.resolve(null);
    });

    renderTab();

    expect(screen.getByText("Files changed · 1 files")).toBeInTheDocument();

    // Smart is the default — the marker for the finding on line 2 appears
    // once the smart-diff query resolves.
    expect(await screen.findByRole("button", { name: /CRITICAL: Hardcoded secret/i })).toBeInTheDocument();

    // Switch to Original order.
    fireEvent.click(screen.getByText("Original order"));

    // The header is unchanged in both modes...
    expect(screen.getByText("Files changed · 1 files")).toBeInTheDocument();
    // ...but there are ZERO finding markers — structural (no `renderLineMarker`
    // prop passed at all), not merely hidden.
    expect(screen.queryByRole("button", { name: /CRITICAL: Hardcoded secret/i })).not.toBeInTheDocument();
  });
});

describe("DiffTab — Blast-tab jump target", () => {
  it("expands and scrolls to a large file's card when targeted, even though it would otherwise default collapsed", async () => {
    get.mockImplementation((path: string) => {
      if (path.includes("/smart-diff")) return Promise.resolve(null);
      if (path.includes("/comments")) return Promise.resolve([]);
      return Promise.resolve(null);
    });

    const largeFile: PrFile = {
      path: "src/big.ts",
      additions: 150,
      deletions: 100, // 250 total > AUTO_EXPAND_MAX_LINES — starts collapsed by default
      patch: `@@ -1,2 +1,3 @@\n line1\n+line2\n line3`,
    };
    expect(largeFile.additions + largeFile.deletions).toBeGreaterThan(AUTO_EXPAND_MAX_LINES);

    renderTab({ files: [largeFile], targetFilePath: "src/big.ts", targetFileNonce: 1 });

    // The card carries the stable, path-derived id (looked up with
    // getElementById, per the diff-viewer helper's own doc comment).
    expect(await screen.findByText("src/big.ts")).toBeInTheDocument();
    expect(document.getElementById(diffFileCardId("src/big.ts"))).not.toBeNull();

    // Expanded, not collapsed: its parsed line content is present in the DOM.
    expect(await screen.findByText("line2")).toBeInTheDocument();
  });
});
