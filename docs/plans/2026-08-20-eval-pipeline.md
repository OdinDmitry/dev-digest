# Development Plan: Eval Pipeline

Spec: docs/specs/cross/SPEC-03-eval-pipeline.md
Date: 2026-08-20
Execution mode: multi-agent (3 tracks + integration)

## Goal

Turn accepted/dismissed findings into a frozen, labelled eval case set per agent;
replay an agent over its whole set in one action using the agent's own model,
provider and linked skills; score every run mechanically (recall, precision,
citation accuracy, per-case pass) with zero model calls on the scoring path; keep
every run as history against the agent configuration version **and the skill
versions** it invoked, with its total model-call cost as a second, never-scored
axis; and let the user compare two runs of one agent and browse recent runs
across all agents.

## Out of scope

Everything in the spec's **Non-goals** (§ Goals / Non-goals), restated here so
`implementer` never builds it by analogy with the pre-existing scaffolding:

- `Promote v7` from the comparison; the metric trend chart; per-agent sparklines;
  the automatic alert banner; the 30-day range filter; `Run all agents`; running
  a single case; `Run on save`; the `Files` and `PR meta` input tabs of the case
  editor; authoring a case from scratch; a free-form JSON expected-output
  document; per-run token counts and latency; repeated trials (`pass@k`); any
  model-judged criterion; comparing runs of two different agents; gating anything
  on a metric; changing reviews, findings, decisions or the grounding gate.
- **`client/messages/en/eval.json` already carries copy for several of those
  non-goals** (`caseEditor.runCase`, `caseEditor.tabs.prMeta`,
  `dashboard.metricTrend`, `evalsTab.newCase`, `dashboard.runEval` framing —
  `client/messages/en/eval.json:9,34,36,43-46,71`). Those keys stay in the file
  and stay unrendered. Do not delete them (root `CLAUDE.md` "course starter"
  convention) and do not render them.
- **No changes to `reviewer-core/`.** `reviewPullRequest` already returns
  everything this feature needs (`reviewer-core/src/review/run.ts:107-125`) and
  already accepts resolved skill bodies (`ReviewInput.skills?: string[]`,
  `run.ts:57`). The spec's header lists `reviewer-core` as a module; this plan
  touches zero files there — confirmed as aspirational by the coordinator.
- **Do NOT add a step that wraps skill bodies as untrusted data.** The spec
  requires a skill body to stay in the prompt's instruction section, and it
  already does: `assemblePrompt` pushes `## Skills / rules\n${skillsBlock}` with
  **no** `wrapUntrusted` call (`reviewer-core/src/prompt.ts:171`), unlike every
  neighbouring section — `pr-description` (`:166`), `intent` (`:169`),
  `repo-map` (`:174`), `project-context` (`:176`), `callers` (`:179`) and
  `diff` (`:182`) are all wrapped. Nothing to build; nothing to change.
- No new port in `shared/adapters.ts`. The only outbound effect is an LLM call,
  already behind `LLMProvider` and resolved by `container.llm`
  (`server/src/platform/container.ts:182`).
- No SSE stream for eval-run progress. Progress is polled (see Placement
  decisions).
- No changes to `FindingActionKind` (`server/src/vendor/shared/contracts/findings.ts:82`)
  — the eval-case action is not an accept/dismiss verb.

## Constraints

Every claim below was read in this session at the cited line.

**Schema and data**

- `eval_cases` and `eval_runs` already exist and have **no production consumer**
  outside the schema barrel — `grep -rn "evalCases|evalRuns|eval_cases|eval_runs"`
  hits only `server/src/db/schema/eval.ts`, `server/src/db/schema.ts:37,75-76`,
  the migration files, and `productionize.ts`'s unrelated
  `PluginExport.eval_cases` counter. Both tables are empty in every environment.
- The shipped `eval_runs` row is **per case**: `case_id` FK, no agent id, no
  configuration version (`server/src/db/schema/eval.ts:22-35`). The spec's "eval
  run" is per **suite**. Both shapes are needed; a new `eval_suite_runs` table is
  added and `eval_runs` is extended with a link. Nothing shipped is deleted or
  repurposed (root `CLAUDE.md`, "Non-default conventions").
