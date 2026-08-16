# Development Plan: four new Claude Code subagents (test-writer, architecture-reviewer, plan-verifier, doc-writer)

## Goal

Add four custom Claude Code subagent definitions under `.claude/agents/` —
`test-writer`, `architecture-reviewer`, `plan-verifier`, `doc-writer` — that
extend the existing `planner` → `implementer` chain with test authoring,
architectural boundary review, plan-conformance verification, and
documentation generation. Each new file must match the frontmatter shape
(`name`, `description`, `tools`, `skills`, `model`) and prompt body shape
(role framing → numbered `## Step N` sections → `## Final report` fenced
block) already used by [`implementation-planner.md`](../../.claude/agents/implementation-planner.md),
[`implementer.md`](../../.claude/agents/implementer.md) and
[`researcher.md`](../../.claude/agents/researcher.md) — no new frontmatter
fields, no new prompt structure. `.claude/agents/README.md` gains one table
row per new agent plus new/extended `Sources` bullets, in its existing style.
This is meta-work on the repo's own Claude Code tooling; no application code
in `server/`, `client/`, `reviewer-core/` or `e2e/` changes.

## Out of scope

- **Creating the four `.claude/agents/*.md` files as part of writing this
  plan.** File creation is a follow-up step for a separate agent/session,
  pending user review of this plan (in particular the two flagged open
  questions below).
- Editing the three existing agent files (`planner.md`, `implementer.md`,
  `researcher.md`). Their prompts already delegate architecture/security
  review to "separate agents/skills" generically; no rewiring is needed for
  the new agents to be usable. If the user later wants `implementer`'s final
  report to name `plan-verifier` explicitly, that is a separate change.
- Adding, editing or renaming any skill under `.claude/skills/` — including
  fixing the `node:test` vs Vitest mismatch noted under Constraints.
- Any change to root `CLAUDE.md`, `.claude/skills/README.md`, or the
  DB-stored product prompts in `docs/agent-prompts/` (`general-reviewer`,
  `security-reviewer`, `performance-reviewer`, `test-quality-reviewer`) and
  their seed source `server/src/db/seed-prompts.ts`. Those are DevDigest's
  *product* review agents, a different mechanism entirely — see Constraints.
- A fifth subagent (e.g. a Claude Code `security-reviewer`). Not requested;
  do not add one opportunistically.
- Writing any actual test, doc, or review output with the new agents beyond
  the smoke checks listed under Verification.

## Constraints

- **Frontmatter shape is fixed by precedent.** Exactly the fields the three
  existing agents use: `name`, `description`, `tools`, `skills` (omit the
  line entirely when no skills are preloaded, as `researcher.md` does),
  `model`. Do **not** introduce `disallowedTools`, `ReportFindings`, or any
  other field/tool not already present in this repo's agent files.
