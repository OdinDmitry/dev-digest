import { describe, it, expect } from "vitest";
import { isUnvettedSkillSource } from "./skill-source";

describe("isUnvettedSkillSource", () => {
  it("flags a raw upload and the community catalog as unvetted", () => {
    expect(isUnvettedSkillSource("imported_url")).toBe(true);
    expect(isUnvettedSkillSource("community")).toBe(true);
  });

  it("does not flag a skill typed by hand or mined from the user's own repo", () => {
    expect(isUnvettedSkillSource("manual")).toBe(false);
    // 'extracted' conventions were already reviewed one by one (accept/reject)
    // before the skill was created — same trust level as typing it by hand.
    expect(isUnvettedSkillSource("extracted")).toBe(false);
  });

  it("tolerates an unrecognized value rather than throwing", () => {
    expect(isUnvettedSkillSource("something-new")).toBe(false);
  });
});