- **`eval_runs.case_id` is `ON DELETE cascade`**
  (`server/src/db/schema/eval.ts:26`, confirmed in the applied migration at
  `server/src/db/migrations/0000_init.sql:377`). A hard `DELETE` of a case would
  therefore delete every per-case result of every completed run — a direct
  violation of AC-12. Case deletion is a **soft delete** (`deleted_at`); no
  `eval_cases` row is ever removed. (`drizzle-orm-patterns` best practice #6.)
- `eval_cases.input_diff` is currently nullable
  (`server/src/db/schema/eval.ts:15`). The table is empty, so the migration may
  safely `SET NOT NULL` (`postgresql-table-design`, "Add NOT NULL everywhere it's
  semantically required").
- `pr_files.patch` is nullable text (`server/src/db/schema/pulls.ts:44`). A
  finding whose file has no row, or a null/empty `patch`, is the spec's "case
  whose diff fragment cannot be cut" edge case.
- Migrations are not applied on boot (`server/CLAUDE.md:49`) and
  `server/src/db/migrations/` is on the do-not-touch list
  (`server/CLAUDE.md:56-57`) — generate it with `pnpm db:generate`, never
  hand-edit. Latest existing migration is `0016`; the new one is `0017`, and it
  carries **every** table in Shared contract § C including `eval_run_skills` —
  there is no second migration.
- `drizzle-kit generate` **hangs on this sandbox's stdin** when one table's diff
  both removes and adds columns (`server/insights.md:39`). This plan's diff only
  adds columns and one `SET NOT NULL`, so no prompt is expected; if one appears,
  split the schema edit into separate `db:generate` passes as that entry
  describes.
- Any list endpoint sorting by a non-unique column must append the primary key as
  a final `ORDER BY` term (`server/insights.md:48`).

**Skills — the read path AC-38 needs already exists**

- `AgentsRepository.linkedSkills(agentId)`
  (`server/src/modules/agents/repository.ts:192-200`) selects the **whole
  `skills` row** joined through `agent_skills`, ordered by `agent_skills.order`.
  The `skills` table carries `id`, `name`, `body`, `enabled` and
  **`version integer NOT NULL DEFAULT 1`** (`server/src/db/schema/skills.ts:5-21`).
  So identity, version, name, body and link order all come from the one call the
  review path already makes (`run-executor.ts:446`) — **the plan adds no new
  read for AC-38.**
- A real review injects **only enabled** skills, in link order, and skips the
  rest (`run-executor.ts:453-460`). An eval run replays the agent as configured,
  so it does the same, and records exactly the skills it actually invoked
  (AC-38 says "each skill it **invoked**").
- **`linkedSkills` is NOT workspace-scoped** — it joins on `agentId` alone, and
  `run-executor.ts:443-445` carries an explicit comment saying it is only safe
  there because the agent row was already fetched workspace-scoped. The eval
  runner must do the same: resolve the agent through the workspace-scoped read
  **first**, then call `linkedSkills`.
- `skills.version` bumps on a **body** change only —
  `skills/helpers.ts::isBodyChange` deliberately does not bump on a rename, a
  retype, or an enable/disable (`server/insights.md:32`). The spec states this
  boundary itself (`SPEC-03:253-259`). Consequence to carry, not to fix: AC-39
  catches a rewritten body and a changed *set* of invoked skills (a disable
  removes the skill from the invoked set entirely, so that *is* caught), but a
  pure rename is invisible to both AC-38 and AC-39.

**Contracts**

- `@devdigest/shared` is **copied, not linked**: `server/src/vendor/shared/` and
  `client/src/vendor/shared/` are the only two copies
  (`glob */src/vendor/shared/index.ts` → exactly those two);
  `reviewer-core/tsconfig.json:22` aliases `@devdigest/shared` to the **server's**
  copy, so reviewer-core needs no third sync. Root `CLAUDE.md` requires the
  re-sync by hand — T2 is that step, and T24 is the test that proves it happened.
- `vendor/shared/index.ts` already re-exports `./contracts/eval-ci.js`
  (`client/src/vendor/shared/index.ts:26`), so appending to that file needs **no**
  barrel edit in either copy.
- A `.default(...)` on a persisted contract is a claim about a read path, and in
  this repo it has twice been a false one (`server/insights.md:46`, and the
  client-side restatement at `client/insights.md:57`). Every read of a jsonb
  document written by this feature parses with `safeParse` and falls back — never
  a bare `as` cast.
- `.default()` makes a field **required** in `z.infer`'s output type
  (`server/insights.md:42`), so a hand-built literal must supply it. Prefer
  `.nullish()` on anything a caller constructs as a literal. **`EvalSuiteRun`
  gains a required `invoked_skills` array in this revision** — every hand-built
  `EvalSuiteRun` literal in a client test fixture must supply it, which is the
  exact shape of the `client/insights.md:24` incident.

**Engine**

- `reviewPullRequest` applies the grounding gate itself and returns both sides:
  `review.findings` are the kept findings and `dropped` carries the rejected ones
  with reasons (`reviewer-core/src/review/run.ts:210-221`, type at `:107-125`).
  Citation accuracy (AC-26) is therefore computable with no reviewer-core change.
- `ReviewInput.skills?: string[]` takes **resolved bodies, not slugs**
  (`reviewer-core/src/review/run.ts:57`, and the package doc at `:26-27`). The
  caller resolves them; the server already does so from the DB
  (`run-executor.ts:440-461`).
- Cost is `ReviewOutcome.costUsd` (`reviewer-core/src/review/run.ts:122`), summed
  **null-propagating**: a single `null` per-call cost makes the total `null`
  (`reviewer-core/src/review/run.ts:197`). The suite total follows the same rule —
  this is what makes AC-37 distinguishable from a cost of zero.
- `strategy: 'map-reduce'` degrades to single-pass for a one-file diff
  (`reviewer-core/src/review/run.ts:129`), but the eval runner pins
  `strategy: 'single-pass'` anyway so the NFR "exactly one model call per eval
  case" cannot be broken by an agent's `strategy` setting.
- The four repo-derived prompt injections a real review performs are
  `buildCallersDigest`, `buildRepoMapDigest`, `buildRankNote` and
  `buildProjectContext` (`server/src/modules/reviews/run-executor.ts:211-230`),
  gated on `agent.repoIntel !== false` (`:205`) — except project context, which
  is **not** gated by that flag (`:229-230`) and reads the repository working
  copy. AC-17 requires all four to be absent from an eval invocation regardless of
  the agent's `repo_intel` setting. Linked skills are **not** in that list:
  a skill body is authored configuration, not repository content read at run
  time, which is why AC-18 and AC-17 do not conflict. This is T10.

**Runtime**

- A review runs in the background, not awaited by the route
  (`server/src/modules/reviews/run-executor.ts:68-70`). The eval runner copies
  that shape.
- `JobRunner` defaults to a **120 s timeout and 2 retries**
  (`server/src/platform/jobs.ts:41-42`). An eval run of N cases makes N LLM calls
  and would both time out and be retried — retrying would spend money twice.
  The eval runner therefore does **not** go through `container.jobs`.
- Orphaned `running` rows are reaped at boot for agent runs
  (`server/src/app.ts:80-85` calling `ReviewService.reapStaleRuns`,
  `server/src/modules/reviews/repository.ts:125`). Without the same for eval runs,
  a crash mid-run leaves `status='running'` forever and AC-16 permanently blocks
  that agent. This is T12.

**Client**

- `activeKeyFor` already returns `"eval"` for a `/eval` pathname
  (`client/src/components/app-shell/helpers.ts:35`), so the new nav item's `key`
  must be exactly `"eval"` and its `href` exactly `/eval`.
- `client/src/vendor/ui/nav.ts:32` carries the comment reserving the Eval
  Dashboard for a later lesson.
- `client/src/vendor/ui/kit/Modal.tsx:26-27` sets `role="dialog"` and
  `aria-modal="true"` but implements **no focus trap, no focus restore and no
  Escape handler**, and `grep -rn "focusTrap|focus trap" client/src` returns
  nothing. The spec's NFRs ("keyboard focus SHALL remain within it", "move
  keyboard focus to the control that opened it") therefore need new code — T20.
- `client/src/lib/diff-lines.ts:37` already exposes `diffLines(a, b)` (LCS, with
  size caps) and `VersionDiffModal.tsx:31-57` is a working consumer rendering it
  with `lineRowFor`/`lineSignFor`. AC-32 reuses both.
- `@testing-library/user-event` is **not installed** in `client/`; use
  `fireEvent` (`client/insights.md:43`).
- `Modal` applies zero padding to its children — every caller supplies its own
  `padding: 24` wrapper (`client/insights.md:61`).
- A `mutate()` call does not invoke its `mutationFn` synchronously; assert after
  an `await findBy*`/`waitFor`, never on the next line after `fireEvent.click`
  (`client/insights.md:56`).
- next-intl namespaces are discovered by `readdirSync` over `messages/<locale>/`
  (`client/src/i18n/request.ts:19-23`) — no namespace registry to update.

**Tests**

- DB-backed tests **must** use the `*.it.test.ts` suffix; everything else stays
  hermetic (`server/CLAUDE.md:40-41`).
- Integration suites gate on `dockerAvailable()` and skip cleanly
  (`server/test/helpers/pg.ts:23-33`).
- Every integration suite must pass `secrets: new MockSecretsProvider()` in its
  container overrides, or an unmocked adapter reaches the real network and spends
  money (`server/test/brief.it.test.ts:1-9,25`; root cause at
  `server/insights.md:46`).
- e2e flows are auto-discovered by `readdirSync` over `specs/`
  (`e2e/run.ts:93-94`); they run against a **fresh, migrated, seeded** isolated
  database on every invocation (`scripts/e2e.sh:126-128`), so seed changes take
  effect without any reset step.
- **A `wait --url` assertion is not a rendering assertion** — a broken tab
  whitelist still puts the query parameter in the URL
  (`e2e/specs/11-agent-context-tab.flow.json:3,12`, and the incident at
  `client/insights.md:57`). Every new flow's last step asserts on copy that only
  the new surface renders.

**Seed / e2e data**

- The seeded `pr_files` rows for PR #482 carry **no `patch`**
  (`server/src/db/seed.ts:129-141`) — only `path`/`additions`/`deletions`. With
  the database as it ships, no finding on that PR can have a fragment cut, so
  every "turn into eval case" path is unreachable in dev and in e2e. T13 fixes
  this.
- The two seeded findings (`server/src/db/seed.ts:166-191`) carry neither
  `accepted_at` nor `dismissed_at`, so both would default to *no* expectation type
  (AC-6). T13 also records a decision on each so the seeded set exercises both
  directions.
- The seed already links skills to `Test Quality Reviewer`
  (`server/src/db/seed.ts:363-407`), so an agent with a non-empty invoked-skill
  set exists for the AC-38/AC-39 surfaces without inventing new fixtures.

## Entry points & duplicate registries

Every other place enumerating the same keys, with the task that covers it.
Greps that came back empty are recorded too.

| Registry | Where | Covered by |
|---|---|---|
| Fastify module registry | `server/src/modules/index.ts:31-47` (one import + one object entry) | **T11** |
| Drizzle schema barrel | `server/src/db/schema.ts` — **two** places per table: the `import` at `:37` **and** the `schema` object at `:75-76`. Three new tables now: `eval_case_expectations`, `eval_suite_runs`, `eval_run_skills` | **T3** |
| Shared row types | `server/src/db/rows.ts:12-19` | **T3** |
| Vendored contract copies | `server/src/vendor/shared/contracts/eval-ci.ts` **and** `client/src/vendor/shared/contracts/eval-ci.ts` | **T1 + T2**, proved by **T24** |
| Agent editor tabs | `AgentEditor/constants.ts:11-15` (`TABS`) — the `?tab=` whitelist at `agents/[id]/page.tsx:20` **already derives** from `TABS` (`VALID_TABS = TABS.map(...)`), so there is no second list to update. Checked; this is the collapsed form the 2026-08-17 incident produced. | **T18** (one file) |
| Sidebar / g-nav / command palette | all three read `NAV` (`vendor/ui/shell/Sidebar.tsx:45`, `app-shell/hooks/useGlobalShortcuts.ts:45`, `app-shell/hooks/useShellCommands.ts:21`) — one edit, three surfaces | **T22** |
| Shortcuts help | `vendor/ui/nav.ts:68-79` (`SHORTCUTS`) is a **separate hand-kept list**, rendered by `vendor/ui/command-palette/ShortcutsHelp.tsx:8,44`. Its five `Navigation` entries are exactly `Go to ${item.label}` / `g ${item.gKey}` for the five `NAV` items with a `gKey`. **T22 collapses it**: the `Navigation` group is derived from `NAV`; the `Findings`/`Actions`/`Global` entries stay static. | **T22** (structural fix, not a file added to a task) |
| Active sidebar key | `app-shell/helpers.ts:26-40` (`activeKeyFor`) already maps `/eval` → `"eval"` at `:35` — no edit needed, but the NAV item's `key`/`href` must match it exactly | **T22** (constraint, no edit) |
| Client hooks barrel | `client/src/lib/hooks/index.ts:4-15` | **T14** |
| Skill-resolution read path | `AgentsRepository.linkedSkills` (`agents/repository.ts:192-200`) is the single existing reader; `run-executor.ts:446` is its only production caller. The eval runner becomes the second caller of the **same** method — no parallel read path is added (`server/insights.md:29`). | **T9 / T10** |
| Finding action verbs | `FindingActionKind` (`contracts/findings.ts:82`) and `KEY_TO_ACTION` (`FindingsPanel/constants.ts:15-18`). Checked: the eval-case action is deliberately **not** added to either — it opens a modal, it is not an accept/dismiss verb, and adding it would make `POST /findings/:id/eval` a valid `FindingAction` on the server. | not edited (decision) |
| i18n namespaces | `client/src/i18n/request.ts:19-23` — `readdirSync`, no registry. Checked, nothing else enumerates namespaces. | n/a |
| e2e flows | `e2e/run.ts:93-94` — `readdirSync`, no registry. Checked. | n/a |
| Shared contracts barrel | `vendor/shared/index.ts:26` already exports `./contracts/eval-ci.js` in both copies. Checked, no edit. | n/a |
| Other consumers of `eval_cases`/`eval_runs` | `grep -rn "evalCases\|evalRuns\|eval_cases\|eval_runs" --glob '!**/clones/**'` → only the schema files, the migrations, and `productionize.ts`'s unrelated `eval_cases` **count** field. **Checked: nothing else reads or writes these tables.** | n/a |
| New contract names | `grep -rn "EvalSuite\|EvalExpectation\|EvalCaseRecord\|EvalCaseDraft\|EvalRunStatus\|EvalCaseResult\|EvalReturnedFinding"` → **no matches** anywhere. Re-run for this revision's names: `grep -rn "EvalInvokedSkill\|eval_run_skills\|evalRunSkills\|invoked_skills\|invokedSkills" --glob '!**/clones/**'` → **no matches**. No barrel collision (the `AgentStats` class of failure at `server/insights.md:31`). Checked. | n/a |

## Placement decisions

Each traces to a preloaded skill's rule, not to preference.

1. **New server module `server/src/modules/eval/`** with the canonical file set
   `routes.ts` / `service.ts` / `repository.ts` / `helpers.ts` / `constants.ts`,
   plus `scoring.ts` and `runner.ts`. `onion-architecture` § Module anatomy: a new
   module gets a service and a repository even if thin, and must not copy the
   grandfathered "query from `routes.ts`" pattern (that list is closed —
   `pulls`, `polling`, `settings`, `workspace`).
2. **`EvalService` takes explicit deps, never `Container`.**
   `onion-architecture` § Dependencies of a service. Construct it in `routes.ts`
   exactly as `modules/brief/routes.ts:30-56` does. `container.llm` is passed as a
   bound function (`llm: (id) => container.llm(id)`), so ring 2 never holds the
   composition root. `container.agentsRepo` is passed as `agents` — the same
   instance `run-executor.ts` uses for `linkedSkills`.
3. **Scoring is a pure ring-2 module** (`modules/eval/scoring.ts`): plain
   functions over plain data, no imports of `drizzle-orm`, `db/schema`, `fastify`
   or any LLM type. `onion-architecture` § "Ring 2 has no technology imports" —
   and it is what makes AC-23…AC-29 hermetic unit tests.
4. **Fragment cutting is a pure ring-2 helper** (`modules/eval/helpers.ts`),
   taking `(path, patch, startLine, endLine)` and returning a unified-diff string
   or `null`. `onion-architecture` quick-decision table: "turning a row into an
   API shape / pure transform → `helpers.ts`". It must prepend the same three
   header lines `diffFromPrFiles` prepends (`diff --git a/P b/P`, `--- a/P`,
   `+++ b/P` — `server/src/modules/reviews/diff-loader.ts:38-41`) so the stored
   fragment re-parses through `parseUnifiedDiff`
   (`server/src/adapters/git/diff-parser.ts:14-79`; hunk header regex at `:46`).
5. **Expectations are a child table, not jsonb.** `postgresql-table-design`:
   "Keep core relations in tables; use JSONB for optional/variable attributes."
   Expectations have a fixed shape, a cross-row invariant (AC-11) and benefit from
   `CHECK` constraints. The shipped `expected_output` jsonb column stays empty,
   per the course-starter convention.
6. **Returned findings are jsonb in the existing `eval_runs.actual_output`**, not
   a new column. Its name and shipped meaning already are "the findings the agent
   returned"; adding a second, near-identically-named column is exactly the
   duplicate read/write path `server/insights.md:29` warns about. The read path
   `safeParse`s it (`server/insights.md:46`).
7. **The invoked skill set is a child table `eval_run_skills`, not jsonb, and it
   carries no foreign key to `skills`.** Child table for the same reason as
   expectations: fixed shape, and AC-39 compares two runs by identity **and**
   version, which is a set operation over rows. **No FK** because the spec
   requires a run recorded against a skill version that no longer exists to keep
   its record and still be compared (`SPEC-03:506-510`) — an `ON DELETE cascade`
   would erase exactly the evidence AC-39 needs, the same trap already found on
   `eval_runs.case_id`. A `skill_name` snapshot rides along so a deleted skill
   still renders a label. This mirrors the reasoning already applied to
   `eval_cases.source_finding_id` and `eval_suite_runs.agent_version`.
8. **The comparison has no endpoint.** The dialog composes from two already-loaded
   `EvalSuiteRun` records (which now carry `invoked_skills`, so AC-39 needs no
   extra fetch) plus two calls to the **existing**
   `GET /agents/:id/versions/:version` (`server/src/modules/agents/routes.ts:146`,
   DTO built by `toAgentVersionDto` which already parses `config_json` through
   `AgentVersionConfig` — `server/src/modules/agents/helpers.ts:42-49`, prompt
   field at `contracts/knowledge.ts:335`). A 404 from that endpoint is exactly the
   spec's "configuration version that no longer exists" edge case. Metric/cost
   deltas, the case-set comparison and the invoked-skill comparison are pure
   client helpers. `frontend-ui-architecture` § "Put code as close to its only
   consumer as possible" + "reuse what already exists".
9. **The prompt diff is computed client-side** with the existing
   `client/src/lib/diff-lines.ts:37`, rendered like
   `VersionDiffModal.tsx:44-56`. No new diff algorithm, server or client.
10. **Run progress is polled, not streamed.** The `running` `eval_suite_runs` row
    carries `cases_completed`/`cases_total`; the client hook sets
    `refetchInterval` while any run is `running`. This satisfies AC-15 and the NFR
    "announced at most once per completed case" (the counter changes at most once
    per case), and avoids adding a second SSE surface. `RunBus`
    (`server/src/platform/sse.ts:19-103`) is keyed on agent-run ids and is not
    reused here.
11. **The run-history table and the compare dialog live in
    `client/src/components/eval-runs/`**, not in either route folder — they have
    two unrelated consumers (the agent editor's Evals tab and `/eval`).
    `frontend-ui-architecture` placement ladder rung 3/4, following this repo's
    existing precedent for a domain component shared by two routes:
    `client/src/components/context-attach/ContextAttachPanel`, consumed by
    `AgentEditor.tsx:28` and by `SkillDetail`.
12. **The eval-case creation modal is colocated** at
    `client/src/app/repos/[repoId]/pulls/[number]/_components/EvalCaseModal/` —
    one consumer (`FindingsPanel`). Placement ladder rung 2; do not promote it.
13. **The focus trap is a local hook**
    (`components/eval-runs/RunCompareDialog/use-focus-trap.ts`), not a change to
    the vendored `Modal`. `Modal` has five other consumers and its own tests;
    changing a shared primitive for one caller's NFR is the "premature
    extraction / risky widening" failure in `frontend-ui-architecture`. Recorded
    as a Recommendation for a later, deliberate change.
14. **`AgentsRepository` and `ReviewRepository` are reused, not duplicated.**
    `container.agentsRepo` / `container.reviewRepo`
    (`server/src/platform/container.ts:102-112`) already expose
    `getVersion`/`listVersions` (`modules/agents/repository.ts:172-187`),
    `linkedSkills` (`:192-200`) and `findingContext`
    (`modules/reviews/repository.ts:142-146`). Per `server/insights.md:29`, do not
    add a second read path against `findings`, `agent_versions`, `agent_skills`
    or `skills`.

## Affected modules & files

- **server**
  - `src/db/schema/eval.ts` — extend `eval_cases`, `eval_runs`; add
    `eval_case_expectations`, `eval_suite_runs`, `eval_run_skills`
  - `src/db/schema.ts` — barrel import + `schema` object entries
  - `src/db/rows.ts` — new row types
  - `src/db/migrations/0017_*.sql` (+ `meta/`) — generated, never hand-edited
  - `src/db/seed.ts` — patches, decisions, seeded cases + completed runs
  - `src/modules/eval/{routes,service,repository,runner,scoring,helpers,constants}.ts`
  - `src/modules/index.ts` — register the module
  - `src/app.ts` — boot-time reap of orphaned eval runs
  - `src/vendor/shared/contracts/eval-ci.ts` — SPEC-03 contract block
- **client**
  - `src/vendor/shared/contracts/eval-ci.ts` — re-synced copy of the same block
  - `src/lib/hooks/eval.ts`, `src/lib/hooks/index.ts`, `src/lib/hooks/agents.ts`
  - `src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx`
  - `src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx`
  - `src/app/repos/[repoId]/pulls/[number]/_components/EvalCaseModal/*`
  - `src/app/agents/[id]/_components/AgentEditor/{AgentEditor.tsx,constants.ts}`
  - `src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/*`
  - `src/components/eval-runs/RunHistoryTable/*`,
    `src/components/eval-runs/RunCompareDialog/*`
  - `src/app/eval/page.tsx`, `src/app/eval/_components/EvalDashboardView/*`
  - `src/vendor/ui/nav.ts`
  - `messages/en/eval.json`, `messages/en/prReview.json`
- **e2e**
  - `specs/13-agent-evals-tab.flow.json`, `specs/14-eval-dashboard.flow.json`,
    `specs/15-eval-run-compare.flow.json`
- **root**
  - `package.json` (new, scripts only), `scripts/verify-l06.sh`, `.gitignore`

## Shared contract (frozen before the tracks fork)

### A. Zod block appended to `contracts/eval-ci.ts` (both vendor copies, identical)

Appended under a `// ==== SPEC-03 eval pipeline ====` banner **below** the
existing L06 scaffolding. `EvalCaseInput`, `EvalRunRecord`, `EvalRunResult`,
`EvalTrendPoint`, `EvalDashboard` (`eval-ci.ts:20-89`) and `EvalCase`/`EvalRun`/
`EvalPerTrace`/`EvalOwnerKind` (`contracts/knowledge.ts:50-84`) are **not
edited**.

```ts
export const EvalExpectationKind = z.enum(['must_find', 'must_not_flag']);
export type EvalExpectationKind = z.infer<typeof EvalExpectationKind>;

export const EvalExpectation = z.object({
  id: z.string(),
  kind: EvalExpectationKind,
  file: z.string().min(1),
  start_line: z.number().int().min(1),
  end_line: z.number().int().min(1),
});
export type EvalExpectation = z.infer<typeof EvalExpectation>;

/** A stored eval case. `fragment`, `file`, `start_line`, `end_line` are
 *  captured at creation and never change (AC-9). */
export const EvalCaseRecord = z.object({
  id: z.string(),
  agent_id: z.string(),
  name: z.string(),
  /** The finding this case was born from. Kept as a plain id with no FK so the
   *  case survives the finding's deletion (Contracts § Diff fragment). */
  source_finding_id: z.string().nullable(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  fragment: z.string(),
  expectations: z.array(EvalExpectation),
  created_at: z.string(),
});
export type EvalCaseRecord = z.infer<typeof EvalCaseRecord>;

/** GET /findings/:id/eval-case-draft */
export const EvalCaseDraft = z.object({
  finding_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
  suggested_name: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  fragment: z.string(),
  /** null when the finding has neither been accepted nor dismissed (AC-6). */
  default_expectation_kind: EvalExpectationKind.nullable(),
  /** The case already created from this finding (AC-10); null when none. */
  existing_case: EvalCaseRecord.nullable(),
});
export type EvalCaseDraft = z.infer<typeof EvalCaseDraft>;

/** POST /agents/:id/eval-cases — `expectation_kind` has NO default (AC-7). */
export const EvalCaseCreate = z.object({
  finding_id: z.string().uuid(),
  name: z.string().min(1),
  expectation_kind: EvalExpectationKind,
});
export type EvalCaseCreate = z.infer<typeof EvalCaseCreate>;

/** PUT /eval-cases/:id — name and expectations only (AC-9). */
export const EvalCaseUpdate = z.object({
  name: z.string().min(1).optional(),
  expectations: z.array(EvalExpectation.omit({ id: true })).min(1).optional(),
});
export type EvalCaseUpdate = z.infer<typeof EvalCaseUpdate>;

export const EvalRunStatus = z.enum(['running', 'completed', 'failed']);
export type EvalRunStatus = z.infer<typeof EvalRunStatus>;

/**
 * One skill as a run invoked it (AC-38): its identity plus the version of its
 * BODY that was invoked. `name` is a snapshot, not a join, so a comparison can
 * still label a skill that has since been deleted (SPEC-03 Edge cases).
 *
 * Known boundary, restated from the spec so nobody reads more into this than it
 * carries: `skill_version` tracks the body only — `skills/helpers.ts::isBodyChange`
 * does not bump it on a rename. A disable IS caught, because a disabled skill
 * drops out of the invoked set entirely.
 */
export const EvalInvokedSkill = z.object({
  skill_id: z.string(),
  skill_version: z.number().int(),
  name: z.string(),
});
export type EvalInvokedSkill = z.infer<typeof EvalInvokedSkill>;

/** One finding as the agent returned it for a case, with its grounding outcome.
 *  `severity`/`title` are `.nullish()` on purpose: this object is persisted as
 *  jsonb and read back, and a stricter schema would reject a document written
 *  by an earlier shape (server/insights.md 2026-08-17). */
export const EvalReturnedFinding = z.object({
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  grounded: z.boolean(),
  severity: z.string().nullish(),
  title: z.string().nullish(),
});
export type EvalReturnedFinding = z.infer<typeof EvalReturnedFinding>;

export const EvalCaseResult = z.object({
  case_id: z.string(),
  case_name: z.string(),
  /** false when the invocation did not complete (AC-20/21/22). */
  completed: z.boolean(),
  error: z.string().nullable(),
  /** null when `completed` is false. */
  passed: z.boolean().nullable(),
  findings: z.array(EvalReturnedFinding),
  cost_usd: z.number().nullable(),
});
export type EvalCaseResult = z.infer<typeof EvalCaseResult>;

/** A run over one agent's whole case set. Every metric and the cost are
 *  `.nullable()` and NEVER `.default(0)` — absent is a distinct state from zero
 *  (AC-27, AC-37). */
export const EvalSuiteRun = z.object({
  id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
  agent_version: z.number().int(),
  /** The skills this run invoked, in the order the agent links them (AC-38).
   *  Empty when the agent had no enabled linked skill when the run started.
   *  REQUIRED — every hand-built EvalSuiteRun test fixture must supply it. */
  invoked_skills: z.array(EvalInvokedSkill),
  status: EvalRunStatus,
  started_at: z.string(),
  completed_at: z.string().nullable(),
  cases_total: z.number().int(),
  cases_completed: z.number().int(),
  cases_passed: z.number().int().nullable(),
  cases_failed_to_complete: z.number().int(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  cost_usd: z.number().nullable(),
  /** Ids of the cases this run covered, for AC-33. */
  case_ids: z.array(z.string()),
});
export type EvalSuiteRun = z.infer<typeof EvalSuiteRun>;

export const EvalSuiteRunDetail = EvalSuiteRun.extend({
  results: z.array(EvalCaseResult),
});
export type EvalSuiteRunDetail = z.infer<typeof EvalSuiteRunDetail>;
```

### B. HTTP surface (frozen)

| Method + path | Body | Response | Notes |
|---|---|---|---|
| `GET /findings/:id/eval-case-draft` | — | `EvalCaseDraft` | 404 finding/workspace; **422** `ValidationError` when the fragment cannot be cut |
| `POST /agents/:id/eval-cases` | `EvalCaseCreate` | `EvalCaseRecord`, 201 | 200 + the existing record when one exists for that finding (AC-10); 422 on overlap (AC-11) |
| `GET /agents/:id/eval-cases` | — | `EvalCaseRecord[]` | `deleted_at IS NULL`, `ORDER BY created_at DESC, id` |
| `PUT /eval-cases/:id` | `EvalCaseUpdate` | `EvalCaseRecord` | 422 on overlap (AC-11) |
| `DELETE /eval-cases/:id` | — | `{ ok: true }` | soft delete |
| `POST /agents/:id/eval-runs` | — | `EvalSuiteRun`, 202 | 422 when the set is empty (AC-13); **409** when a run for that agent is already `running` (AC-16) |
| `GET /agents/:id/eval-runs` | — | `EvalSuiteRun[]` | newest first, `ORDER BY started_at DESC, id` |
| `GET /eval-runs/:id` | — | `EvalSuiteRunDetail` | |
| `GET /eval-runs?limit=20` | — | `EvalSuiteRun[]` | `status = 'completed'` only, across all agents, newest first (AC-2) |

All paths call `getContext(container, req)` and scope by `workspaceId` on **every**
path, including the read-only ones (spec NFR). Params use
`IdParams`/`fastify-type-provider-zod` — never a hand-rolled `Schema.parse(req.body)`
(`server/CLAUDE.md:38-39`).

### C. Database shape (frozen — all of it in migration `0017`)

```
eval_cases (EXTEND)
  + source_finding_id  uuid NULL          -- NO foreign key, on purpose
  + file               text NOT NULL
  + start_line         integer NOT NULL
  + end_line           integer NOT NULL
  + created_at         timestamptz NOT NULL DEFAULT now()
  + deleted_at         timestamptz NULL
  ~ input_diff         text -> SET NOT NULL          (holds the fragment)
  unique index eval_case_finding_uq ON (workspace_id, source_finding_id)
      WHERE source_finding_id IS NOT NULL AND deleted_at IS NULL     -- AC-10
  index on (owner_id, created_at DESC, id)

eval_case_expectations (NEW)
  id         uuid pk default random
  case_id    uuid NOT NULL REFERENCES eval_cases(id) ON DELETE CASCADE
  kind       text NOT NULL CHECK (kind IN ('must_find','must_not_flag'))
  file       text NOT NULL
  start_line integer NOT NULL
  end_line   integer NOT NULL CHECK (end_line >= start_line)
  index on (case_id)

eval_suite_runs (NEW)
  id                       uuid pk default random
  workspace_id             uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
  agent_id                 uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE
  agent_version            integer NOT NULL      -- plain int, NO composite FK:
                                                 -- a run outlives a deleted version
  status                   text NOT NULL CHECK (status IN ('running','completed','failed'))
  started_at               timestamptz NOT NULL DEFAULT now()
  completed_at             timestamptz NULL
  cases_total              integer NOT NULL
  cases_completed          integer NOT NULL DEFAULT 0
  cases_passed             integer NULL
  cases_failed_to_complete integer NOT NULL DEFAULT 0
  recall                   double precision NULL
  precision                double precision NULL
  citation_accuracy        double precision NULL
  cost_usd                 double precision NULL
  unique index eval_one_running_per_agent ON (agent_id) WHERE status = 'running'  -- AC-16
  index on (workspace_id, started_at DESC, id)
  index on (agent_id, started_at DESC, id)

eval_run_skills (NEW)                              -- AC-38
  suite_run_id  uuid NOT NULL REFERENCES eval_suite_runs(id) ON DELETE CASCADE
  skill_id      uuid NOT NULL       -- NO foreign key, on purpose: the record must
                                    -- outlive the skill's deletion (SPEC-03 Edge
                                    -- cases), and a cascade would erase exactly
                                    -- the evidence AC-39 compares
  skill_version integer NOT NULL    -- skills.version at invocation time (body-tracking)
  skill_name    text NOT NULL       -- snapshot, so a deleted skill still has a label
  link_order    integer NOT NULL    -- agent_skills.order at invocation time.
                                    -- named link_order, not `order`: `order` is a
                                    -- reserved word and would need quoting
  primary key (suite_run_id, skill_id)
  index on (suite_run_id)

eval_runs (EXTEND — the per-case row)
  + suite_run_id  uuid NULL REFERENCES eval_suite_runs(id) ON DELETE CASCADE
  + error         text NULL     -- non-null == the invocation did not complete
  index on (suite_run_id)
  (`actual_output` jsonb now holds EvalReturnedFinding[]; `pass` holds AC-28;
   `cost_usd` holds the case's model-call cost. `recall`/`precision`/
   `citation_accuracy`/`duration_ms` stay NULL — metrics are per suite run.)
```

### D. Frozen pure-function signatures (Track A ↔ Track C)

```ts
// server/src/modules/eval/helpers.ts
export function cutFragment(
  path: string, patch: string, startLine: number, endLine: number,
): string | null;
export function defaultExpectationKind(
  f: { acceptedAt: Date | null; dismissedAt: Date | null },
): EvalExpectationKind | null;
export function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean;
export function findOverlap(
  expectations: Pick<EvalExpectation, 'kind' | 'file' | 'start_line' | 'end_line'>[],
): { mustFind: EvalExpectation; mustNotFlag: EvalExpectation } | null;

// server/src/modules/eval/scoring.ts   (pure; no db, no llm, no fastify imports)
export interface ScoredCase {
  caseId: string;
  expectations: EvalExpectation[];
  findings: EvalReturnedFinding[];   // BOTH grounded and ungrounded
  completed: boolean;
}
export function matchesExpectation(f: EvalReturnedFinding, e: EvalExpectation): boolean;
export function casePassed(c: ScoredCase): boolean;
export function scoreSuite(cases: ScoredCase[]): {
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  casesPassed: number;
  casesFailedToComplete: number;
};
export function sumCost(perCase: (number | null)[]): number | null;  // null-propagating
```

```ts
// client/src/components/eval-runs/RunCompareDialog/helpers.ts (pure)
export function metricDelta(a: number | null, b: number | null): number | null;
export function caseSetsDiffer(a: string[], b: string[]): boolean;
/** True when the two runs invoked a different SET of skill ids, or the same id
 *  at a different version (AC-39). Order is not compared. */
export function invokedSkillsDiffer(a: EvalInvokedSkill[], b: EvalInvokedSkill[]): boolean;
```

## Tasks

### Step 0 — freeze the shared contract (before the tracks fork)

- [ ] T1 Append the SPEC-03 contract block (Shared contract § A) to the server's vendored contracts, below the existing L06 section; edit nothing above it. Includes `EvalInvokedSkill` and `EvalSuiteRun.invoked_skills` — required, not `.default([])`, because the array is assembled from a child table on every read and never needs a fallback — `server/src/vendor/shared/contracts/eval-ci.ts` — owner: `implementer` — skill: `zod` — → AC-7, AC-27, AC-37, AC-38 → `eval_contracts_reject_missing_expectation_kind`, `eval_contracts_keep_absent_metrics_nullable`, `eval_contracts_carry_invoked_skill_identity_and_version`
- [ ] T2 Re-sync the identical block into the client's vendored copy (copy, do not retype — root `CLAUDE.md` "copied, not npm-linked"); no barrel edit needed, `vendor/shared/index.ts:26` already exports the file — `client/src/vendor/shared/contracts/eval-ci.ts` — owner: `implementer` — skill: `zod` — → AC-7, AC-38 → `eval_contracts_vendor_copies_are_identical`

---

### Track A — server

Files: `server/src/**` only (plus the generated migration). Disjoint from Tracks B and C.

- [ ] T3 Extend `eval_cases` and `eval_runs` and add `eval_case_expectations`, `eval_suite_runs` **and `eval_run_skills`** exactly as Shared contract § C specifies, including the two partial unique indexes and `eval_run_skills`' deliberate absence of a FK to `skills`; register all three new tables in the barrel's **import line and its `schema` object** (two edits, `db/schema.ts:37` and `:75-76`); add `EvalCaseRow`, `EvalExpectationRow`, `EvalSuiteRunRow`, `EvalRunSkillRow`, `EvalRunRow` to `db/rows.ts` — `server/src/db/schema/eval.ts`, `server/src/db/schema.ts`, `server/src/db/rows.ts` — owner: `implementer` — skill: `drizzle-orm-patterns`, `postgresql-table-design` — → AC-16, AC-19, AC-38 → `eval_runs_one_running_per_agent`, `eval_run_records_agent_version`, `eval_run_records_invoked_skill_versions`
- [ ] T4 Generate and apply **one** migration covering every table in § C: `cd server && pnpm db:generate` then `pnpm db:migrate`. Never hand-edit the SQL (`server/CLAUDE.md:56-57`). If `db:generate` prompts, split the schema edit into separate passes per `server/insights.md:39` — `server/src/db/migrations/0017_*.sql`, `server/src/db/migrations/meta/*` — owner: `implementer` — skill: `drizzle-orm-patterns` — → AC-19, AC-38 → `eval_run_records_agent_version`, `eval_run_records_invoked_skill_versions`
- [ ] T5 `cutFragment` / `defaultExpectationKind` / `rangesOverlap` / `findOverlap` per the frozen signatures. `cutFragment` parses `@@` headers with the same regex shape as `adapters/git/diff-parser.ts:46`, keeps every hunk whose new-side range intersects `[startLine, endLine]` **whole** (with the context lines the patch already carries), prepends the three headers `diff-loader.ts:38-41` prepends, and returns `null` when no hunk intersects or the patch is empty — `server/src/modules/eval/helpers.ts`, `server/src/modules/eval/constants.ts` — owner: `implementer` — skill: `typescript-expert` — → AC-5, AC-6, AC-11 → `eval_cut_fragment_keeps_whole_intersecting_hunks`, `eval_default_expectation_kind_from_decision`, `eval_find_overlap_reports_the_two_ranges`
- [ ] T6 Pure scoring module per the frozen signatures. Imports **nothing** from `drizzle-orm`, `db/schema`, `fastify` or any LLM type. `matchesExpectation` compares file equality + range overlap and nothing else, and returns `false` for an ungrounded finding. Each metric returns `null` when its denominator is zero. `sumCost` propagates `null` exactly as `reviewer-core/src/review/run.ts:197` does — `server/src/modules/eval/scoring.ts` — owner: `implementer` — skill: `typescript-expert` — → AC-21, AC-23, AC-24, AC-25, AC-26, AC-27, AC-28 → `eval_scoring_matches_on_file_and_overlap`, `eval_scoring_recall_over_must_find`, `eval_scoring_precision_ignores_unlabelled`, `eval_scoring_citation_accuracy_over_all_returned`, `eval_scoring_absent_metric_is_null_not_zero`, `eval_scoring_case_pass_rule`, `eval_scoring_excludes_incomplete_cases`
- [ ] T7 `EvalRepository`: the only file in the module that touches the DB. Case CRUD with soft delete, expectation reads/writes, suite-run insert/progress-bump/finalise, **`eval_run_skills` insert at run start and read-back into `EvalSuiteRun.invoked_skills` ordered by `link_order`**, per-case row insert, history and dashboard reads. Every list orders by its sort key **plus `id`** (`server/insights.md:48`). Every method is workspace-scoped. Reading `actual_output` goes through `EvalReturnedFinding.array().safeParse(row.actualOutput)` with a fallback to `[]` — never `as` (`server/insights.md:46`) — `server/src/modules/eval/repository.ts` — owner: `implementer` — skill: `drizzle-orm-patterns` — → AC-2, AC-3, AC-12, AC-38 → `eval_dashboard_lists_completed_runs_newest_first`, `eval_edit_and_delete_leave_recorded_runs_unchanged`, `eval_run_records_invoked_skill_versions`
- [ ] T8 `EvalService` with explicit deps (`{ repo, agents, reviews, llm }`), constructed in `routes.ts` like `modules/brief/routes.ts:34-56`. Owns: build a draft from a finding (resolve the agent through `reviews.findingContext` → `review.agentId`, `modules/reviews/repository.ts:142-146`; cut the fragment from `pr_files.patch`; return the existing case when one exists, AC-10); create a case (reject an unconfirmed kind at the schema level, reject overlaps naming both ranges, AC-11); update name/expectations only; soft-delete — `server/src/modules/eval/service.ts` — owner: `implementer` — skill: `onion-architecture` — → AC-5, AC-8, AC-9, AC-10, AC-11 → `eval_draft_carries_file_range_and_fragment`, `eval_create_stores_case_for_the_finding_agent`, `eval_case_is_immutable_when_its_finding_changes`, `eval_second_conversion_returns_the_existing_case`, `eval_overlapping_expectations_are_rejected`
- [ ] T9 `EvalRunner`: start a run (refuse an empty set with 422; rely on the partial unique index for AC-16 and translate its violation into a 409 `AppError`), snapshot `cases_total`, the covering `case_ids` **and the invoked skill set** at start, then execute in the background **not awaited by the route**, mirroring `run-executor.ts:68-70`. The skill snapshot: resolve the agent workspace-scoped **first**, then `agents.linkedSkills(agentId)` (`agents/repository.ts:192-200` — not workspace-scoped on its own, see `run-executor.ts:443-445`), keep only `skill.enabled` in link order exactly as `run-executor.ts:453-460` does, and write one `eval_run_skills` row per kept skill carrying `skill.id`, `skill.version`, `skill.name` and its `order`. One case at a time; a per-case failure is caught, recorded as `error` on the per-case row, and the loop continues; `cases_completed` is bumped after every case; on finish, call `scoreSuite`/`sumCost` and write the run's terminal row once. A completed run is never rewritten — `server/src/modules/eval/runner.ts` — owner: `implementer` — skill: `fastify-best-practices` — → AC-13, AC-14, AC-15, AC-20, AC-22, AC-34, AC-38 → `eval_empty_case_set_refuses_to_run`, `eval_run_covers_the_set_as_it_was_at_start`, `eval_progress_counts_completed_of_total`, `eval_failed_case_does_not_stop_the_run`, `eval_run_states_failed_to_complete_count`, `eval_run_records_total_model_call_cost`, `eval_run_records_invoked_skill_versions`
- [ ] T10 **AC-17 — freeze the eval invocation's inputs.** In `runner.ts`, the call into `reviewPullRequest` passes **exactly** `{ systemPrompt: agent.systemPrompt, model: agent.model, llm: await llm(agent.provider), diff: parseUnifiedDiff(case.fragment), strategy: 'single-pass', maxRetries: DEFAULT_REVIEW_MAX_RETRIES }` plus `skills` — the resolved **bodies** of the enabled linked skills snapshotted in T9, in link order, spread as `...(skillBodies.length > 0 ? { skills: skillBodies } : {})` so an agent with no skills produces a byte-identical prompt to the no-skills shape (`run-executor.ts:249`). Pass the **same** bodies the T9 snapshot recorded, read once, so the recorded versions and the invoked text cannot drift within a run. **No other key.** It must not call `buildCallersDigest`, `buildRepoMapDigest`, `buildRankNote` or `buildProjectContext` (`run-executor.ts:211-230`), must not read `agent.repoIntel` (`run-executor.ts:205`) — suppression is unconditional, not a re-use of that flag — and must not pass `specs`, `callers`, `repoMap`, `prDescription`, `intent` or `task`. Do **not** wrap the skill bodies: `assemblePrompt` already places them in the instruction section unwrapped (`reviewer-core/src/prompt.ts:171`), which is what the spec requires. Add a file header comment stating why, and add the literal guard `grep -rn "repoIntel\|repoMap\|buildCallers\|assembleForRun\|ContextService" server/src/modules/eval/` returning **no hits** to the Full verification block. Beware `server/insights.md:25`: phrase the header comment so it does not itself match that grep (write "context enrichment", not the identifier names) — `server/src/modules/eval/runner.ts` — owner: `implementer` — skill: `onion-architecture` — → AC-17, AC-18, AC-29 → `eval_invocation_sees_only_the_case_fragment`, `eval_invocation_uses_the_agents_model_provider_and_skills`, `eval_scoring_performs_zero_model_calls`
- [ ] T11 Routes plugin for the nine endpoints in Shared contract § B — ring 4 only: parse params via `IdParams`/zod `schema:`, delegate, return the DTO; no Drizzle and no rules here (`modules/brief/routes.ts:30-56` is the template). Register the module in `server/src/modules/index.ts` (one import + one object entry, `:31-47`) — `server/src/modules/eval/routes.ts`, `server/src/modules/index.ts` — owner: `implementer` — skill: `fastify-best-practices` — → AC-1, AC-4 → `eval_agent_surface_returns_cases_and_run_history`, `eval_agent_with_no_completed_run_has_no_metrics`
- [ ] T12 Reap orphaned eval runs at boot, alongside the existing agent-run reap at `server/src/app.ts:80-85`: any `eval_suite_runs` row still `running` when the process starts belongs to a dead process — set `status='failed'`, `completed_at=now()`. Awaited before the server listens, wrapped in the same non-fatal try/catch — `server/src/app.ts`, `server/src/modules/eval/repository.ts` — owner: `implementer` — skill: `fastify-best-practices` — → AC-16 → `eval_orphaned_running_run_is_reaped_on_boot`
- [ ] T13 Seed for the e2e surfaces and for local demo: (a) give the seeded `pr_files` rows for `src/config.ts` and `src/api/users.ts` a real `patch` whose hunks cover the seeded findings' line ranges (`seed.ts:129-141` currently sets none, so no fragment can be cut today); (b) set `accepted_at` on the `src/config.ts` finding and `dismissed_at` on the `src/api/users.ts` one (`seed.ts:166-191`), so both AC-6 directions are demonstrable; (c) seed two eval cases for `Security Reviewer` (one `must_find`, one `must_not_flag`) and **two completed `eval_suite_runs`** with per-case rows, different `agent_version` values and different metric/cost values; (d) give those two runs **different `eval_run_skills` rows** — the same skill id at two different `skill_version` values — so the comparison surface renders the invoked-skill statement (AC-39) with **zero model calls**. The seed already links skills to `Test Quality Reviewer` (`seed.ts:363-407`); follow that shape. Keep every insert idempotent in the existing style — `server/src/db/seed.ts` — owner: `implementer` — skill: `drizzle-orm-patterns` — → AC-2, AC-3 → `e2e_eval_dashboard_lists_recent_runs`, `e2e_eval_dashboard_shows_agent_run_history`

---

### Track B — client

Files: `client/src/**` (excluding `*.test.ts(x)`), `client/messages/**`. Disjoint from Tracks A and C.

- [ ] T14 `hooks/eval.ts` — the only place that talks to the eval API: `useAgentEvalCases`, `useEvalCaseDraft`, `useCreateEvalCase`, `useUpdateEvalCase`, `useDeleteEvalCase`, `useAgentEvalRuns`, `useEvalRun`, `useRecentEvalRuns`, `useStartEvalRun`. `useAgentEvalRuns` sets `refetchInterval: 2000` **only while some run in the list is `running`** (Placement decision 10). Add `export * from "./eval"` to the barrel (`hooks/index.ts:4-15`) — `client/src/lib/hooks/eval.ts`, `client/src/lib/hooks/index.ts` — owner: `implementer` — skill: `react-best-practices` — → AC-15 → `evals_tab_shows_progress_and_no_metrics_while_running`
- [ ] T15 `useAgentVersion(agentId, version)` over the existing `GET /agents/:id/versions/:version` (`server/src/modules/agents/routes.ts:146`), modelled on `useSkillVersion`; a 404 resolves to `null` rather than throwing, because a version that no longer exists is a rendered state, not an error — `client/src/lib/hooks/agents.ts` — owner: `implementer` — skill: `react-best-practices` — → AC-32 → `compare_dialog_diffs_the_two_system_prompts`
- [ ] T16 Add the eval-case action to the finding card's existing action row (`FindingCard.tsx:91-112`), as a **new `onCreateEvalCase?: () => void` prop**, not a new `FindingActionKind`; wire it from `FindingsPanel` (`FindingsPanel.tsx:96-107`) to open `EvalCaseModal`; add its label + accessible name to `messages/en/prReview.json` under `finding.*` — `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx`, `.../FindingsPanel/FindingsPanel.tsx`, `client/messages/en/prReview.json` — owner: `implementer` — skill: `react-best-practices` — → AC-5 → `finding_card_offers_the_eval_case_action`
- [ ] T17 `EvalCaseModal` — the creation form. Fetches the draft, renders the file path, the line range and the fragment (as **text, never markup**; scrollable, never truncated); pre-selects the expectation type from `default_expectation_kind` and selects **nothing** when it is null (AC-6); keeps the confirm control disabled until a type is chosen (AC-7); shows the existing case instead of the form when `existing_case` is non-null (AC-10); renders the 422 reason when the fragment cannot be cut. Wrap the `Modal` children in a `padding: 24` div (`client/insights.md:61`) — `client/src/app/repos/[repoId]/pulls/[number]/_components/EvalCaseModal/{EvalCaseModal.tsx,helpers.ts,styles.ts,index.ts}` — owner: `implementer` — skill: `react-best-practices` — → AC-6, AC-7 → `eval_case_modal_preselects_from_the_decision`, `eval_case_modal_requires_a_confirmed_expectation_type`
- [ ] T18 `EvalsTab` + register it: add `{ key: "evals", labelKey: "editor.tabs.evals", icon: "FlaskConical" }` to `TABS` (`AgentEditor/constants.ts:11-15`) and a branch in `AgentEditor.tsx:25-31`. **No second `?tab=` list to update** — `agents/[id]/page.tsx:20` already derives `VALID_TABS` from `TABS`. The tab renders the case set (each row with accessibly-named edit and delete controls identifying the case), the run control, an empty-set statement that also disables the run control (AC-13), the in-progress "N of M cases" readout in an `aria-live="polite"` region with no metrics shown (AC-15), and `<RunHistoryTable agentId={agent.id} />` — `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/*`, `client/src/app/agents/[id]/_components/AgentEditor/constants.ts`, `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx` — owner: `implementer` — skill: `react-best-practices` — → AC-1, AC-13, AC-14, AC-15 → `evals_tab_shows_case_set_and_run_history`, `evals_tab_empty_set_blocks_the_run_control`, `evals_tab_run_control_starts_one_run`, `evals_tab_shows_progress_and_no_metrics_while_running`
- [ ] T19 `RunHistoryTable` — shared by the Evals tab and the dashboard. One row per run: start time, agent version, recall, precision, citation accuracy, **cost in the same row** (AC-35), pass count, failed-to-complete count. An absent metric or cost renders as an em dash with a "not available" accessible label — **never `0`**, and never `?? 0` before display (`client/insights.md:20`). A selection checkbox per row whose accessible name states the run's start time and its agent version. The compare control is disabled unless exactly two rows are selected (AC-30). Every state is conveyed by text, not by colour or bar length alone; targets are ≥24×24 px — `client/src/components/eval-runs/RunHistoryTable/{RunHistoryTable.tsx,helpers.ts,styles.ts,index.ts}` — owner: `implementer` — skill: `react-best-practices` — → AC-4, AC-22, AC-30, AC-35, AC-37 → `run_history_states_no_run_and_renders_no_metrics`, `run_history_states_failed_to_complete_count`, `run_history_compare_needs_exactly_two`, `run_history_row_shows_cost_next_to_metrics`, `run_history_absent_cost_is_not_zero`
- [ ] T20 `RunCompareDialog` + `use-focus-trap.ts`. Renders, per metric and for cost, the earlier value, the later value and the delta, all as text (AC-31, AC-36); an em dash where a value is absent (AC-37); the system-prompt diff via the existing `diffLines` (`client/src/lib/diff-lines.ts:37`) rendered like `VersionDiffModal.tsx:44-56`, or a statement that the diff cannot be shown when either `useAgentVersion` resolved to `null` (AC-32); a statement that the two runs cover different case sets when `caseSetsDiffer` is true (AC-33); and **a statement that the two runs invoked different skills when `invokedSkillsDiffer` is true (AC-39)** — rendered next to the prompt diff, since the whole point is that a metric move must not be attributed to the prompt when a skill changed. Name the differing skills by their `name` snapshot and their two `skill_version` values, as inert text. `use-focus-trap` keeps Tab inside the dialog and restores focus to the opening control on close — the vendored `Modal` provides neither (`vendor/ui/kit/Modal.tsx:26-27`). Pure delta/set/skill-set helpers live in `helpers.ts` — `client/src/components/eval-runs/RunCompareDialog/{RunCompareDialog.tsx,helpers.ts,use-focus-trap.ts,styles.ts,index.ts}` — owner: `implementer` — skill: `react-best-practices` — → AC-31, AC-32, AC-33, AC-36, AC-39 → `compare_dialog_shows_both_values_and_the_delta`, `compare_dialog_diffs_the_two_system_prompts`, `compare_dialog_states_differing_case_sets`, `compare_dialog_shows_both_costs_and_the_delta`, `compare_dialog_states_differing_invoked_skills`
- [ ] T21 `/eval` page + `EvalDashboardView`: thin `page.tsx` wrapping `AppShell` with the `Skills Lab → Eval Dashboard` crumb (`page.crumbEvalDashboard` already exists at `messages/en/eval.json:78`); the view lists the most recently completed runs across all agents newest first (AC-2), states that no run has happened yet when the list is empty rather than rendering an empty table, and lets the user select an agent to see that agent's own run history via `RunHistoryTable` (AC-3). No trend chart, no sparklines, no alert banner, no range filter — `client/src/app/eval/page.tsx`, `client/src/app/eval/_components/EvalDashboardView/*` — owner: `implementer` — skill: `next-best-practices` — → AC-2, AC-3 → `eval_dashboard_lists_recent_runs_newest_first`, `eval_dashboard_shows_a_selected_agents_history`
- [ ] T22 Nav: add `{ key: "eval", label: "Eval Dashboard", icon: "FlaskConical", href: "/eval", gKey: "e" }` to the `SKILLS LAB` group of `NAV` (`vendor/ui/nav.ts:21-46`; `key` and `href` must match `activeKeyFor`'s `/eval` branch at `app-shell/helpers.ts:35`) — this alone gives the sidebar (`Sidebar.tsx:45`), the `g`-chord (`useGlobalShortcuts.ts:45`) and the command palette (`useShellCommands.ts:21`). Then **collapse the duplicate shortcut registry**: replace the five hand-written `Navigation` entries in `SHORTCUTS` (`nav.ts:68-79`) with a derivation from `NAV` (`Go to ${item.label}` / `g ${item.gKey}` for every item carrying a `gKey`), leaving the `Findings`/`Actions`/`Global` entries static, so a future nav item can never again be missing from the shortcuts help — `client/src/vendor/ui/nav.ts` — owner: `implementer` — skill: `frontend-ui-architecture` — → AC-2 → `nav_shortcut_help_derives_from_nav`
- [ ] T23 Extend `messages/en/eval.json` with the keys the new surfaces need (`evalsTab.*` additions for the run control, the progress readout, the empty-set statement; `runHistory.*`; `compare.*` including the differing-skills statement; `caseModal.*`). Reuse the existing keys where they already fit (`dashboard.recentRuns`, `dashboard.noRuns`, `dashboard.table.*`, `evalsTab.casesHeading`, `evalsTab.emptyCases`, `page.crumb*`, `messages/en/eval.json:1-84`) rather than adding near-duplicates (`client/insights.md:33`); leave the non-goal keys in place and unrendered — `client/messages/en/eval.json` — owner: `implementer` — skill: `next-best-practices` — → AC-4 → `run_history_states_no_run_and_renders_no_metrics`

---

### Track C — tests

Files: `server/test/**`, `client/src/**/*.test.ts(x)`, `e2e/specs/**`. Disjoint from Tracks A and B by file, though some client test files sit in the same folders as Track B's components.

- [ ] T24 Contract tests: `expectation_kind` is required (no default), every metric and the cost are `.nullable()` and not `.default(0)`, `EvalReturnedFinding` parses a document lacking `severity`/`title`, `EvalInvokedSkill` requires `skill_id` and `skill_version` and `EvalSuiteRun` rejects a payload with no `invoked_skills` key, and **the SPEC-03 blocks in the two vendor copies are byte-identical** (read both files, slice from the `SPEC-03` banner, compare) — `server/test/eval-contracts.test.ts` — owner: `test-writer` — skill: `zod` — → AC-7, AC-27, AC-37, AC-38 → `eval_contracts_reject_missing_expectation_kind`, `eval_contracts_keep_absent_metrics_nullable`, `eval_contracts_carry_invoked_skill_identity_and_version`, `eval_contracts_vendor_copies_are_identical`
- [ ] T25 Helper unit tests: `cutFragment` keeps every intersecting hunk whole with its context lines, emits the three `diff --git`/`---`/`+++` headers so the result re-parses through `parseUnifiedDiff`, drops non-intersecting hunks, and returns `null` for an empty patch and for a range outside every hunk; `defaultExpectationKind` returns `must_find` / `must_not_flag` / `null` for the three decision states; `findOverlap` returns the two overlapping ranges and `null` when a `must_not_flag` sits on a different file — `server/test/eval-helpers.test.ts` — owner: `test-writer` — skill: `typescript-expert` — → AC-5, AC-6, AC-11 → `eval_cut_fragment_keeps_whole_intersecting_hunks`, `eval_default_expectation_kind_from_decision`, `eval_find_overlap_reports_the_two_ranges`
- [ ] T26 Scoring unit tests, one per rule: match is file equality + range overlap and compares nothing else; recall over `must_find` expectations; precision ignores findings matching no expectation in numerator and denominator alike; citation accuracy over **all** returned findings including ungrounded ones; each metric is `null` (not `0`) when its denominator is zero, including the all-`must_not_flag` set and the returned-nothing run; the case pass rule; incomplete cases are excluded from all three metrics; `sumCost` propagates `null` — `server/test/eval-scoring.test.ts` — owner: `test-writer` — skill: `typescript-expert` — → AC-21, AC-23, AC-24, AC-25, AC-26, AC-27, AC-28 → `eval_scoring_matches_on_file_and_overlap`, `eval_scoring_recall_over_must_find`, `eval_scoring_precision_ignores_unlabelled`, `eval_scoring_citation_accuracy_over_all_returned`, `eval_scoring_absent_metric_is_null_not_zero`, `eval_scoring_case_pass_rule`, `eval_scoring_excludes_incomplete_cases`
- [ ] T27 Runner unit tests against a **counting** `LLMProvider` (the `brief.it.test.ts:1-9` shape) and stub repositories, all hermetic: the invocation's `ReviewInput` carries only the frozen keys — `systemPrompt`, `model`, `llm`, `diff`, `strategy`, `maxRetries` and `skills` — with no `specs`/`callers`/`repoMap`/`prDescription`/`intent`/`task`, and the assembled prompt contains the case fragment and no repo-derived section, for an agent with `repo_intel: true` (AC-17); the provider resolved is the agent's own, the model passed is the agent's own, **and the enabled linked skills' bodies are passed in link order while a disabled linked skill's body is not** (AC-18); a provider that blocks on a deferred promise between cases lets the test assert `cases_completed` advancing 1-of-3 → 2-of-3 while `status` is still `running` (AC-15); a provider that throws on case 2 of 3 leaves the other two invoked (AC-20) and excluded from the metrics (AC-21) and counted (AC-22); the counter reads exactly `cases` after the run and does not move during scoring (AC-29) — `server/test/eval-runner.test.ts` — owner: `test-writer` — skill: `typescript-expert` — → AC-15, AC-17, AC-18, AC-20, AC-22, AC-29 → `eval_progress_counts_completed_of_total`, `eval_invocation_sees_only_the_case_fragment`, `eval_invocation_uses_the_agents_model_provider_and_skills`, `eval_failed_case_does_not_stop_the_run`, `eval_run_states_failed_to_complete_count`, `eval_scoring_performs_zero_model_calls`
- [ ] T28 Case-lifecycle integration tests over real Postgres (`startPg`/`dockerAvailable`, `secrets: new MockSecretsProvider()` in the overrides): the draft carries the finding's file, range and a cut fragment; creating stores the case against the agent that produced the finding; **the stored fragment/file/range/kind are unchanged after the finding is edited, re-decided and deleted** (AC-9); a second conversion of the same finding returns the existing case and creates no second row; an overlapping `must_not_flag`/`must_find` pair is rejected and the response names both ranges; editing and soft-deleting a case leave a completed run's metrics and per-case rows untouched (AC-12) — `server/test/eval-cases.it.test.ts` — owner: `test-writer` — skill: `drizzle-orm-patterns` — → AC-5, AC-8, AC-9, AC-10, AC-11, AC-12 → `eval_draft_carries_file_range_and_fragment`, `eval_create_stores_case_for_the_finding_agent`, `eval_case_is_immutable_when_its_finding_changes`, `eval_second_conversion_returns_the_existing_case`, `eval_overlapping_expectations_are_rejected`, `eval_edit_and_delete_leave_recorded_runs_unchanged`
- [ ] T29 Run-lifecycle integration tests, same fixture shape, counting mock provider: an empty case set refuses to start a run; a run covers the set as it was at start (a case added mid-run does not join it); a second start while one is `running` is refused; the run records the agent's current `version`; **the run records one row per invoked skill carrying that skill's id and the `skills.version` current at run start, a skill whose body is then edited (version bumped) does not retroactively change the recorded version, and deleting the skill afterwards leaves the recorded row intact** (AC-38); the run records the summed model-call cost; an orphaned `running` row is reaped when a new app instance boots. **One test builds its `actual_output` fixture in the OLD shape** — insert the jsonb **raw** as `[{ file, start_line, end_line, grounded }]`, with `severity` and `title` absent, exactly as a row written before those keys existed would look — and asserts `GET /eval-runs/:id` returns it rather than throwing; building the fixture through `EvalReturnedFinding.parse()` would defeat it (`server/insights.md:46`) — `server/test/eval-runs.it.test.ts` — owner: `test-writer` — skill: `drizzle-orm-patterns` — → AC-12, AC-13, AC-14, AC-16, AC-19, AC-34, AC-38 → `eval_empty_case_set_refuses_to_run`, `eval_run_covers_the_set_as_it_was_at_start`, `eval_runs_one_running_per_agent`, `eval_orphaned_running_run_is_reaped_on_boot`, `eval_run_records_agent_version`, `eval_run_records_invoked_skill_versions`, `eval_run_records_total_model_call_cost`, `eval_run_detail_tolerates_a_legacy_result_document`
- [ ] T30 Route-level integration tests for the read surfaces: `GET /agents/:id/eval-cases` + `GET /agents/:id/eval-runs` return an agent's case set and history; an agent whose runs are all still `running` (or which has none) returns a history carrying **no** recall/precision/citation value rather than zeros (AC-4); `GET /eval-runs` returns only completed runs, newest first, across agents; every path 404s for another workspace's id, including the read-only ones — `server/test/eval-routes.it.test.ts` — owner: `test-writer` — skill: `fastify-best-practices` — → AC-1, AC-2, AC-3, AC-4 → `eval_agent_surface_returns_cases_and_run_history`, `eval_agent_with_no_completed_run_has_no_metrics`, `eval_dashboard_lists_completed_runs_newest_first`
- [ ] T31 `EvalCaseModal` tests (fetch mocked, `fireEvent`, assertions after an `await findBy*` — `client/insights.md:43,56`): an accepted finding pre-selects `must_find`, a dismissed one `must_not_flag`, an undecided one selects nothing; the confirm control stays disabled until a type is chosen and no POST fires; an existing case is shown instead of the form; the "cannot cut a fragment" reason renders — `client/src/app/repos/[repoId]/pulls/[number]/_components/EvalCaseModal/EvalCaseModal.test.tsx` — owner: `test-writer` — skill: `react-testing-library` — → AC-6, AC-7 → `eval_case_modal_preselects_from_the_decision`, `eval_case_modal_requires_a_confirmed_expectation_type`
- [ ] T32 `FindingCard` test: the eval-case action renders in the action row with an accessible name and invokes `onCreateEvalCase` — extend the existing file rather than adding a second one — `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.test.tsx` — owner: `test-writer` — skill: `react-testing-library` — → AC-5 → `finding_card_offers_the_eval_case_action`
- [ ] T33 `EvalsTab` tests: the tab renders the case set and the run history; an empty set states so and the run control is disabled and fires no POST; activating the run control fires exactly one POST; while a run is `running` the tab renders "N of M" and renders **no** recall/precision/citation value — `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.test.tsx` — owner: `test-writer` — skill: `react-testing-library` — → AC-1, AC-13, AC-14, AC-15 → `evals_tab_shows_case_set_and_run_history`, `evals_tab_empty_set_blocks_the_run_control`, `evals_tab_run_control_starts_one_run`, `evals_tab_shows_progress_and_no_metrics_while_running`
- [ ] T34 `RunHistoryTable` tests: an agent with no completed run states so and renders no metric value; the failed-to-complete count is stated; the compare control is disabled at zero, one and three selections and enabled at exactly two; a row renders its cost next to its three metrics; a `null` cost renders as an em dash with a "not available" accessible label and the string `"0"` appears nowhere in that cell. Every hand-built `EvalSuiteRun` fixture in this file must supply `invoked_skills` — it is a required field, and omitting it is a typecheck error and a render-time throw, the `client/insights.md:24` shape — `client/src/components/eval-runs/RunHistoryTable/RunHistoryTable.test.tsx` — owner: `test-writer` — skill: `react-testing-library` — → AC-4, AC-22, AC-30, AC-35, AC-37 → `run_history_states_no_run_and_renders_no_metrics`, `run_history_states_failed_to_complete_count`, `run_history_compare_needs_exactly_two`, `run_history_row_shows_cost_next_to_metrics`, `run_history_absent_cost_is_not_zero`
- [ ] T35 `RunCompareDialog` tests: each metric renders both values and the delta as text; both costs and their delta render; a system-prompt difference renders from the two fetched versions and a 404 on either renders the "cannot be shown" statement instead of an empty diff; two runs with different `case_ids` render the differing-case-sets statement; **two runs whose `invoked_skills` differ by a skill id, and separately two runs carrying the same skill id at two different `skill_version` values, both render the differing-invoked-skills statement, while two runs with identical `invoked_skills` render neither** (AC-39); focus stays inside the dialog on Tab and returns to the opening control on close. Same required-`invoked_skills` fixture rule as T34 — `client/src/components/eval-runs/RunCompareDialog/RunCompareDialog.test.tsx` — owner: `test-writer` — skill: `react-testing-library` — → AC-31, AC-32, AC-33, AC-36, AC-39 → `compare_dialog_shows_both_values_and_the_delta`, `compare_dialog_diffs_the_two_system_prompts`, `compare_dialog_states_differing_case_sets`, `compare_dialog_shows_both_costs_and_the_delta`, `compare_dialog_states_differing_invoked_skills`
- [ ] T36 `EvalDashboardView` test: recent completed runs render newest first; an empty workspace states that no run has happened rather than rendering an empty table; selecting an agent renders that agent's own run history — `client/src/app/eval/_components/EvalDashboardView/EvalDashboardView.test.tsx` — owner: `test-writer` — skill: `react-testing-library` — → AC-2, AC-3 → `eval_dashboard_lists_recent_runs_newest_first`, `eval_dashboard_shows_a_selected_agents_history`
- [ ] T37 Nav test: the shortcuts-help `Navigation` group contains one entry per `NAV` item carrying a `gKey`, including the new Eval Dashboard entry — this is the regression guard for the collapsed registry, so it must fail if someone re-hand-writes `SHORTCUTS` — `client/src/components/app-shell/nav-registry.test.ts` — owner: `test-writer` — skill: `react-testing-library` — → AC-2 → `nav_shortcut_help_derives_from_nav`
- [ ] T38 e2e flow: open `/agents`, click the seeded `Security Reviewer`, click the `Evals` tab button, `wait --url tab=evals`, then **assert on copy only the Evals tab renders** (the case-set heading and a seeded case name) — the URL assertion alone passes on a broken build (`e2e/specs/11-agent-context-tab.flow.json:3,12`) — `e2e/specs/13-agent-evals-tab.flow.json` — owner: `test-writer` — skill: `frontend-ui-architecture` — → AC-1 → `e2e_agent_evals_tab_renders`
- [ ] T39 e2e flow: open `/eval` from the sidebar, assert the dashboard's own copy renders and a seeded run's start time is listed; then select the seeded agent and assert that agent's run history renders — `e2e/specs/14-eval-dashboard.flow.json` — owner: `test-writer` — skill: `frontend-ui-architecture` — → AC-2, AC-3 → `e2e_eval_dashboard_lists_recent_runs`, `e2e_eval_dashboard_shows_agent_run_history`
- [ ] T40 e2e flow: from the seeded agent's run history, select the two seeded runs, open the comparison, and assert on copy that both runs' values and a delta are rendered — `e2e/specs/15-eval-run-compare.flow.json` — owner: `test-writer` — skill: `frontend-ui-architecture` — → AC-31 → `e2e_eval_run_compare_shows_deltas`

---

### Integration

- [ ] T41 Create the `pnpm verify:l06` gate: a **root `package.json`** carrying `"private": true`, a `name`, and `scripts` only — **no `dependencies`, no `devDependencies`, no `workspaces` key** (this repo has no workspace root by design, root `CLAUDE.md`) — with `"verify:l06": "bash scripts/verify-l06.sh"`; and `scripts/verify-l06.sh` running, in order and failing fast: `cd server && pnpm typecheck`, `cd server && pnpm test:unit --reporter=dot`, `cd server && pnpm test:integration --reporter=dot`, `cd client && pnpm typecheck`, `cd client && pnpm test:unit --reporter=dot`, `cd evals && pnpm eval:quality`. It must **not** run `./scripts/e2e.sh` and must **not** run any live LLM eval tier (`evals/package.json:8-11`) — those cost money and fluctuate. Add `/pnpm-lock.yaml` to `.gitignore` (`node_modules/` is already covered at `.gitignore:1`) so a stray root `pnpm install` cannot commit a root lockfile. Mirror `scripts/e2e.sh`'s `set -euo pipefail` + `ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"` header — `package.json`, `scripts/verify-l06.sh`, `.gitignore` — owner: `implementer` — skill: `engineering-insights` — → AC-29 → `eval_scoring_performs_zero_model_calls`
- [ ] T42 Integration pass — files: none (verification only, no source edits). Run the Full verification block below end to end, including the AC-17 static guard grep and `./scripts/e2e.sh`. Confirm the two implementation tracks meet: the client's contract copy compiles against the server's (T24 green), the seeded data the e2e flows depend on (T13) is present, and `POST /agents/:id/eval-runs` → poll `GET /agents/:id/eval-runs` → `GET /eval-runs/:id` round-trips through the real routes with a mock provider, with `invoked_skills` populated end to end from `eval_run_skills`. Report any failure back rather than patching Track A/B files from here — owner: `implementer` — skill: `engineering-insights` — → AC-14, AC-34, AC-38 → `eval_run_covers_the_set_as_it_was_at_start`, `eval_run_records_total_model_call_cost`, `eval_run_records_invoked_skill_versions`

## Traceability

| AC | Tasks | Verified by |
|----|-------|-------------|
| AC-1 | T11, T18, T30, T33, T38 | `eval_agent_surface_returns_cases_and_run_history`, `evals_tab_shows_case_set_and_run_history`, `e2e_agent_evals_tab_renders` |
| AC-2 | T7, T13, T21, T22, T30, T36, T37, T39 | `eval_dashboard_lists_completed_runs_newest_first`, `eval_dashboard_lists_recent_runs_newest_first`, `nav_shortcut_help_derives_from_nav`, `e2e_eval_dashboard_lists_recent_runs` |
| AC-3 | T7, T13, T21, T30, T36, T39 | `eval_dashboard_shows_a_selected_agents_history`, `e2e_eval_dashboard_shows_agent_run_history` |
| AC-4 | T11, T19, T23, T30, T34 | `eval_agent_with_no_completed_run_has_no_metrics`, `run_history_states_no_run_and_renders_no_metrics` |
| AC-5 | T5, T8, T16, T25, T28, T32 | `eval_draft_carries_file_range_and_fragment`, `eval_cut_fragment_keeps_whole_intersecting_hunks`, `finding_card_offers_the_eval_case_action` |
| AC-6 | T5, T17, T25, T31 | `eval_default_expectation_kind_from_decision`, `eval_case_modal_preselects_from_the_decision` |
| AC-7 | T1, T2, T17, T24, T31 | `eval_contracts_reject_missing_expectation_kind`, `eval_contracts_vendor_copies_are_identical`, `eval_case_modal_requires_a_confirmed_expectation_type` |
| AC-8 | T8, T28 | `eval_create_stores_case_for_the_finding_agent` |
| AC-9 | T8, T28 | `eval_case_is_immutable_when_its_finding_changes` |
| AC-10 | T8, T17, T28 | `eval_second_conversion_returns_the_existing_case` |
| AC-11 | T5, T8, T25, T28 | `eval_overlapping_expectations_are_rejected`, `eval_find_overlap_reports_the_two_ranges` |
| AC-12 | T7, T28, T29 | `eval_edit_and_delete_leave_recorded_runs_unchanged`, `eval_run_detail_tolerates_a_legacy_result_document` |
| AC-13 | T9, T18, T29, T33 | `eval_empty_case_set_refuses_to_run`, `evals_tab_empty_set_blocks_the_run_control` |
| AC-14 | T9, T18, T29, T33, T42 | `eval_run_covers_the_set_as_it_was_at_start`, `evals_tab_run_control_starts_one_run` |
| AC-15 | T9, T14, T18, T27, T33 | `eval_progress_counts_completed_of_total`, `evals_tab_shows_progress_and_no_metrics_while_running` |
| AC-16 | T3, T12, T29 | `eval_runs_one_running_per_agent`, `eval_orphaned_running_run_is_reaped_on_boot` |
| AC-17 | T10, T27 | `eval_invocation_sees_only_the_case_fragment` |
| AC-18 | T10, T27 | `eval_invocation_uses_the_agents_model_provider_and_skills` |
| AC-19 | T3, T4, T29 | `eval_run_records_agent_version` |
| AC-20 | T9, T27 | `eval_failed_case_does_not_stop_the_run` |
| AC-21 | T6, T26 | `eval_scoring_excludes_incomplete_cases` |
| AC-22 | T9, T19, T27, T34 | `eval_run_states_failed_to_complete_count`, `run_history_states_failed_to_complete_count` |
| AC-23 | T6, T26 | `eval_scoring_matches_on_file_and_overlap` |
| AC-24 | T6, T26 | `eval_scoring_recall_over_must_find` |
| AC-25 | T6, T26 | `eval_scoring_precision_ignores_unlabelled` |
| AC-26 | T6, T26 | `eval_scoring_citation_accuracy_over_all_returned` |
| AC-27 | T1, T6, T24, T26 | `eval_scoring_absent_metric_is_null_not_zero`, `eval_contracts_keep_absent_metrics_nullable` |
| AC-28 | T6, T26 | `eval_scoring_case_pass_rule` |
| AC-29 | T10, T27, T41 | `eval_scoring_performs_zero_model_calls` |
| AC-30 | T19, T34 | `run_history_compare_needs_exactly_two` |
| AC-31 | T20, T35, T40 | `compare_dialog_shows_both_values_and_the_delta`, `e2e_eval_run_compare_shows_deltas` |
| AC-32 | T15, T20, T35 | `compare_dialog_diffs_the_two_system_prompts` |
| AC-33 | T20, T35 | `compare_dialog_states_differing_case_sets` |
| AC-34 | T9, T29, T42 | `eval_run_records_total_model_call_cost` |
| AC-35 | T19, T34 | `run_history_row_shows_cost_next_to_metrics` |
| AC-36 | T20, T35 | `compare_dialog_shows_both_costs_and_the_delta` |
| AC-37 | T1, T19, T24, T34 | `run_history_absent_cost_is_not_zero`, `eval_contracts_keep_absent_metrics_nullable` |
| AC-38 | T1, T2, T3, T4, T7, T9, T24, T29, T42 | `eval_run_records_invoked_skill_versions`, `eval_contracts_carry_invoked_skill_identity_and_version` |
| AC-39 | T20, T35 | `compare_dialog_states_differing_invoked_skills` |

## Verification

### Fast loop (implementer / test-writer, after every step)

- `cd server && pnpm typecheck`
- `cd server && pnpm test:unit --reporter=dot`
- `cd client && pnpm typecheck`
- `cd client && pnpm test:unit --reporter=dot`

(Track B may skip the server commands and vice versa. No `test:integration` and
no bare `pnpm test` in this loop.)

### Full (plan-verifier, once at the end)

- `cd server && pnpm typecheck`
- `cd server && pnpm test:unit --reporter=dot`
- `cd server && pnpm test:integration --reporter=dot` (Docker; T28/T29/T30 are
  `*.it.test.ts`). If a single file fails only in the whole-suite run, re-run that
  one file alone before concluding a regression — `server/insights.md:62`.
- `cd client && pnpm typecheck`
- `cd client && pnpm test:unit --reporter=dot`
- `cd evals && pnpm eval:quality`
- `pnpm verify:l06` (from the repo root — must exit 0 and must run none of the
  live model tiers)
- **AC-17 static guard:**
  `grep -rn "repoIntel\|repoMap\|buildCallers\|assembleForRun\|ContextService" server/src/modules/eval/`
  → **no hits**. (Skills are configuration, not repository content, so
  `linkedSkills` is deliberately absent from this list.)
- **Ring guard:**
  `grep -rn "drizzle-orm\|db/schema\|fastify" server/src/modules/eval/scoring.ts server/src/modules/eval/helpers.ts`
  → **no hits**
- `./scripts/e2e.sh` — this plan adds two UI entry points (the agent editor's
  Evals tab and the `/eval` route), so the browser flows are mandatory, not
  optional. 15 flows should pass.
- Manual smoke, **owner: `human`** (needs a browser and a real API key; never the
  only evidence for any AC — every AC above is bound to an automated test):
  `./scripts/dev.sh`, open a PR with a decided finding, turn it into an eval case,
  run the set, edit a linked skill's body, run it again, and confirm the metrics,
  the cost, the prompt diff and the differing-invoked-skills statement render.

## Explicit note

Architecture and security review are out of scope for `implementer` and are
handled by separate review agents/skills after implementation.

## Open questions / assumptions

1. **The spec is `Status: draft`** (`docs/specs/cross/SPEC-03-eval-pipeline.md:3`)
   although the task described it as approved. Planned against as written;
   flip the status before `implementer` runs, or confirm the header is stale.
2. **`reviewer-core` is listed as a module in the spec header (`SPEC-03:4`) but
   this plan changes nothing there** — confirmed correct by the coordinator.
   `reviewPullRequest` already returns kept findings, dropped findings and
   `costUsd` (`run.ts:107-125`), already accepts resolved skill bodies
   (`run.ts:57`), and `assemblePrompt` already places those bodies in the
   instruction section unwrapped (`prompt.ts:171`), which is exactly what the
   spec's Untrusted-inputs section requires.
3. **AC-38's recorded skill version tracks a skill's BODY only.** `skills.version`
   is bumped by `skills/helpers.ts::isBodyChange`, which deliberately does not
   move on a rename, a retype or an enable/disable (`server/insights.md:32`) —
   the spec states the same boundary at `SPEC-03:253-259`. Practical reach, so
   nobody over-reads the comparison: a rewritten or re-imported body **is**
   caught (version moves); a skill linked or unlinked **is** caught (the invoked
   set changes); a skill disabled **is** caught (it drops out of the invoked set,
   because the runner keeps only enabled skills, `run-executor.ts:453`); a pure
   **rename is not caught by anything**, and is the first thing to suspect behind
   an unexplained metric move.
4. **Suite cost is a null-propagating sum**: one case with an undetermined cost
   makes the whole run's cost unavailable, mirroring
   `reviewer-core/src/review/run.ts:197`. The spec says only "a run whose cost
   cannot be determined has no cost" and does not settle the partial case; this
   is the conservative reading and keeps "free" and "unmeasured" distinguishable.
5. **AC-16 is enforced by a partial unique index**, not only by a service-level
   check, so two concurrent `POST /agents/:id/eval-runs` cannot both win. The
   409 comes from translating that constraint violation. Assumes a single API
   instance per database, the same assumption already recorded at
   `server/src/app.ts:78-79`.
6. **The comparison still has no endpoint** — confirmed by the coordinator.
   AC-39 needs no extra fetch either, because `invoked_skills` rides on the
   `EvalSuiteRun` records the dialog already has.
7. **The `Modal` primitive is left untouched** and the comparison dialog carries
   its own focus trap. Every other modal in the app therefore still lacks one
   (`vendor/ui/kit/Modal.tsx:26-27`) — a real, pre-existing a11y gap that this
   feature does not widen and does not fix. Worth its own piece of work.
8. **The seeded demo data is being changed** (T13: patches, decisions, eval cases,
   two completed runs and their differing invoked-skill rows). This only affects
   freshly-created databases — `seed.ts`'s guards are `if (!pr)`-style — so an
   existing dev database will not pick up the patches and "turn into eval case"
   will keep refusing there until it is re-seeded. The hermetic e2e runner
   creates a fresh database every time (`scripts/e2e.sh:126-128`), so the flows
   are unaffected.