- **`tools:` is an allowlist, and none of the new agents gets the `Skill`
  tool.** Skills arrive preloaded in full via `skills:`, per the paragraph
  under the README table. Every new prompt body must repeat that framing the
  way `planner.md`/`implementer.md` do ("preloaded in full above … there is
  no `Skill` tool here").
- **Every skill named in a `skills:` line must exist** in the catalog at
  `.claude/skills/README.md`: `onion-architecture`, `fastify-best-practices`,
  `drizzle-orm-patterns`, `postgresql-table-design`, `frontend-ui-architecture`,
  `next-best-practices`, `react-best-practices`, `react-testing-library`,
  `zod`, `typescript-expert`, `security`, `pr-self-review`, `mermaid-diagram`,
  `engineering-insights`. No other names are valid.
- **Do not restate skill-owned rules inside a prompt body.** A prompt names
  the skill and states only repo facts no skill carries (test file locations,
  the `*.it.test.ts` suffix, the `docs/` topic-index convention). Restated
  rules drift away from the skill they were copied from.
- **`docs/agent-prompts/*` is a different machine — borrow prose, not
  mechanism.** Those prompts are stored on `agents.system_prompt` in the DB,
  assembled by `reviewer-core/src/prompt.ts`, and their output shape is
  enforced out of band by a JSON schema (`response_format: json_schema,
  strict: true`), which is why `docs/agent-prompts/README.md` forbids
  describing the output shape in prose. A Claude Code subagent has **no**
  such schema, so `architecture-reviewer` and `plan-verifier` must specify
  their plain-text report format explicitly in the prompt. What *is* worth
  borrowing verbatim in spirit is the findings-discipline prose from
  `docs/agent-prompts/general-reviewer.md` (distinct findings only, no
  padding toward a count, zero findings is a valid answer, cite an exact
  `file:line` that really exists). Do not copy `verdict`/`score`/`kind`/
  `trifecta_components` vocabulary — those fields exist only in the Zod
  `Review` contract and mean nothing here.
- **Test conventions come from the repo, not from the skill's examples.**
  `server/` and `client/` both run **Vitest** (`describe`/`it`/`expect`).
  `.claude/skills/fastify-best-practices/rules/testing.md` illustrates
  `inject()` using `node:test` + `t.assert.*`; the *convention* to take from
  it is `app.inject()` against `buildApp()`, not the `node:test` runner. See
  Open questions.
- Server tests live in `server/test/*.test.ts` (**not** colocated), DB-backed
  ones **must** use the `*.it.test.ts` suffix (`server/CLAUDE.md`); everything
  else stays hermetic against `src/adapters/mocks.ts`. Client tests are
  colocated `*.test.tsx` next to the component in `src/app/**/_components/<Name>/`,
  vitest + jsdom with `fetch` mocked (`client/CLAUDE.md`). `reviewer-core`
  tests live in `reviewer-core/test/*.test.ts`, hermetic with a stubbed
  `LLMProvider`.
- Documentation placement follows the repo's own per-module topic index:
  `server/docs/README.md`, `client/docs/README.md`,
  `reviewer-core/docs/README.md`, `e2e/docs/README.md` all state "one file per
  topic, named after the topic", added "when a piece of … behavior needs more
  explanation than a map entry", and "link it from `CLAUDE.md`" ("Further
  reading" section). Root `docs/` is **not** a general documentation dump — it
  currently holds only `agent-prompts/` and `skill-fixtures/`, and has no
  index README.
- Root `specs/` currently contains only `README.md`; this plan is
  `specs/0001-four-claude-code-subagents.md`, the first plan file.
- Environment is Windows / PowerShell; verification commands below are given
  in PowerShell form where they are shell-specific.
- Course-starter conventions from root `CLAUDE.md` still apply (don't
  repurpose unused tables, vendored copies are copies) — nothing in this plan
  touches them.
- Do-not-touch: `server/src/db/migrations/` (irrelevant here, listed for
  completeness).

## Affected modules & files

Everything below lives outside the four application packages.

- **`.claude/agents`**: `test-writer.md` — **new file**, agent that authors
  client/server tests and runs the module's test command.
- **`.claude/agents`**: `architecture-reviewer.md` — **new file**, read-only
  boundary/layering reviewer.
- **`.claude/agents`**: `plan-verifier.md` — **new file**, item-by-item
  Development Plan conformance checker.
- **`.claude/agents`**: `doc-writer.md` — **new file**, documentation
  generator with Mermaid diagrams and repo-convention file placement.
- **`.claude/agents`**: `README.md` — **edited**: four new table rows, the
  preloading paragraph extended to cover the new agents, the
  "How planner and implementer connect" section extended into the full agent
  chain, and the `Sources` section extended (existing bullets amended + new
  bullets added).
- **`specs/`**: `0001-four-claude-code-subagents.md` — this plan (already
  written; the follow-up agent reads it, does not edit it).

Unchanged by design: `.claude/agents/planner.md`,
`.claude/agents/implementer.md`, `.claude/agents/researcher.md`,
`.claude/skills/**`, root `CLAUDE.md`, all four module packages.

---

## Steps

Steps 1–4 create one agent file each; steps 5–7 update the README; step 8 is
verification. Each new file follows the same three-part body shape as the
existing agents: (a) a role-framing paragraph naming the sole responsibility
and what the agent explicitly does *not* do, (b) a paragraph stating that the
`skills:` listed in frontmatter are preloaded in full and there is no `Skill`
tool, (c) numbered `## Step N — <verb phrase>` sections, ending with a
`## Final report` section containing a fenced markdown template.

### 1. [.claude/agents] `test-writer.md` — required skill(s): `react-testing-library`, `fastify-best-practices` (as reference for what the prompt points at), `engineering-insights` — done when: the file exists with the frontmatter and body below and `name: test-writer` matches the filename.

**Frontmatter (exact values):**

- `name: test-writer`
- `tools: Read, Grep, Glob, Edit, Write, Bash`
  (`Write`/`Edit` for test files, `Bash` to run the module's test command.
  The *test-files-only* restriction is enforced in the prompt body — Claude
  Code's `tools:` allowlist cannot scope a tool to a path. Say this plainly
  in the prompt so the agent knows the boundary is its own responsibility.)
- `skills: react-testing-library, fastify-best-practices, zod, typescript-expert, engineering-insights`
  - `react-testing-library` — governs every client component test.
  - `fastify-best-practices` — the `app.inject()` convention for route tests.
  - `zod` — **included**: server routes validate through
    `fastify-type-provider-zod`, and fixtures are built against the vendored
    `@devdigest/shared` contracts, so tests routinely assert on
    validation-failure responses and construct contract-shaped objects.
  - `typescript-expert` — **included**: fixtures, generics and type-level
    assertions in test files are TypeScript work like any other.
  - `engineering-insights` — **included**: mandatory per project convention;
    the agent must read the owning module's `insights.md` before writing, and
    may append at session end under an exact existing heading.
  - `react-best-practices`, `next-best-practices`, `onion-architecture` —
    **excluded**: test-writer does not author components or decide placement.
    The one piece of onion guidance it needs (rings 0–2 hermetic, ring 3 →
    `*.it.test.ts`) is written into the prompt body as two sentences instead
    of preloading the whole skill.
- `model: sonnet` (execution-shaped work, matching `implementer`).
- `description`: third person, role + explicit trigger clause. Must state:
  writes/extends tests for code that already exists; client = Vitest + jsdom +
  React Testing Library in colocated `*.test.tsx`; server = Vitest in
  `server/test/`, `app.inject()` against `buildApp()`, `*.it.test.ts` only for
  DB-backed; runs the module's `pnpm test` and reports the result; only
  creates/edits test files and test helpers, never implementation code, and
  never changes the code under test to make a test pass; "Use after a feature
  or fix is implemented and needs coverage, when a plan step calls for tests,
  or when asked to add tests to an existing module."

**Body steps:**

0. *Locate the code under test.* Identify the owning module, read its
   `CLAUDE.md` and `insights.md` (per the preloaded `engineering-insights`
   skill). If the target is ambiguous, ask before writing.
1. *Choose test type and location.* Client component → colocated
   `<Name>.test.tsx` beside the component under
   `client/src/app/**/_components/<Name>/`. Server pure logic/helpers →
   `server/test/<topic>.test.ts`, hermetic against `src/adapters/mocks.ts`.
   Server route or DB-backed behavior → `server/test/<topic>.it.test.ts` using
   `buildApp()` + `app.inject()`. `reviewer-core` → `reviewer-core/test/*.test.ts`,
   hermetic with a stubbed `LLMProvider`. State the rule that DB-backed tests
   *must* carry `.it.test.ts` because CI splits on that suffix.
2. *Write the tests.* Apply `react-testing-library` for client tests
   (role/label queries, user-event, assert behavior not implementation) and
   the `inject()` convention from `fastify-best-practices` for server routes —
   but with **Vitest** (`describe`/`it`/`expect`), not `node:test`; call out
   that the skill's `rules/testing.md` examples use `node:test` and the repo
   does not. Existing files to point at as reference:
   `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.test.tsx`,
   `server/test/reviews.it.test.ts` (integration), `server/test/pulls-status.test.ts`
   (hermetic unit).
3. *Run and iterate.* Run the module's command (`cd client; pnpm test`,
   `cd server; pnpm test`) plus `pnpm typecheck`. Iterate on the **test**
   only. If a test fails because the implementation is wrong, **stop and
   report** — fixing implementation is `implementer`'s job.
