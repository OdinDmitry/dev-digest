import type { SkillCase } from "../../src/index.js";

// Content-only cases (skillTask): no tools, so the feature under discussion is described inline
// in the prompt. Both prompts are phrased the way a developer actually asks ("here's what we're
// building, what do we need to specify?") and NEVER hint at the criteria being scored — the judge
// has to see the skill's own rules fire, not a restatement of the question.
//
// The practices deliberately avoid anything a raw model volunteers anyway. Any model asked about
// accessibility will say "keyboard support matters"; what discriminates is the skill's two hard
// rules — criteria must be implementation-free (no ARIA/roles/markup) and must never collapse
// into a blanket "WCAG 2.2 AA compliant" — plus its restraint rule ("a read-only text panel does
// not need eight criteria; it may need one").

export const cases: SkillCase[] = [
  {
    // Four planted gaps, one per interrogation area: keyboard path (drag-only reorder), colour
    // alone (severity dots), status announcement (background job finishing), focus management
    // (deleting the focused row). Nothing in the prompt labels them as problems.
    name: "turns a findings-list feature into implementation-free criteria and catches the drag-only and colour-alone gaps",
    kind: "quality",
    prompt:
      "We're specifying the findings list on a DevDigest review page, and I need the acceptance " +
      "criteria before implementation starts. The behaviour we agreed on:\n\n" +
      "- Each finding is a row showing a coloured dot for severity (red = critical, amber = " +
      "warning, grey = suggestion), the file path, and the finding title.\n" +
      "- Reviewers can reorder the rows by dragging them into the order they want to work through.\n" +
      "- Each row has an icon-only button to dismiss the finding. Dismissing removes the row from " +
      "the list immediately.\n" +
      "- The review runs in the background. When it finishes, the list fills in with the new " +
      "findings and a toast appears in the corner for four seconds.\n\n" +
      "What accessibility acceptance criteria does this feature need?",
    practices: [
      "identifies that reordering is available only by dragging and requires a keyboard-operable way to achieve the same reordering",
      "identifies that severity is carried by colour alone and requires a second, non-colour channel for the same information",
      "identifies that the background review finishing (and/or the toast) changes content without user action and requires that change to be perceivable to a non-visual user",
      "states where keyboard focus must go after a finding row is dismissed, rather than leaving focus placement unspecified",
      "phrases the criteria without prescribing implementation — no ARIA attributes, no role names, no markup or component-library specifics",
      "does not fall back on a blanket 'WCAG 2.2 AA compliant' style criterion in place of specific, individually testable statements",
    ],
    threshold: 0.6,
  },
  {
    // Negative / restraint prompt. The skill's "What not to write" section says a read-only text
    // panel "does not need eight criteria; it may need one" — so the failure mode being tested is
    // padding the answer out to the full eight-area checklist. A model without the skill reliably
    // produces criteria for forms, motion and gestures that this feature simply does not have.
    name: "stays proportional on a read-only panel instead of padding out the eight-area checklist",
    kind: "quality",
    prompt:
      "Small one: we're adding a read-only panel to the PR page that renders the pull request " +
      "description as plain text. No buttons, no links, no inputs, nothing animates, and it never " +
      "updates after the page loads — it's just the description text in a box with its own " +
      "heading. Long descriptions make the box scroll. What accessibility acceptance criteria " +
      "does this need?",
    practices: [
      "keeps the criteria set small and proportional to a static, non-interactive panel rather than producing a criterion for every accessibility category",
      "does not invent criteria for interactions this feature does not have — no drag/gesture, no form validation or error handling, and no motion/animation or auto-dismiss timing requirements",
      "addresses that the scrollable region must be reachable and scrollable without a pointer",
      "phrases the criteria without prescribing implementation — no ARIA attributes, no role names, no markup or component-library specifics",
    ],
    threshold: 0.6,
  },
];
