import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FindingRecord, PrFile, SmartDiff } from "@devdigest/shared";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import shellMessages from "../../../../../../../../messages/en/shell.json";

const get = vi.fn();
vi.mock("@/lib/api", () => ({
  api: { get: (p: string) => get(p), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
  API_BASE: "http://localhost:3001",
}));

import { DiffTab } from "./DiffTab";

afterEach(cleanup);

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

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages, shell: shellMessages }}>
        <DiffTab
          prId="pr1"
          filesCount={1}
          files={FILES}
          canComment={false}
          findings={[FINDING]}
          onOpenFinding={vi.fn()}
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