4. *Assertion-quality self-check*, borrowing the bar from
   `docs/agent-prompts/test-quality-reviewer.md` as prose: would this test
   still pass if the code under test were stubbed out? Does it assert on a
   value the test itself computed? Does the title match what is actually
   asserted? No coverage-percentage talk.

**Final report block:**

```markdown
## Code under test
## Tests added / extended
- `path/to/file.test.ts(x)` — what behavior it pins down
## Commands run & results
- `command` — pass/fail, key output
## Cases deliberately left uncovered
## Note
Implementation code was not modified. Test-quality, architecture and security
review are out of scope here — run the dedicated agent(s)/skill(s).
```

### 2. [.claude/agents] `architecture-reviewer.md` — required skill(s): `onion-architecture`, `frontend-ui-architecture` (as reference for the checks the prompt enumerates) — done when: the file exists with the frontmatter and body below and contains no `Edit`/`Write` in `tools:`.

**Frontmatter (exact values):**

- `name: architecture-reviewer`
- `tools: Read, Grep, Glob, Bash`
  `Bash` is included **only** so the agent can scope a review to a change set
  (`git diff`, `git diff --stat`, `git status`, `git log`) — the prompt must
  restrict it to read-only git inspection in so many words. `Edit`/`Write` are
  absent by design; the allowlist form is preferred over the documented
  `disallowedTools` denylist because all three existing agents in this repo
  use allowlists.
- `skills: onion-architecture, frontend-ui-architecture, engineering-insights`
  - `engineering-insights` — read-only use here: module `insights.md`
    "Codebase Patterns" records deliberate conventions that would otherwise
    look like violations. The agent has no `Write`, so it reports
    insight-worthy observations instead of appending them.
  - `security`, `typescript-expert`, `react-best-practices` — excluded;
    security review and code-quality review are other agents' jobs and the
    prompt must say so rather than drifting into them.
- `model: opus` (judgment-heavy review, matching `planner`).
- `description`: must name the trigger, not just the capability. State:
  reviews already-written code for architectural boundary violations — ring
  placement and import direction on the backend (`server/`, `reviewer-core/`)
  per `onion-architecture`, folder and dependency-direction rules on the
  client per `frontend-ui-architecture`; reports only violations backed by a
  concrete `file:line`, never generic advice; treats `onion-architecture`'s
  accepted-violations list as grandfathered rather than as new findings;
  read-only (cannot edit or write any file); "Use after a feature is
  implemented or before opening a PR, when the question is whether the code
  sits in the right layer/folder and imports in the allowed direction. Does
  not perform security or test-quality review."

**Body steps:**

0. *Establish scope.* A diff (`git diff` / `git diff main...HEAD`), an explicit
   file list, or a named module. If the scope is unclear, ask — do not review
   the whole repo by default. `Bash` is for read-only git inspection only.
1. *Load module context.* The owning module's `CLAUDE.md` (including its
   "Non-default conventions") and `insights.md`.
2. *Backend checks* (`server/`, `reviewer-core/`), per `onion-architecture`:
   ring placement per file; the four import rules (fastify only in
   `routes.ts`/`app.ts`/`modules/index.ts`/`modules/_shared/context.ts`;
   drizzle + `db/schema.js` only in `db/**` and repositories; row types never
   crossing into `service.ts`/`routes.ts`; SDKs only inside
   `adapters/<name>/*` behind a port); ring 4 skipping ring 2/3; module
   anatomy; new services taking explicit deps rather than `Container`;
   adapters constructed only in `platform/container.ts`.
