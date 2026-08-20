import type { SkillCase } from "../../src/index.js";

// To inline a fixture file into a prompt, uncomment these two lines and drop the file in
// fixtures/, then use fx("your-fixture.ext") inside a prompt string:
//   import { fixtureReader } from "../../src/index.js";
//   const fx = fixtureReader(import.meta.url);

export const cases: SkillCase[] = [
  {
    name: "TODO describe the good behavior this checks",
    kind: "quality",
    prompt: "TODO the user/task prompt the skill should handle",
    practices: [
      "TODO a specific, binary, citable thing the answer must do",
      "TODO another one — keep each verifiable from a verbatim quote",
    ],
    // grounding: ["exact-substring-that-must-appear-before-judging"], // optional cheap gate
    // threshold: 0.6,
    // maxTurns: 8,
  },
  // Keep it minimal — one or two cases is enough to start.
];
