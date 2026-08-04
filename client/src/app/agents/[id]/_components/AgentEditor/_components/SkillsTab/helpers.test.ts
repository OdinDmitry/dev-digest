import { describe, it, expect } from "vitest";
import type { AgentSkillLink, Skill } from "@devdigest/shared";
import { filterRows, orderRows, toggleLink } from "./helpers";

const skill = (id: string, name: string, over: Partial<Skill> = {}): Skill => ({
  id,
  name,
  description: `what ${name} is for`,
  type: "rubric",
  source: "manual",
  body: `## ${name}`,
  enabled: true,
  version: 1,
  evidence_files: null,
  ...over,
});

const link = (skill_id: string, order: number): AgentSkillLink => ({
  agent_id: "ag1",
  skill_id,
  order,
});

describe("orderRows", () => {
  const skills = [skill("a", "alpha"), skill("b", "bravo"), skill("c", "charlie")];

  it("puts linked skills first in link order, then the rest alphabetically", () => {
    // Link order deliberately disagrees with both alphabetical and array order.
    const rows = orderRows(skills, [link("c", 0), link("a", 1)]);
    expect(rows.map((r) => r.skill.id)).toEqual(["c", "a", "b"]);
    expect(rows.map((r) => r.linked)).toEqual([true, true, false]);
  });

  it("sorts by the order field, not by the array's own order", () => {
    const rows = orderRows(skills, [link("a", 5), link("b", 1)]);
    expect(rows.filter((r) => r.linked).map((r) => r.skill.id)).toEqual(["b", "a"]);
  });

  it("drops a link pointing at a skill that no longer exists", () => {
    const rows = orderRows(skills, [link("gone", 0), link("a", 1)]);
    expect(rows.map((r) => r.skill.id)).toEqual(["a", "b", "c"]);
    expect(rows.filter((r) => r.linked)).toHaveLength(1);
  });

  it("returns every skill unlinked when the agent has none", () => {
    const rows = orderRows(skills, []);
    expect(rows.map((r) => r.skill.id)).toEqual(["a", "b", "c"]);
    expect(rows.some((r) => r.linked)).toBe(false);
  });
});

describe("filterRows", () => {
  const rows = orderRows(
    [skill("a", "test-coverage-rubric"), skill("b", "mock-discipline", { type: "convention" })],
    [],
  );

  it("matches on name, description and type but not on the body", () => {
    expect(filterRows(rows, "mock").map((r) => r.skill.id)).toEqual(["b"]);
    expect(filterRows(rows, "convention").map((r) => r.skill.id)).toEqual(["b"]);
    expect(filterRows(rows, "what mock-discipline").map((r) => r.skill.id)).toEqual(["b"]);
    expect(filterRows(rows, "##")).toHaveLength(0);
  });

  it("returns everything for an empty or whitespace query", () => {
    expect(filterRows(rows, "")).toHaveLength(2);
    expect(filterRows(rows, "   ")).toHaveLength(2);
  });
});

describe("toggleLink", () => {
  it("appends a newly attached skill last, so the prompt order is stable", () => {
    expect(toggleLink(["a", "b"], "c")).toEqual(["a", "b", "c"]);
  });

  it("removes an attached skill and leaves the rest in order", () => {
    expect(toggleLink(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });
});