3. *Frontend checks* (`client/`), per `frontend-ui-architecture`: dependency
   direction (shared → features → app), sibling-feature imports, premature
   extraction to a shared folder with one consumer, broad barrels, server
   state mirrored into a client store, business logic in a component body —
   plus this repo's own conventions from `client/CLAUDE.md` (pages stay thin,
   feature logic in colocated `_components/`, data fetching only through
   `src/lib/hooks/*`).
4. *Findings discipline*, in the prose style of
   `docs/agent-prompts/general-reviewer.md`: report only **distinct**
   violations; never pad toward a count — there is no minimum or target and
   **zero findings is a valid, good answer**; every finding cites an exact
   `path/file.ts:line-range` the agent actually read; no style nits; flag only
   what affects the boundary rules or a stated project convention, since a
   reviewer asked to find gaps will invent them otherwise. Explicitly do
   **not** report the grandfathered violations listed in
   `onion-architecture` ("Accepted violations": `pulls`/`polling`/`settings`/
   `workspace` querying inside `routes.ts`, the four services taking
   `Container`, row types in ring-2 signatures in `reviews`/`repos`) as new
   findings — only flag them when the reviewed change *extends* one. Security
   and test-quality issues are out of scope: name the right agent/skill
   instead of reviewing them here.

**Final report block** (plain text — see the `ReportFindings` note under Open
questions):

```markdown
## Scope reviewed
[diff / file list / module, and how it was obtained]

## Findings
### [CRITICAL|WARNING|SUGGESTION] <short title> — `path/file.ts:120-134`
- Rule violated: [ring/import/dependency-direction rule, named]
- Evidence: [what the code actually does, quoted or paraphrased from the file]
- Suggested fix: [where the code should live / which direction the dependency
  should point]

## Checked and clean
- [boundary rules verified with nothing to report]

## Not assessed
- [security, test quality, performance — and which agent/skill owns each]
```

Severity vocabulary is `CRITICAL` / `WARNING` / `SUGGESTION` for consistency
with the repo's other reviewer prose; the prompt must state there is no
`verdict`, no `score` and no JSON here — those belong to the DB-stored product
prompts only.

### 3. [.claude/agents] `plan-verifier.md` — required skill(s): none preloaded (see below); the prompt references `implementer.md`'s report shape as structural precedent — done when: the file exists with the frontmatter and body below and its report template contains a per-plan-step table.

**Frontmatter (exact values):**

- `name: plan-verifier`
- `tools: Read, Grep, Glob, Bash`
  `Bash` is required — the whole point is to run the plan's own Verification
  commands rather than trust `implementer`'s self-report — plus `git diff
  --stat` for the scope check. No `Edit`/`Write`: it verifies, it does not fix,
  and it must not edit the plan either.
- **no `skills:` line** (as in `researcher.md`). Rationale to state in the
  plan-verifier prompt itself: the plan names the skills each step must apply,
  but judging *whether a convention was applied correctly* is
  `architecture-reviewer`'s / `pr-self-review`'s job. plan-verifier checks
  observable, falsifiable claims — the file exists, the behavior is
  implemented, the test exists and passes, nothing outside the plan's file
  list changed — and routes convention questions elsewhere.
- `model: opus` (adversarial second opinion; the value is a fresh, capable
  reviewer that did not do the work).
- `description`: state that it checks implemented code against a written
  Development Plan (`specs/000N-*.md` at the repo root or a module's
  `specs/`), item by item: every plan step, its "done when" condition, the
  plan's Out-of-scope list and its Verification commands, **which it runs
  itself**; produces a per-step verdict table with `file:line` evidence plus
  any change made outside the plan's file list; reports gaps that affect
  correctness or a stated plan requirement, not style preferences; never
  substitutes a free-form re-review for the item-by-item check; read-only
  apart from running commands; "Use after `implementer` finishes a plan,
  before the change is considered done."

**Body steps:**

0. *Load the plan.* Use the path given; otherwise find the most relevant file
   under root `specs/` or the module's `specs/`. If no plan exists, **stop** —
   without a plan there is nothing to verify, and free-form review is a
   different agent's job.
1. *Build the checklist first.* Enumerate every numbered plan step, its "done
   when" clause, every bullet in "Out of scope", and every command under
   "Verification" — **before** reading the implementation, so the checklist
   cannot be shaped retroactively by what the code happens to do. Every plan
   step gets a row in the final table, including ones that look trivially
   satisfied.
2. *Gather evidence per item.* Read the files the step names; grep for the
   symbols it names. An item may be marked `implemented` **only** with a
   concrete `path/file.ts:line-range` or a command that actually passed.
   "Looks fine" is not evidence; `partial` and `missing` are normal outcomes.
3. *Run the plan's Verification commands verbatim* and report their real
   output. Never write "should pass" — if a command could not be run (missing
   Docker, no DB), say so under "Not verifiable" instead of assuming either
   outcome.
4. *Scope check.* Compare `git diff --stat` against the plan's file list:
   list files touched that the plan never named, and files the plan named that
   were never touched.
5. *Gap discipline.* Flag only gaps that affect correctness or a stated plan
   requirement — a verifier prompted to find gaps will report some even when
   the work is sound. Style preferences and improvement ideas go under
   "Optional observations" or nowhere. **Zero gaps is a valid result.** Never
   edit the plan or the code; if the *plan itself* is wrong or outdated,
   report that as a plan gap and route it back to `planner`.

**Final report block** (adapting the `## Plan reference / Steps … ` shape from
`implementer.md`):

