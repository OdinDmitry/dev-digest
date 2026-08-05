import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile, SmartDiff, SmartDiffFile } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/prReview.json";
import shellMessages from "../../../../../../../../../../messages/en/shell.json";
import { LARGE_FILE_LINES } from "./constants";
import { SmartDiffViewer } from "./SmartDiffViewer";

afterEach(cleanup);

function sdFile(o: Partial<SmartDiffFile> & { path: string }): SmartDiffFile {
  return { pseudocode_summary: null, additions: 5, deletions: 0, findings: [], ...o };
}

function prFile(o: Partial<PrFile> & { path: string }): PrFile {
  return { additions: 5, deletions: 0, patch: null, ...o };
}

function findingRecord(o: Partial<FindingRecord> & { id: string }): FindingRecord {
  return {
    severity: "WARNING",
    category: "bug",
    title: "A finding",
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
    ...o,
  };
}

function renderViewer(props: Partial<React.ComponentProps<typeof SmartDiffViewer>> & { smartDiff: SmartDiff }) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages, shell: shellMessages }}>
      <SmartDiffViewer files={[]} findings={[]} onOpenFinding={vi.fn()} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("SmartDiffViewer", () => {
  it("renders groups core-first; boilerplate starts collapsed but shows its finding count, and expands on click", () => {
    const smartDiff: SmartDiff = {
      groups: [
        { role: "core", files: [sdFile({ path: "src/core.ts" })] },
        { role: "wiring", files: [sdFile({ path: "package.json" })] },
        {
          role: "boilerplate",
          files: [sdFile({ path: "pnpm-lock.yaml", findings: [{ line: 1, finding_id: "f1" }] })],
        },
      ],
      split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
    };
    const files: PrFile[] = [
      prFile({ path: "src/core.ts" }),
      prFile({ path: "package.json" }),
      prFile({ path: "pnpm-lock.yaml" }),
    ];

    renderViewer({ smartDiff, files });

    // Order: Core, Wiring, Boilerplate (server order, never re-sorted).
    const labels = ["Core", "Wiring", "Boilerplate"].map((t) => screen.getByText(t));
    const positions = labels.map((el) => el.compareDocumentPosition(labels[0]!));
    expect(positions).toBeDefined(); // sanity: all three headers exist
    expect(screen.getByText("Core").compareDocumentPosition(screen.getByText("Wiring")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Wiring").compareDocumentPosition(screen.getByText("Boilerplate")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Boilerplate is collapsed: the lockfile's FileCard isn't rendered yet...
    expect(screen.queryByText("pnpm-lock.yaml")).not.toBeInTheDocument();
    // ...but its finding count is still visible on the (collapsed) group header.
    expect(screen.getByText("1 findings")).toBeInTheDocument();

    // Expand it.
    fireEvent.click(screen.getByText("Boilerplate"));
    expect(screen.getByText("pnpm-lock.yaml")).toBeInTheDocument();
  });

  it("renders a marker on a finding's line; clicking it calls onOpenFinding (not a navigation, not a link)", () => {
    const patch = `@@ -1,2 +1,3 @@\n line1\n+line2\n line3`;
    const smartDiff: SmartDiff = {
      groups: [
        {
          role: "core",
          files: [sdFile({ path: "src/a.ts", findings: [{ line: 2, finding_id: "f1" }] })],
        },
      ],
      split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
    };
    const files: PrFile[] = [prFile({ path: "src/a.ts", patch })];
    const findings: FindingRecord[] = [findingRecord({ id: "f1", severity: "CRITICAL", title: "Hardcoded secret" })];
    const onOpenFinding = vi.fn();

    renderViewer({ smartDiff, files, findings, onOpenFinding });

    const marker = screen.getByRole("button", { name: /CRITICAL: Hardcoded secret/i });
    fireEvent.click(marker);
    expect(onOpenFinding).toHaveBeenCalledWith("f1");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("highlights a file over LARGE_FILE_LINES and not one under it", () => {
    const smartDiff: SmartDiff = {
      groups: [
        {
          role: "core",
          files: [
            sdFile({ path: "big.ts", additions: LARGE_FILE_LINES + 1, deletions: 0 }),
            sdFile({ path: "small.ts", additions: 5, deletions: 0 }),
          ],
        },
      ],
      split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
    };
    const files: PrFile[] = [
      prFile({ path: "big.ts", additions: LARGE_FILE_LINES + 1, deletions: 0 }),
      prFile({ path: "small.ts", additions: 5, deletions: 0 }),
    ];

    renderViewer({ smartDiff, files });

    expect(screen.getAllByText("Large file")).toHaveLength(1);
  });

  it("never hides an unmapped file: one absent from any group, one absent from `files` — and never renders literal null", () => {
    const smartDiff: SmartDiff = {
      groups: [
        {
          role: "core",
          files: [sdFile({ path: "src/known.ts" }), sdFile({ path: "src/no-pr-file.ts" })],
        },
      ],
      split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
    };
    // "src/known.ts" has a matching PrFile; "src/no-pr-file.ts" does NOT (defensive
    // synthesis); "src/orphan.ts" is a PrFile absent from every group (defensive
    // append to the first group) — none may be hidden or crash the render.
    const files: PrFile[] = [prFile({ path: "src/known.ts" }), prFile({ path: "src/orphan.ts" })];

    renderViewer({ smartDiff, files });

    expect(screen.getByText("src/known.ts")).toBeInTheDocument();
    expect(screen.getByText("src/no-pr-file.ts")).toBeInTheDocument();
    expect(screen.getByText("src/orphan.ts")).toBeInTheDocument();
    expect(screen.queryByText("null")).not.toBeInTheDocument();
  });
});
