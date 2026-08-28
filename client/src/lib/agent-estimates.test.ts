import { describe, it, expect } from "vitest";
import type { AgentEstimate } from "@devdigest/shared";
import { aggregateEstimate } from "./agent-estimates";

const AGENT_A: AgentEstimate = { agent_id: "a", duration_ms: 5000, cost_usd: 0.1 };
const AGENT_B: AgentEstimate = { agent_id: "b", duration_ms: 9000, cost_usd: 0.4 };
const AGENT_C: AgentEstimate = { agent_id: "c", duration_ms: 3000, cost_usd: 0.05 };

describe("aggregateEstimate", () => {
  it("takes the greatest duration and the summed cost over three selected agents", () => {
    const result = aggregateEstimate(["a", "b", "c"], [AGENT_A, AGENT_B, AGENT_C]);
    expect(result).toEqual({
      duration_ms: 9000, // max(5000, 9000, 3000)
      cost_usd: 0.1 + 0.4 + 0.05, // sum
      complete: true,
    });
  });

  it("stays complete: false but still computes the figures from the agents that DO have an estimate, when one agent has none", () => {
    const result = aggregateEstimate(["a", "no-estimate", "c"], [AGENT_A, AGENT_C]);
    expect(result.complete).toBe(false);
    // Figures still reflect the two agents that DID carry an estimate.
    expect(result.duration_ms).toBe(5000); // max(5000, 3000)
    expect(result.cost_usd).toBeCloseTo(0.15); // 0.1 + 0.05
  });

  it("is complete: false when an agent has a duration but a null cost", () => {
    const partial: AgentEstimate = { agent_id: "partial", duration_ms: 7000, cost_usd: null };
    const result = aggregateEstimate(["a", "partial"], [AGENT_A, partial]);
    expect(result.complete).toBe(false);
    // The duration side is still folded in even though cost is missing.
    expect(result.duration_ms).toBe(7000); // max(5000, 7000)
    expect(result.cost_usd).toBe(0.1); // only agent "a" contributed a cost
  });

  it("a single-agent selection's aggregate equals that agent's own duration/cost", () => {
    const result = aggregateEstimate(["b"], [AGENT_A, AGENT_B, AGENT_C]);
    expect(result).toEqual({ duration_ms: 9000, cost_usd: 0.4, complete: true });
  });

  it("an empty selection is null figures and NOT complete", () => {
    const result = aggregateEstimate([], [AGENT_A, AGENT_B, AGENT_C]);
    expect(result).toEqual({ duration_ms: null, cost_usd: null, complete: false });
  });
});