```markdown
## Plan reference
[path to the plan file]

## Per-step verdict
| # | Plan step (abridged) | Status | Evidence |
|---|---|---|---|
| 1 | [module] `file.ts` — … | implemented / partial / missing / deviates | `path/file.ts:12-40` |

## Verification commands run
- `command` — pass/fail, key output

## Gaps (correctness / stated requirement only)
- [gap] — plan step #N — evidence

## Changes outside the plan's file list
- `path/file.ts` — what changed, and whether the plan covers it

## Not verifiable
- [item] — why (command could not run, evidence not reachable from the repo)

## Optional observations
- [non-blocking; explicitly not gaps]
```

### 4. [.claude/agents] `doc-writer.md` — required skill(s): `mermaid-diagram`, `engineering-insights` (as reference for what the prompt points at) — done when: the file exists with the frontmatter and body below and its placement rules name the four module `docs/` directories explicitly.

**Frontmatter (exact values):**

- `name: doc-writer`
- `tools: Read, Grep, Glob, Write, Edit`
  Output-shaped scope: `Read`/`Grep`/`Glob` to find the feature code and the
  existing docs, `Write` for the new doc file, `Edit` for the one narrow
  edit it is allowed to make (adding a link to the owning module's `CLAUDE.md`
  "Further reading" section and, where one exists, the module
  `docs/README.md` index). **`Bash` is deliberately omitted** — the inputs are
  the plan file and the code in the working tree, both reachable with
  `Read`/`Grep`/`Glob`; per least privilege, only add it later if documenting
  historical changes from `git log` becomes a real requirement.
- `skills: mermaid-diagram, engineering-insights`
  - `mermaid-diagram` — diagram syntax; no Anthropic guidance exists on
    diagrams in subagents, so this in-repo skill is the whole basis.
  - `engineering-insights` — so the agent can tell insight-material (a
    non-obvious discovery → `insights.md`, append-only, fixed headings) from
    documentation-material (an explanation → `docs/`). The prompt must state
    that doc-writer does **not** write `insights.md` — that belongs to the
    agent that did the work, at session end — and instead surfaces any
    insight-worthy observation in its final report.
- `model: sonnet` (generative writing, matching `implementer`).
- `description`: role + trigger. State: turns finished work — an implemented
  feature, or a Development Plan that has shipped — into documentation, with
  Mermaid diagrams where a diagram explains more than prose; places each
  document per this repo's convention (one file per topic in the owning
  module's `docs/`, named after the topic, linked from that module's
  `CLAUDE.md` "Further reading"); writes documentation only — never
  implementation code, tests, or plan files; "Use after a feature is
  implemented and its behavior needs more explanation than a `CLAUDE.md` map
  entry, or when asked to document an existing part of the system."

**Body steps:**

0. *Establish subject and sources.* A plan file, the feature code, or both.
   Ask if the subject is unclear rather than documenting the wrong thing.
1. *Identify the owning module* and read its `CLAUDE.md`, package `README.md`,
   `docs/README.md` and `insights.md`, so the new doc neither duplicates the
   map nor contradicts recorded conventions.
2. *Decide placement*, per the repo's own convention (not per any external
   guidance — none exists):
   - One file per topic, kebab-case, named after the topic, in the owning
     module's `docs/`: `server/docs/`, `client/docs/`, `reviewer-core/docs/`,
     `e2e/docs/`.
   - Write a doc only when the behavior needs more explanation than a
     `CLAUDE.md` map entry or the package `README.md` overview — do not
     restate either.
   - A cross-module feature gets one file per owning module, each covering
     that module's side, rather than one file in a shared location.
   - Root `docs/` currently holds only `agent-prompts/` and `skill-fixtures/`
     and has no index — it is not a general documentation dump. If material
     genuinely belongs there, **stop and ask** instead of inventing a layout.
   - Prefer extending an existing topic file over creating a near-duplicate.
3. *Write the document.* Describe behavior as actually implemented, verified
   by reading the code; cite `path/file.ts` for each mechanism described. Use
   `mermaid-diagram` only where a diagram carries more than the equivalent
   prose (a flow with branches, a sequence across packages, a schema
   relationship). Keep one file to one topic.
4. *Link it.* Add the link to the owning module's `CLAUDE.md` "Further
   reading" section — this is the **only** `CLAUDE.md` edit doc-writer may
   make, it must touch no other section of that file, and it must be reported
   explicitly. Never touch code, tests, plan files, or `insights.md`.

**Final report block:**

