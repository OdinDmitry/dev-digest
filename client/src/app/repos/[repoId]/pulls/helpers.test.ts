import { describe, it, expect } from "vitest";
import type { ReviewRecord } from "@devdigest/shared";
import { latestReviewPerAgent } from "./helpers";

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

describe("latestReviewPerAgent", () => {
  it("keeps each distinct agent's review (input newest-first, so this is each agent's LATEST)", () => {
    const result = latestReviewPerAgent([
      review({ id: "r-general-latest", agent_id: "agent-general" }),
      review({ id: "r-security", agent_id: "agent-security" }),
      review({ id: "r-general-older", agent_id: "agent-general" }),
    ]);
    expect(result.map((r) => r.id).sort()).toEqual(["r-general-latest", "r-security"].sort());
  });

  it("drops a re-run's older review for the SAME agent (first-seen in newest-first order wins)", () => {
    const result = latestReviewPerAgent([
      review({ id: "r-newer", agent_id: "agent-a" }),
      review({ id: "r-older", agent_id: "agent-a" }),
    ]);
    expect(result.map((r) => r.id)).toEqual(["r-newer"]);
  });

  it('skips kind !== "review" rows', () => {
    const result = latestReviewPerAgent([review({ id: "r1", kind: "summary", agent_id: "a" })]);
    expect(result).toEqual([]);
  });

  it("a null agent_id is its own bucket per review id, never merged with another null-agent review", () => {
    const result = latestReviewPerAgent([
      review({ id: "r1", agent_id: null }),
      review({ id: "r2", agent_id: null }),
    ]);
    expect(result.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
  });
});
