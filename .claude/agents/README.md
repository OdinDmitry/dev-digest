# .claude/agents/ — agent map

Custom subagents available in this repo. This file is a map, not a copy —
for exact behavior read each agent's own file.

| Agent | Responsibility | Tools | Skills preloaded | Model | Input | Output |
|---|---|---|---|---|---|---|
| [researcher.md](researcher.md) | Answers a specific research question — repo search or external/web — without writing code | `Glob, Grep, Read, WebFetch, WebSearch` | none | sonnet | A concrete research question (internal, external, or both) | Text report in the reply (`## Query / Findings / Evidence / References / Could not determine`) — no file written |
| [planner.md](planner.md) | Turns a feature/task description into a structured Development Plan; names which project skills the implementer must apply per step. Does not touch implementation code | `Read, Grep, Glob, Write` | `onion-architecture, frontend-ui-architecture, drizzle-orm-patterns, postgresql-table-design, zod, security, engineering-insights` | opus | A feature/task description, scoped to one bounded goal | `specs/000N-<slug>.md` at repo root (or reply asking for clarification if the task is too vague) + a short summary reply linking to the file |
| [implementer.md](implementer.md) | Executes an existing Development Plan across frontend/backend, applying the skills the plan names and running the affected modules' tests/typecheck. Does not perform architecture or security review | `Read, Grep, Glob, Edit, Write, Bash` | `fastify-best-practices, next-best-practices, react-best-practices, react-testing-library, drizzle-orm-patterns, postgresql-table-design, zod, onion-architecture, frontend-ui-architecture, security, typescript-expert, engineering-insights` (every project engineering-convention skill) | sonnet | Path to a Development Plan file (`specs/000N-*.md`, root or module-level) | Code changes scoped to the plan's file list + a structured report (`## Plan reference / Steps completed / Tests run & results / Scope deviations / Note`) |
| [test-writer.md](test-writer.md) | Writes and extends tests for existing client/server code and runs the module's test command; never edits implementation code | `Read, Grep, Glob, Edit, Write, Bash` | `react-testing-library, fastify-best-practices, zod, typescript-expert, engineering-insights` | sonnet | A component/module/behavior to cover, or a plan step calling for tests | New/extended test files + a report (`## Code under test / Tests added / Commands run & results / Cases left uncovered / Note`) |
| [architecture-reviewer.md](architecture-reviewer.md) | Reviews written code for layering and import-direction violations; evidence-backed findings only, no generic advice. Read-only | `Read, Grep, Glob, Bash` (git inspection only) | `onion-architecture, frontend-ui-architecture, engineering-insights` | opus | A diff, a file list, or a module to review | Plain-text findings report in the reply (`## Scope reviewed / Findings (file:line) / Checked and clean / Not assessed`) — no file written |
| [plan-verifier.md](plan-verifier.md) | Checks implemented code against every item of a Development Plan and runs the plan's own Verification commands; reports gaps, not style preferences. Read-only | `Read, Grep, Glob, Bash` | none | opus | Path to a Development Plan whose implementation is finished | Per-step verdict table + gaps/scope report in the reply — no file written |
| [doc-writer.md](doc-writer.md) | Turns an implemented feature or a shipped plan into documentation with diagrams, placed per the per-module `docs/` topic-index convention | `Read, Grep, Glob, Write, Edit` | `mermaid-diagram, engineering-insights` | sonnet | An implemented feature and/or a Development Plan to document | `<module>/docs/<topic>.md` + a `CLAUDE.md` "Further reading" link + a short report |

None of the seven agents has the `Skill` tool — their skills are preloaded
in full via the `skills:` frontmatter field instead, so no tool call is
needed to fetch a skill's content mid-task. `planner` gets the
architecture/placement-decision skills it needs to ground the plan;
`implementer` gets the full engineering-convention catalog, since a plan
step can land in either stack and it shouldn't miss applying a convention
because a skill wasn't loaded; `test-writer` gets the client/server testing
conventions plus `zod`/`typescript-expert` for fixtures; `architecture-reviewer`
gets the two layering skills it checks against; `doc-writer` gets the
diagram skill and the insights-boundary skill. `plan-verifier` and
`researcher` preload nothing on purpose: `plan-verifier` checks falsifiable
claims against the plan rather than whether a convention was applied
correctly, so it has no need for the convention skills; `researcher`
answers open-ended questions where the relevant skill can't be predicted in
advance.

## How the agents connect

`planner` writes the plan to a file; `implementer` reads that same file as
its single source of truth and executes it; `test-writer` covers the
implemented behavior with tests; `plan-verifier` checks the implementation
against that same plan file; `architecture-reviewer` checks the result's
layering and import direction; `doc-writer` turns the shipped work into
module documentation. They hand off through artifacts — the plan file, the
code, the docs — not through conversation. A plan that spans more than one
module goes in the root [specs/](../../specs/README.md); a single-module plan
goes in that module's own `specs/` ([server/specs](../../server/specs/README.md),
[client/specs](../../client/specs/README.md)). Architecture and security
review are out of scope for `planner` and `implementer` by design:
`architecture-reviewer` now owns the architecture half; no Claude Code
security-review subagent exists yet, so the `security` skill and
`pr-self-review` cover that ground for now.

## Sources behind the agents' rules