```markdown
## Subject documented
## Files written
- `module/docs/<topic>.md` — what it covers, why it earned its own file
## Links added
- `module/CLAUDE.md` — "Further reading" entry
## Diagrams
- [diagram type] — what it shows
## Insight-material spotted (not written)
- [anything that belongs in `insights.md` per engineering-insights, for the
  working agent to append at session end]
## Note
No implementation code, tests, or plan files were modified.
```

### 5. [.claude/agents] `README.md` — table rows — required skill(s): none (documentation edit; match the existing table's tone and column semantics) — done when: the table has 7 data rows and each new row's `Tools`/`Skills preloaded`/`Model` cells match that agent's frontmatter character-for-character.

Add four rows to the existing table, in the order `test-writer`,
`architecture-reviewer`, `plan-verifier`, `doc-writer` (placed after
`implementer.md`, i.e. roughly in workflow order), keeping all seven columns:
`Agent | Responsibility | Tools | Skills preloaded | Model | Input | Output`.

- **test-writer** — Responsibility: "Writes and extends tests for existing
  client/server code and runs the module's test command; never edits
  implementation code" · Tools: `` `Read, Grep, Glob, Edit, Write, Bash` `` ·
  Skills: `` `react-testing-library, fastify-best-practices, zod,
  typescript-expert, engineering-insights` `` · Model: sonnet · Input: "A
  component/module/behavior to cover, or a plan step calling for tests" ·
  Output: "New/extended test files + a report (`## Code under test / Tests
  added / Commands run & results / Cases left uncovered / Note`)".
- **architecture-reviewer** — Responsibility: "Reviews written code for
  layering and import-direction violations; evidence-backed findings only, no
  generic advice. Read-only" · Tools: `` `Read, Grep, Glob, Bash` (git
  inspection only) `` · Skills: `` `onion-architecture,
  frontend-ui-architecture, engineering-insights` `` · Model: opus · Input: "A
  diff, a file list, or a module to review" · Output: "Plain-text findings
  report in the reply (`## Scope reviewed / Findings (file:line) / Checked and
  clean / Not assessed`) — no file written".
- **plan-verifier** — Responsibility: "Checks implemented code against every
  item of a Development Plan and runs the plan's own Verification commands;
  reports gaps, not style preferences. Read-only" · Tools: `` `Read, Grep,
  Glob, Bash` `` · Skills: `none` · Model: opus · Input: "Path to a
  Development Plan whose implementation is finished" · Output: "Per-step
  verdict table + gaps/scope report in the reply — no file written".
- **doc-writer** — Responsibility: "Turns an implemented feature or a shipped
  plan into documentation with diagrams, placed per the per-module `docs/`
  topic-index convention" · Tools: `` `Read, Grep, Glob, Write, Edit` `` ·
  Skills: `` `mermaid-diagram, engineering-insights` `` · Model: sonnet ·
  Input: "An implemented feature and/or a Development Plan to document" ·
  Output: "`<module>/docs/<topic>.md` + a `CLAUDE.md` 'Further reading' link
  + a short report".

### 6. [.claude/agents] `README.md` — prose sections — required skill(s): none — done when: the preloading paragraph covers all agents and the workflow section describes the full chain.

- Extend the paragraph beginning "Neither `planner` nor `implementer` has the
  `Skill` tool" to cover all agents: none of them has the `Skill` tool; skills
  arrive preloaded via `skills:`; `plan-verifier` and `researcher` preload
  nothing on purpose (state each one's reason in half a sentence —
  plan-verifier checks falsifiable claims, not conventions).
- Rename "How planner and implementer connect" to cover the chain (e.g. "How
  the agents connect") and extend it: `planner` writes the plan file →
  `implementer` executes it → `test-writer` covers it → `plan-verifier` checks
  the implementation against the same plan file → `architecture-reviewer`
  checks boundaries → `doc-writer` turns the shipped work into module docs.
  Keep the existing points that agents hand off through artifacts (plan file,
  code, docs) rather than conversation, that a cross-module plan lives in root
  `specs/` while a single-module plan lives in the module's own `specs/`, and
  that architecture/security review stay out of scope for `planner` and
  `implementer` — now naming `architecture-reviewer` as the agent that owns
  the architecture half, and noting that no Claude Code security-review
  subagent exists yet (`security` skill / `pr-self-review` cover it for now).

### 7. [.claude/agents] `README.md` — Sources section — required skill(s): none — done when: every URL below appears in the section, each existing bullet still reads as one coherent statement, and no URL is duplicated across bullets.

Retitle "Sources behind planner/implementer's rules" so it covers all agents,
then:

- **Amend** the [Create custom subagents](https://code.claude.com/docs/en/sub-agents)
  bullet: also the source for read-only reviewer tool scoping (`tools: Read,
  Grep, Glob`, or `Read, Grep, Glob, Bash` with Bash included only to run
  `git diff`, still excluding `Edit`/`Write`; `disallowedTools: Write, Edit`
  documented as an alternate denylist mechanism — this repo prefers the
  allowlist), and for output-shaped scoping of a file-writing agent
  (`Bash, Read, Write` in the documented `data-scientist` example). Grounds
  `architecture-reviewer`/`plan-verifier` being read-only and `doc-writer`'s
  tool list.
- **Amend** the [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices)
  bullet: also the source for "Add an adversarial review step" — review the
  diff against the plan, check every requirement is implemented, that listed
  edge cases have tests, and that nothing outside scope changed, reporting
  gaps rather than style preferences — and for the caution that a reviewer
  prompted to find gaps will report some even when the work is sound, so it
  must be told to flag only gaps affecting correctness/stated requirements.
  Also "Give Claude a way to verify its work → by a second opinion": the agent
  doing the work isn't the one grading it. Grounds `plan-verifier` end to end
  and `architecture-reviewer`'s findings discipline.
- **Amend** the [How and when to use subagents in Claude Code](https://claude.com/blog/subagents-in-claude-code)
  bullet: also the source for a review subagent's output being a prioritized
  list of findings with `file:line` references and a recommended fix for each.
- **Amend** the [When to use multi-agent systems (and when not to)](https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them)
  bullet: also the source for verification subagents needing concrete,
  falsifiable criteria ("run the full test suite and report all failures", not
  "make sure it works"), or they take shortcuts. Grounds plan-verifier running
  the plan's commands itself.
- **New bullet** — [Tools reference](https://code.claude.com/docs/en/tools-reference):
  `ReportFindings` is a real built-in tool (file / summary / failure_scenario /
  optional category per finding), but its only documented invocation path is
  Claude calling it inside the bundled `/code-review` pipeline in a host app
  that requested a findings list; no official documentation shows a custom
  subagent listing it in its own `tools:`. Recorded as the reason
  `architecture-reviewer` uses a plain-text findings report instead.
- **New bullet** — in-repo prior art, `docs/agent-prompts/README.md` +
  `general-reviewer.md`: findings-discipline prose (distinct findings only, no
  padding toward a count, zero findings is a valid answer, cite an exact
  `file:line`) reused by `architecture-reviewer` and `plan-verifier`. Note
  explicitly that their *mechanism* — DB-stored prompts assembled by
  `reviewer-core/src/prompt.ts` with JSON-schema-constrained output — is
  deliberately not copied, since a Claude Code subagent has no output schema.
- **New bullet** — in-repo convention, the per-module `docs/README.md` topic
  indexes: grounds `doc-writer`'s placement logic. State plainly that no
  Anthropic documentation addresses a subagent choosing its own output file
  location, and none mentions diagrams at all, so this is the repo's own
  answer rather than a sourced practice.
- **Extend** the closing "own extrapolation rather than a directly sourced
  Anthropic practice" paragraph with: (a) doc placement and diagram usage are
  unsourced, per the bullet above; (b) `test-writer`'s "test files only"
  boundary is enforced by prompt text, because Claude Code's `tools:`
  allowlist cannot scope a tool to a path; (c) the same applies to
  `architecture-reviewer`'s / `doc-writer`'s "git inspection only" and
  "`CLAUDE.md` Further-reading section only" restrictions.

### 8. [.claude/agents] verification — required skill(s): none — done when: every check under "Verification" below has been run and reported.

---

## Skills the implementer must apply

This task writes markdown agent definitions, not application code, so the
engineering-convention skills apply as **reference material the prompts must
describe accurately**, not as rules for code being written:

- `react-testing-library` — read to state test-writer's client-side
  convention correctly (and to confirm the prompt does not restate rules the
  skill already owns).
- `fastify-best-practices` — same for the server `app.inject()` convention;
  note its `rules/testing.md` examples use `node:test` while the repo uses
  Vitest.
- `onion-architecture` — the source of architecture-reviewer's backend checks
  *and* of its accepted-violations exclusion list; the prompt must reference
  the skill rather than duplicate the ring tables.
- `frontend-ui-architecture` — same for architecture-reviewer's client
  checks.
- `zod`, `typescript-expert` — justify their inclusion in test-writer's
  `skills:` line; no rules from them are copied into the prompt.
- `mermaid-diagram` — doc-writer's diagram basis.
- `engineering-insights` — governs the `insights.md` boundary that appears in
  three of the four prompts (test-writer reads and may append; doc-writer
  reads and reports but does not write; architecture-reviewer reads only), and
  governs the implementer's own session-end pass: if anything non-obvious
  surfaced while creating these agents, append it under an existing heading in
  the relevant module's `insights.md` with today's date. Note that
  `.claude/agents/` has no `insights.md` of its own — do not create one.

## Verification

No package code changes, so `pnpm test` / `pnpm typecheck` in `server/`,
`client/`, `reviewer-core/` and `e2e/` are unaffected and need not be run.
Verify instead:

1. **Files exist, one per agent.**
   `Get-ChildItem C:\Projects\dev-digest\.claude\agents` lists exactly 8
   entries: `README.md`, `planner.md`, `implementer.md`, `researcher.md`,
   `test-writer.md`, `architecture-reviewer.md`, `plan-verifier.md`,
   `doc-writer.md`.
2. **Frontmatter is well-formed and consistent.** Each new file starts with
   `---` on line 1, closes the block, and its `name:` equals the filename
   stem. `tools:` and `skills:` are single-line comma-separated lists in the
   same style as the existing three files. No file contains `ReportFindings`,
   `disallowedTools`, or a `Skill` entry in `tools:`.
3. **Every preloaded skill exists.** Each name on a `skills:` line appears in
   the catalog table of `.claude/skills/README.md` and has a matching
   directory under `.claude/skills/`.
4. **Read-only agents really are read-only.** `architecture-reviewer.md` and
   `plan-verifier.md` contain neither `Edit` nor `Write` in `tools:`.
5. **README consistency.** The agent table has 7 data rows; for each new row,
   the `Tools`, `Skills preloaded` and `Model` cells match that agent's
   frontmatter exactly; every URL added in step 7 appears exactly once in the
   Sources section.
6. **Claude Code loads them.** Run `/agents` — all seven subagents are listed
   with no parse/validation error, and each new one shows the intended tool
   set.
7. **End-to-end smoke checks** (one per agent, each proving the behavior the
   prompt is supposed to produce):
   - `test-writer`: ask it to add one test case to an existing client
     component test (e.g.
     `client/src/app/repos/[repoId]/pulls/_components/SeverityCounts/SeverityCounts.test.tsx`);
     confirm it writes only that test file and that `cd client; pnpm test`
     passes in its report.
   - `architecture-reviewer`: ask it to review `server/src/modules/pulls/`;
     confirm it cites concrete `file:line` evidence and that it classifies the
     route-level Drizzle queries as a **grandfathered accepted violation**
     rather than a new finding.
   - `plan-verifier`: ask it to verify this plan file
     (`specs/0001-four-claude-code-subagents.md`) after steps 1–7 are done;
     confirm it emits a per-step table with one row per numbered step and
     evidence for each, rather than free-form prose.
   - `doc-writer`: ask it where it would document a named server behavior;
     confirm it answers with `server/docs/<topic>.md` plus a
     `server/CLAUDE.md` "Further reading" link, and does not propose root
     `docs/`.

## Explicit note

Architecture and security review are out of scope for the implementer and are
handled by separate review agents/skills after implementation. (For this task
that also means: do not review the *new* agents' prompts for architectural
soundness while writing them — create them as specified, then run the
verification checks above.)

## Open questions / assumptions

1. **`ReportFindings` (flagged for the user).** `ReportFindings` is a real,
   documented built-in Claude Code tool
   ([Tools reference](https://code.claude.com/docs/en/tools-reference)) that
   reports file / summary / failure_scenario / optional category per finding.
   However, its only documented invocation path is Claude calling it itself
   inside the bundled `/code-review` pipeline, in a host app that asked for a
   findings list — **no official documentation shows or endorses a custom
   subagent listing it in its own `tools:` frontmatter.** This plan therefore
   treats it as unsupported/undocumented for `architecture-reviewer` and
   specifies a plain-text findings report instead, matching every official
   custom-subagent example and the existing agents in this repo. Tradeoff: a
   plain-text report is not machine-consumable by any host-app findings UI, so
   if such an integration is wanted later, `architecture-reviewer`'s report
   format would need revisiting. **Please confirm before implementation** if
   you would rather experiment with `ReportFindings` in `tools:`.
2. **No Anthropic guidance on documentation placement or diagrams (flagged
   for the user).** Confirmed gap, not an oversight: no Anthropic
   documentation addresses a subagent deciding its own output file location,
   and none mentions Mermaid or diagrams at all. `doc-writer`'s placement
   logic is grounded entirely in this repo's per-module `docs/README.md`
   topic-index convention, and its diagram guidance entirely in the in-repo
   `mermaid-diagram` skill. Both are stated as repo conventions in the README
   Sources section rather than cited to an external source. If the convention
   is meant to differ (e.g. a root-level docs tree), say so before
   implementation.
3. **Skill/repo mismatch found while planning:**
   `.claude/skills/fastify-best-practices/rules/testing.md` demonstrates
   `inject()` with `node:test` + `t.assert.*`, while every server test in
   `server/test/` uses **Vitest** (`describe`/`it`/`expect` — see
   `server/test/reviews.it.test.ts:1`). This plan resolves it in the repo's
   favor inside `test-writer`'s prompt. Correcting the skill file itself is
   deliberately out of scope here and should be its own change.
4. **doc-writer editing `CLAUDE.md`.** This plan grants doc-writer `Edit`
   restricted (by prompt text, not by tooling) to the owning module's "Further
   reading" section, because a `docs/` file that nothing links to is invisible
   per the convention. The stricter alternative is to have doc-writer *propose*
   the link line and let a human apply it. Flag if you prefer the stricter
   option.
5. **`Bash` for `architecture-reviewer`.** Included so a review can be scoped
   to a change set via `git diff`; both `Read, Grep, Glob` and
   `Read, Grep, Glob, Bash` are documented reviewer shapes. The "read-only git
   only" limit is prompt-enforced, since Claude Code's agent frontmatter has
   no per-command allowlist. Drop `Bash` if you want a hard guarantee that the
   agent can execute nothing.
6. **Model assignments** (`opus` for the two reviewers, `sonnet` for the two
   writers) follow the existing split (`planner` opus, `implementer`/
   `researcher` sonnet) on the assumption that judgment-heavy review warrants
   the stronger model. Easily flipped later; nothing else in the plan depends
   on it.
7. **No Claude Code `security-reviewer` subagent** is created here — it was
   not requested. The README wording added in step 6 should therefore say
   security review is covered today by the `security` skill and
   `pr-self-review`, not by a dedicated subagent.
