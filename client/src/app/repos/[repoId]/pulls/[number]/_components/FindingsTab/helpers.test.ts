import { describe, it, expect } from "vitest";
import type { ReviewRecord, FindingRecord } from "@devdigest/shared";
import { buildFindingsByRunId } from "./helpers";

function finding(o: Partial<FindingRecord> & { id: string; review_id: string }): FindingRecord {
  return {
    severity: "WARNING",
    category: "bug",
    title: "A finding",
    file: "src/a.ts",
    start_line: 1,
    end_line: 1,
    rationale: "x",
    suggestion: null,
    confidence: 0.8,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

function review(o: Partial<ReviewRecord> & { id: string }): ReviewRecord {
  return {
    pr_id: "pr1",
    agent_id: null,
    run_id: null,
    agent_name: null,
    kind: "review",
    verdict: null,
    summary: null,
    score: null,
    model: null,
    grounding: null,
    created_at: "2026-01-01T00:00:00.000Z",
    findings: [],
    ...o,
  };
}

describe("buildFindingsByRunId", () => {
  it("keys undismissed findings by run_id, dropping dismissed ones", () => {
    const m = buildFindingsByRunId([
      review({
        id: "r1",
        run_id: "run-1",
        findings: [
          finding({ id: "f1", review_id: "r1" }),
          finding({ id: "f2", review_id: "r1", dismissed_at: "2026-01-02T00:00:00.000Z" }),
        ],
      }),
    ]);
    expect(m.get("run-1")?.map((f) => f.id)).toEqual(["f1"]);
  });

  it("skips reviews with no run_id (e.g. manually-created reviews)", () => {
    const m = buildFindingsByRunId([
      review({ id: "r1", run_id: null, findings: [finding({ id: "f1", review_id: "r1" })] }),
    ]);
    expect(m.size).toBe(0);
  });

  it('skips kind !== "review" rows (e.g. a "summary" row) even if it has a run_id', () => {
    const m = buildFindingsByRunId([
      review({
        id: "r1",
        kind: "summary",
        run_id: "run-1",
        findings: [finding({ id: "f1", review_id: "r1" })],
      }),
    ]);
    expect(m.size).toBe(0);
  });

  it("MERGES findings instead of overwriting when two review rows share a run_id", () => {
    const m = buildFindingsByRunId([
      review({ id: "r1", run_id: "run-1", findings: [finding({ id: "f1", review_id: "r1" })] }),
      review({ id: "r2", run_id: "run-1", findings: [finding({ id: "f2", review_id: "r2" })] }),
    ]);
    expect(m.get("run-1")?.map((f) => f.id).sort()).toEqual(["f1", "f2"]);
  });
});
