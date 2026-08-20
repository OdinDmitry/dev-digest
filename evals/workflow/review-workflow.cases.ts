import type { WorkflowCase } from "../src/index.js";

/**
 * Systemic ("workflow") tier — asserts the real on-disk harness (CLAUDE.md + skills + subagents,
 * loaded via settingSources:["project"]) behaves as documented. Organized by scenario, not by a
 * single artifact, because these behaviors are cross-cutting.
 *
 * Budget: 5 Claude sessions total.
 *   - 3 × trace     → 1 session each                      = 3
 *   - 1 × activation pair (positive + near-miss negative) = 2
 *
 * `trace` folds several assertions into ONE session (cheaper, coarser) and stops early once its
 * evidence is in — so a dispatch-bearing trace never waits out the nested subagent's full run.
 */
export const cases: WorkflowCase[] = [
  // --- trace (1 session): CLAUDE.md "Read When" routing + subagent dispatch, together -----------
  {
    kind: "trace",
    // Endpoint must NOT already exist, or the model reviews the existing code inline instead of
    // planning-then-dispatching. GET /reviews/:id/export is genuinely absent from routes.ts.
    //
    // Asserts server/CLAUDE.md, NOT server/docs/api-contracts.md: this repo's server/docs/ holds
    // only its README ("add a file here when a topic needs more than a map entry"), so the old
    // target could never be read. The routing rule that actually exists here is the root
    // CLAUDE.md "## Modules" table pointing backend work at server/CLAUDE.md — and that file is
    // NOT auto-loaded (only the root one is), so reading it is real evidence of routing.
    name: "API-route task reads the server module map AND pulls the architecture-reviewer",
    prompt:
      "Я планую додати НОВИЙ, ще не реалізований ендпоінт GET /reviews/:id/export (віддає ревʼю як " +
      "markdown). Спершу звірся з конвенціями API цього репо. Потім ОБОВʼЯЗКОВО запусти сабагента " +
      "architecture-reviewer, щоб він оцінив мій план на відповідність onion-шарам — не рецензуй сам.",
    expectFilesRead: ["server/CLAUDE.md"],
    expectSubagents: ["architecture-reviewer"],
    maxTurns: 8,
  },

  // --- trace (1 session): two "Read When" rows at once -----------------------------------------
  {
    kind: "trace",
    // Tests the CLAUDE.md routing, so the prompt must push toward CONSULTING the docs, not
    // exploring source. Earlier phrasing ("розберись, як усе влаштовано") sent the model straight
    // into schema.ts / run.ts and it never opened the routed doc.
    //
    // Asserts docs/specs, NOT reviewer-core/docs/pipeline.md: reviewer-core/docs/ holds only its
    // README here, so the old target was unreachable. The rule this repo really states is the
    // root CLAUDE.md "## Feature documents" section — work starts from a spec (what/why) before
    // code. Asserting the directory prefix rather than one filename keeps it from breaking again
    // when a spec is added. One anchor only: asserting two docs in one session is inherently flaky.
    name: "a new pipeline feature follows CLAUDE.md routing to the specs",
    prompt:
      "Я збираюся додати нову можливість у review pipeline. Перш ніж торкатися коду — звірся з " +
      "настановами цього репо (CLAUDE.md) щодо того, що саме треба підготувати ПЕРЕД написанням " +
      "коду, і прочитай документ, який описує цей крок.",
    expectFilesRead: ["docs/specs"],
    maxTurns: 8,
  },

  // --- trace (1 session): "Hit unexpected behavior" routing -> the module's insights ------------
  // Was a contrast case, but the control run (empty tmpdir) could still reach the real repo by
  // absolute path, making the negative flaky. As a single-session trace it checks the same rule.
  //
  // Asserts reviewer-core/insights.md, NOT reviewer-core/insights/gotchas.md — this repo keeps one
  // insights file per module, not an insights/ directory. reviewer-core/CLAUDE.md states the rule
  // outright ("Before starting work here, read insights.md"), so this is the sharpest routing
  // assertion available: the model must open the module map to learn the file exists at all.
  {
    kind: "trace",
    name: "CLAUDE.md routes an unexpected-behavior lookup to reviewer-core/insights.md",
    prompt:
      "У reviewer-core я стикнувся з несподіваною поведінкою — щось працює не так, як я очікував. " +
      "За настановами цього репо, де це вже могло бути задокументовано? Прочитай той файл.",
    expectFilesRead: ["reviewer-core/insights.md"],
    maxTurns: 5,
  },

  // --- activation pair (2 sessions): positive + near-miss negative ------------------------------
  {
    kind: "activation",
    name: "engineering-insights activates on a genuine discovery",
    prompt:
      "Щойно з'ясував, чому pgvector-запит повертав нуль рядків — розмірність колонки не збіглася " +
      "після зміни моделі ембедингів. Хочу це зафіксувати, щоб більше не наступати.",
    skill: "engineering-insights",
    shouldActivate: true,
    maxTurns: 4,
  },
  {
    kind: "activation",
    name: "near-miss negative — explaining the same topic must NOT record an insight",
    prompt:
      "Поясни, як у pgvector працюють розмірності колонок і чому невідповідність повертає нуль рядків.",
    skill: "engineering-insights",
    shouldActivate: false,
    maxTurns: 4,
  },
];