- [Create custom subagents](https://code.claude.com/docs/en/sub-agents) —
  least-privilege `tools` allowlisting, one-agent-one-task design, and the
  `skills:` frontmatter field that preloads a skill's full content into a
  subagent's context at startup instead of requiring a `Skill`-tool fetch.
  Also the source for read-only reviewer tool scoping (`tools: Read, Grep,
  Glob`, or `Read, Grep, Glob, Bash` with Bash included only to run `git
  diff`, still excluding `Edit`/`Write`; `disallowedTools: Write, Edit`
  documented as an alternate denylist mechanism — this repo prefers the
  allowlist), and for output-shaped scoping of a file-writing agent (`Bash,
  Read, Write` in the documented `data-scientist` example). Grounds each
  agent's `tools:`/`skills:` lines, the "sole responsibility" framing at the
  top of each prompt, `architecture-reviewer`/`plan-verifier` being
  read-only, and `doc-writer`'s tool list.
- [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices) —
  self-contained specs (files/interfaces named, out-of-scope stated,
  ends with verification); Plan Mode discipline (stop and surface
  discrepancies instead of improvising); adversarial review ("the agent
  doing the work isn't the one grading it"). Also the source for "Add an
  adversarial review step" — review the diff against the plan, check every
  requirement is implemented, that listed edge cases have tests, and that
  nothing outside scope changed, reporting gaps rather than style
  preferences — and for the caution that a reviewer prompted to find gaps
  will report some even when the work is sound, so it must be told to flag
  only gaps affecting correctness/stated requirements. Also "Give Claude a
  way to verify its work → by a second opinion": the agent doing the work
  isn't the one grading it. Grounds planner's plan template and
  stop-on-mismatch rule, implementer's stop-on-mismatch rule and
  architecture/security-out-of-scope stance, `plan-verifier` end to end, and
  `architecture-reviewer`'s findings discipline.
- [How and when to use subagents in Claude Code](https://claude.com/blog/subagents-in-claude-code) —
  `description` written around trigger conditions, not just capabilities;
  subagents hand off through artifacts, not live dialogue. Also the source
  for a review subagent's output being a prioritized list of findings with
  `file:line` references and a recommended fix for each. Grounds the
  "Use ..." clause in each `description`, the file-based handoff, and
  `architecture-reviewer`'s findings format.
- [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) —
  third-person, specific (not vague) descriptions. Grounds the phrasing of
  both `description` fields.
- [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) —
  a subagent task needs an objective, output format, tool guidance, and
  explicit boundaries to avoid duplicated/contradictory downstream work.
  Grounds the plan template's mandatory `Goal` / per-step required skill /
  `done when` / `Verification` fields.
- [When to use multi-agent systems (and when not to)](https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them) —
  caution against role-splitting causing coordination overhead/information
  loss; mitigated here by making the plan file (not chat) the shared
  context. Also the source for verification subagents needing concrete,
  falsifiable criteria ("run the full test suite and report all failures",
  not "make sure it works"), or they take shortcuts. Informs why planner's
  final reply links the file instead of repeating its contents, and grounds
  `plan-verifier` running the plan's commands itself.
- [Tools reference](https://code.claude.com/docs/en/tools-reference) —
  `ReportFindings` is a real built-in tool (file / summary / failure_scenario
  / optional category per finding), but its only documented invocation path
  is Claude calling it inside the bundled `/code-review` pipeline in a host
  app that requested a findings list; no official documentation shows a
  custom subagent listing it in its own `tools:`. Recorded as the reason
  `architecture-reviewer` uses a plain-text findings report instead.
- In-repo prior art, [`docs/agent-prompts/README.md`](../../docs/agent-prompts/README.md)
  and [`general-reviewer.md`](../../docs/agent-prompts/general-reviewer.md) —
  findings-discipline prose (distinct findings only, no padding toward a
  count, zero findings is a valid answer, cite an exact `file:line`) reused
  by `architecture-reviewer` and `plan-verifier`. Their *mechanism* —
  DB-stored prompts assembled by `reviewer-core/src/prompt.ts` with
  JSON-schema-constrained output — is deliberately not copied, since a
  Claude Code subagent has no output schema.
- In-repo convention, the per-module `docs/README.md` topic indexes
  ([server/docs/README.md](../../server/docs/README.md),
  [client/docs/README.md](../../client/docs/README.md),
  [reviewer-core/docs/README.md](../../reviewer-core/docs/README.md),
  [e2e/docs/README.md](../../e2e/docs/README.md)) — grounds `doc-writer`'s
  placement logic. No Anthropic documentation addresses a subagent choosing
  its own output file location, and none mentions diagrams at all, so this
  is the repo's own answer rather than a sourced practice.

Two rules are this design's own extrapolation rather than a directly
sourced Anthropic practice — see planner's Step 4 (planner should ground
its plan in the implementer's actual skill catalog) and implementer's lack
of the `Agent` tool (structurally prevents it from self-invoking review
agents). Both follow from the sourced principles above but aren't
verbatim-documented anywhere. Three further points from the newer agents
are likewise this repo's own extrapolation, not a directly sourced
Anthropic practice: (a) `doc-writer`'s documentation placement and diagram
usage are unsourced — no Anthropic documentation addresses a subagent
choosing its own output file location, and none mentions diagrams at all,
so both are grounded entirely in this repo's own conventions per the bullet
above; (b) `test-writer`'s "test files only" boundary is enforced by prompt
text, because Claude Code's `tools:` allowlist cannot scope a tool to a
path; (c) the same applies to `architecture-reviewer`'s "git inspection
only" restriction on `Bash` and `doc-writer`'s "`CLAUDE.md` Further-reading
section only" restriction on `Edit`.
