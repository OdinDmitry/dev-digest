# Development Plan: Eval Pipeline — SPEC-04 delta

Spec: docs/specs/cross/SPEC-04-eval-pipeline.md
Supersedes-plan: docs/plans/2026-08-20-eval-pipeline.md (SPEC-03, fully executed)
Date: 2026-08-21
Execution mode: multi-agent (3 tracks + integration)

## Goal

Move the shipped eval pipeline from SPEC-03 to SPEC-04. Three kinds of work,
and the third is what makes this plan unusual: **new** behaviour (single-case
verification, per-case results, severity/category on a case, the per-agent
dashboard summary), **changed** behaviour (the expectation type becomes derived
instead of chosen, progress moves onto the run control, the dashboard becomes
one filtered run list), and **removed** behaviour whose tests pass today and
assert things SPEC-04 forbids (the run history on the agent's evals surface, the
expectation-type control, the editable expectation set and the AC-11 overlap
rejection). A test bound to a retired criterion is deleted or rewritten *by a
named task* — never left green and meaningless.

## Out of scope

- Everything in SPEC-04 § Non-goals. Restated for the two that this codebase
  makes tempting: **the dashboard's run list gains no per-case column** (per-case
  results belong to the agent's evals surface), and **a verification is never
  recorded as a run** — no `eval_suite_runs` row, no `eval_runs` row, ever.
- **No changes to `reviewer-core/`.** The engine already returns kept findings,
  dropped findings and `costUsd`, and already places skill bodies in the
  instruction section unwrapped. The verification path reuses the *same*
  invocation, so nothing there moves either.
- **No rewrite of historical runs.** A completed run is never rewritten
  (SPEC-04 § Contracts, *Eval run*). Existing `eval_suite_runs` rows do not
  gain per-case matched counts, and existing `eval_cases` rows do not acquire a
  severity or a category retroactively — SPEC-04's own edge case says such a
  case shows them as unavailable.
- **No collapse of `eval_case_expectations` into a column on `eval_cases`.** A
  case still carries exactly one expectation row; only the path that *edits* the
  expectation set is removed. Migrating live rows to prove a point SPEC-04 does
  not ask for is churn.
- **No new port in `shared/adapters.ts`, no SSE, no job-runner use.** The only
  outbound effect stays the LLM call already behind `LLMProvider`.
- **No change to `FindingActionKind`** — the eval-case action is still not an
  accept/dismiss verb.
- Non-goal copy already sitting unrendered in `client/messages/en/eval.json`
  (`caseEditor.runCase`, `caseEditor.tabs.prMeta`, `dashboard.metricTrend`,
  `evalsTab.newCase`) stays in the file and stays unrendered — root `CLAUDE.md`
  "course starter" convention.

## Constraints

Every claim below was read at the cited line **in this session**. The SPEC-03
plan's Constraints section is still accurate for everything it lists about the
codebase *outside* the eval module; only the eval-specific facts are restated
here, because the eval module now exists and the old plan describes it as it was
going to be, not as it is.

**What is shipped and must be changed, not assumed**

- `GET /eval-runs` returns **completed runs only** —
  `EvalRepository.listCompletedSuiteRuns` filters
  `eq(t.evalSuiteRuns.status, 'completed')`
  (`server/src/modules/eval/repository.ts:460`), reached from
  `server/src/modules/eval/routes.ts:113-120`. AC-62 asks for "one list of eval
  runs across all agents" with no status qualifier, and SPEC-04's edge cases
  require a run whose every case failed to complete to stay visible. The filter
  must go.
- The expectation set is **editable through the API today**:
  `EvalCaseUpdate` carries `expectations`
  (`server/src/vendor/shared/contracts/eval-ci.ts:334-339`),
  `EvalService.updateCase` runs the AC-11 overlap check on it
  (`server/src/modules/eval/service.ts:133-141`), and
  `EvalRepository.updateCase` deletes and re-inserts the child rows
  (`server/src/modules/eval/repository.ts:284-295`). SPEC-04 § Contracts
  (*Eval case*) says the expectation is captured once and is not editable, and
  retires AC-11 outright. All three must go, together with
  `findOverlap` (`server/src/modules/eval/helpers.ts:107-121`), whose only
  production caller is that check.
- The expectation type is **chosen by the user today**: the modal renders a
  `role="radiogroup"` with two radios
  (`client/src/app/repos/[repoId]/pulls/[number]/_components/EvalCaseModal/EvalCaseModal.tsx:129-150`)
  and `EvalCaseCreate` requires `expectation_kind` on the wire
  (`server/src/vendor/shared/contracts/eval-ci.ts:326-332`). AC-40 forbids the
  control; AC-41 makes the server the only place the type is decided.
- The eval-case action **renders unconditionally**, with no decision check —
  `{onCreateEvalCase && <Button …>}` at
  `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx:117-121`.
  The same component already reads the decision it needs two lines up:
  `const accepted = !!f.accepted_at; const dismissed = !!f.dismissed_at;`
  (`FindingCard.tsx:55-56`) — so AC-42 needs **no extra fetch**.
- The agent's evals surface **renders the run history**:
  `<RunHistoryTable agentId={agent.id} />` at
  `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.tsx:139`.
  AC-59 forbids it.
- Run progress is rendered in a **separate block below the header**, not on the
  control: `{running && <div style={s.progress} role="status" aria-live="polite">…}`
  (`EvalsTab.tsx:120-124`), while the run control itself only swaps its label
  between `evalsTab.run` and `evalsTab.running` (`EvalsTab.tsx:112-117`). AC-60
  puts the count on the control.
- The dashboard renders **two lists**: its own recent-runs table
  (`client/src/app/eval/_components/EvalDashboardView/EvalDashboardView.tsx:32-78`,
  no cost column) and, below an agent picker, a second `RunHistoryTable`
  (`EvalDashboardView.tsx:96`). AC-62/AC-64 want one list plus a filter, and
  AC-35 requires the cost beside the metrics in that one list.
- The agent picker already marks selection with `aria-pressed`
  (`EvalDashboardView.tsx:88`) — AC-65 needs the *agent row* of the summary
  list to carry it, which is a different element from today's chip.
- `RunHistoryTable` fetches its own data with `useAgentEvalRuns(agentId)`
  (`client/src/components/eval-runs/RunHistoryTable/RunHistoryTable.tsx:36`), so
  it cannot render an unfiltered cross-agent list as written.
- `useRecentEvalRuns` does **not** poll
  (`client/src/lib/hooks/eval.ts:117-122`), unlike `useAgentEvalRuns`, which
  polls at 2 s while any run is `running` (`client/src/lib/hooks/eval.ts:97-105`).
  Once the dashboard list includes `running` runs, it needs the same predicate.

**Schema and data**

- `eval_cases` is the pre-existing table extended by migration `0017`
  (`server/src/db/schema/eval.ts:34-67`). It has **live rows in the developer's
  workspace**, so every column this plan adds is nullable — which is also
  exactly what SPEC-04's "case created before severity and category were
  captured" edge case describes.
- Latest applied migration is `0017_happy_moonstone.sql`; the new one is
  `0018`. `server/src/db/migrations/` is on the do-not-touch list — generate with
  `pnpm db:generate`, never hand-edit. `drizzle-kit generate` only prompts (and
  hangs on this sandbox's stdin) when a table's diff both removes and adds
  columns (`server/insights.md:40`); this diff only adds, so no prompt is
  expected.
- `eval_runs` stays the per-case, per-run permanent copy
  (`server/src/db/schema/eval.ts:166-188`). A verification must never write to
  it — that is what makes AC-50 structural rather than a promise.
- `EvalCaseRow` / `EvalExpectationRow` exist twice: as `$inferSelect` types in
  `server/src/db/rows.ts:20-24` **and** as hand-written structural interfaces in
  `server/src/modules/eval/repository.ts:25-43`. The hand-written pair is a
  second enumeration of the same column list, and adding a column to the table
  without adding it there leaves the mapper unable to read it. Collapsed by D5.
- Reading a jsonb document goes through `safeParse` with a fallback, never a
  bare `as` — the module already does this for `actual_output`
  (`server/src/modules/eval/repository.ts:486`), and the incident behind the rule
  is `server/insights.md:48`. The new `latest_result` column follows it.
- `.default()` makes a field **required** in `z.infer`'s output type
  (`server/insights.md:43`), and a hand-built fixture missing a required field
  throws at render time in a client test, not just at typecheck
  (`client/insights.md:28`). `EvalCaseRecord` gains three required keys in this
  revision (`severity`, `category`, `latest_result`, all `.nullable()`), so every
  hand-built `EvalCaseRecord` literal in a client test must supply them.
- Any list ordering by a non-unique column appends the primary key as the final
  `ORDER BY` term (`server/insights.md:50`) — already honoured by every method
  in `repository.ts`, and the new reads must keep doing it.
- `findings.severity` and `findings.category` are both `text NOT NULL`
  (`server/src/db/schema/reviews.ts:36-37`) and reach the service through
  `ReviewRepository.findingContext`
  (`server/src/modules/reviews/repository.ts:142-146`), which already returns the
  whole `FindingRow`. AC-44 therefore needs no new read.
- A finding's own `start_line`/`end_line` is occasionally inverted (a model
  artefact, ~1 in 20 rows in this workspace — `server/insights.md:47`).
  `normalizeRange` (`server/src/modules/eval/helpers.ts:25-27`) is called on both
  write paths today; the verification path inherits it because it reads a stored
  case, whose range was normalised at creation.

**Contracts**

- `@devdigest/shared` is copied, not linked: `server/src/vendor/shared/` and
  `client/src/vendor/shared/` are the only two copies, and
  `eval_contracts_vendor_copies_are_identical` compares them **byte for byte**
  from the `// ==== SPEC-03 eval pipeline ====` banner
  (`server/src/vendor/shared/contracts/eval-ci.ts:277`) onward. Keep that banner
  text unchanged and edit inside the block; save the client copy with **CRLF**
  line endings — the last re-sync failed this check on line endings alone
  (`server/insights.md:61`).
- Before adding a contract name, grep the whole `contracts/` folder: a collision
  only surfaces at the barrel (`server/insights.md:31`). Done for this
  revision — see *Entry points & duplicate registries*.

**Runtime**

- The eval runner deliberately does **not** go through `container.jobs` (120 s
  timeout, 2 retries would double-spend). A single-case verification is one
  model call and is served **synchronously** on the request; neither the client
  (`client/src/lib/api.ts:21-33` sets no timeout and no `AbortSignal`) nor
  Fastify imposes one, so the only bound is Node's 300 s server
  `requestTimeout`. Recorded as an assumption, not a certainty.
- Orphaned `running` eval runs are already reaped at boot
  (`server/src/app.ts:92`). A verification creates no row, so it needs no reaper.
- AC-16 bars a second *run*; SPEC-04's edge case explicitly permits a
  verification while a suite run is in progress. No lock, no partial index, no
  409 on the verify route.

**Client**

- `@testing-library/user-event` is not installed — use `fireEvent`
  (`client/insights.md:47`).
- `mutate()` does not call its `mutationFn` synchronously; assert after an
  `await findBy*`/`waitFor` (`client/insights.md:62`).
- `Modal` applies zero padding and provides no focus trap; the case form in this
  plan is therefore an **inline expandable panel**, not a modal (see *Placement
  decisions*), so no second focus-trap obligation is created.
- A `wait --url` assertion is not a rendering assertion (`client/insights.md:63`)
  — every e2e flow ends on copy that only the new surface renders.
- The agent editor's `TABS` already carries `{ key: "evals" }`
  (`client/src/app/agents/[id]/_components/AgentEditor/constants.ts:15`) and the
  route's `?tab=` whitelist derives from it; the `eval` nav item already exists.
  **No registry edit is needed for either** — the entry points this feature
  needed were added by the SPEC-03 plan.

## Entry points & duplicate registries

Every other place enumerating the same keys, with the task that covers it.
Greps that came back empty are recorded too.

| Registry | Where | Covered by |
|---|---|---|
| Vendored contract copies | `server/src/vendor/shared/contracts/eval-ci.ts` **and** `client/src/vendor/shared/contracts/eval-ci.ts` | **D1 + D2**, proved by **D24** |
| Row-shape duplication | `EvalCaseRow`/`EvalExpectationRow` as `$inferSelect` in `server/src/db/rows.ts:20-24` **and** as hand-written interfaces in `server/src/modules/eval/repository.ts:25-43` — two enumerations of one column list. **Collapsed**: the repository imports the `db/rows.js` types and the local interfaces are deleted, so a future column cannot be added to the table and forgotten in the mapper | **D5** (structural fix) |
| The frozen invocation shape (AC-17/AC-18) | `reviewPullRequest({ systemPrompt, model, llm, diff, strategy, maxRetries, …skills })` at `server/src/modules/eval/runner.ts:130-138`. A verification must use the *same* shape (SPEC-04 § Untrusted inputs: "a cheaper invocation, never a laxer one"). **Collapsed**: one private `invokeCase()` is the single call site, used by both `execute()` and `verifyCase()` | **D8** (structural fix) |
| The match rule | `matchesExpectation` (`server/src/modules/eval/scoring.ts:26-30`). AC-53's returned-finding count needs the same rule; re-deriving it in the client would be a second implementation that can drift. **Collapsed**: the count is computed server-side by a new `countMatchedFindings` in the same file and stored in the case's latest result; the client renders it | **D6, D7** (structural fix) |
| Metric/cost formatters | `formatMetricPercent`/`formatStartedAt` live in `client/src/components/eval-runs/RunHistoryTable/helpers.ts` and are already imported *across* the component boundary by `EvalDashboardView.tsx:15`. A third consumer arrives with AC-57. **Collapsed**: promoted to `client/src/components/eval-runs/helpers.ts`, both existing importers repointed | **D16** (structural fix) |
| Agent editor tabs | `AgentEditor/constants.ts:11-16` already contains `{ key: "evals" }`; `agents/[id]/page.tsx` derives `VALID_TABS` from `TABS`. **Checked — no edit needed** | n/a |
| Sidebar / g-nav / command palette / shortcuts help | all read `NAV`, which already carries the `eval` item; `SHORTCUTS`' Navigation group was collapsed to derive from `NAV` by the SPEC-03 plan. **Checked — no edit needed**; `nav_shortcut_help_derives_from_nav` stays as the regression guard | n/a |
| Command-palette nav copy | `messages/en/shell.json`'s `nav.eval` key already exists (`client/insights.md:26`). **Checked — no edit needed** | n/a |
| Fastify module registry | `server/src/modules/index.ts` already registers `eval`; this plan adds routes to the existing plugin only. **Checked — no edit needed** | n/a |
| Drizzle schema barrel | `server/src/db/schema.ts` — this plan adds **no new table**, only columns. **Checked — no barrel edit** | n/a |
| Client hooks barrel | `client/src/lib/hooks/index.ts:16` already exports `./eval`; new hooks go in the same file. **Checked — no edit** | n/a |
| i18n namespaces / e2e flows | both discovered by `readdirSync`. **Checked, no registry** | n/a |
| New contract names | `grep -rn "EvalCaseLatestResult\|EvalAgentSummary\|latest_result\|EvalVerification\|verifyCase\|latestResult"` across the repo → **no matches**. No barrel collision (the `AgentStats` class of failure, `server/insights.md:31`). Checked | n/a |
| Consumers of the removed keys | `grep -rn "default_expectation_kind\|expectation_kind\|EvalCaseUpdate\|findOverlap"` → the two vendor copies, `modules/eval/{service,helpers,routes}.ts`, `hooks/eval.ts`, `EvalCaseModal.tsx`, `db/seed.ts`, and the five test files. Every one is in a task's file list below. Checked | D1–D3, D5, D9, D18, D24–D28 |

## Placement decisions

Each traces to a preloaded skill's rule, not to preference.

1. **A case's most recent result is a jsonb column on `eval_cases`
   (`latest_result`), not a row in `eval_runs`.** `postgresql-table-design`:
   "Keep core relations in tables; use JSONB for optional/variable attributes" —
   the latest result is an optional, variable-shape attribute of a case (its
   returned-findings array is already jsonb elsewhere, `eval_runs.actual_output`),
   and SPEC-04 calls it "a pointer that moves". The decisive reason is AC-50: if a
   verification wrote an `eval_runs` row, every history and comparison read would
   need to filter it out forever, and one missed filter puts an ad-hoc retry
   inside a measurement. With a separate column, **nothing on the verification
   path touches `eval_suite_runs` or `eval_runs` at all**, which is provable by a
   unit test against a stub repository and by a grep.
2. **The verification is a method on `EvalRunner`, not a new module or a job.**
   `onion-architecture` § "Jobs … a job is another way to enter a use case" and
   § Module anatomy — the use case is "invoke the agent over one case and score
   it", which is the run loop's body. `execute()` and `verifyCase()` both call one
   private `invokeCase()`, so AC-17's frozen key list exists exactly once.
3. **`countMatchedFindings` goes in `scoring.ts`.** `onion-architecture` §
   "Ring 2 has no technology imports" — it is a pure function over plain data,
   which is what keeps AC-53 a hermetic unit test and stops the match rule from
   being re-implemented in a React component.
4. **The per-agent dashboard summary is a new read (`GET /eval-agents`), not a
   client-side derivation from the run list.** AC-63 is "for each agent"; the run
   list is limited (`?limit=20`), so deriving from it would silently omit an agent
   whose last run fell off the page. The query lives in `EvalRepository` —
   `onion-architecture` quick-decision table, "a SQL query, in any form → ring 3".
   Path chosen as `/eval-agents` rather than `/eval-runs/summary` so it can never
   be read as an id by the `/eval-runs/:id` route (`server/insights.md:30`).
5. **The eval case form is an inline expandable panel inside `EvalsTab`, not a
   modal.** `frontend-ui-architecture` placement ladder rung 2 (single consumer)
   plus a concrete cost: the vendored `Modal` still has no focus trap or focus
   restore, so a second modal surface would create a second NFR obligation that
   SPEC-04 only imposes on the comparison. The panel replaces today's inline
   name-only edit form (`EvalsTab.tsx:46-67`).
6. **`RunHistoryTable` becomes presentational for the run source.** It takes
   `runs: EvalSuiteRun[]` plus `agentId: string | null` instead of fetching by
   agent id (`RunHistoryTable.tsx:36`), so one component can render the
   unfiltered cross-agent list (AC-62) and the filtered one (AC-64).
   `frontend-ui-architecture` § "Server state … lives in a query cache" — the
   fetch moves up to the two owners (`EvalDashboardView`, and nothing else, since
   AC-59 removes it from the tab).
7. **Selection and the compare control render only while an agent is selected.**
   SPEC-04's edge case "Two runs of different agents selected … not offered"
   plus AC-30. Enforced by construction rather than by a validation message: with
   no agent selected the rows carry no checkbox at all.
8. **`EvalCaseRecord.expectations` stays an array of one.** SPEC-04 is emphatic
   that a case carries exactly one expectation, but the array is already the
   shape `ScoredCase`, the repository mapper, the seed and every fixture speak,
   and the only writer (`repository.insertCase`, `repository.ts:238-247`) writes
   exactly one row. Narrowing the contract to a singular field is churn with no
   behavioural difference once the *editing* path is deleted. A client helper
   `caseExpectation(c)` reads `c.expectations[0] ?? null` in one place. Recorded
   as a Recommendation for a later, deliberate change.
9. **AC-42's availability is decided on the client from the finding it already
   has.** `FindingCard` already reads `accepted_at`/`dismissed_at`
   (`FindingCard.tsx:55-56`); no draft fetch, no round trip, and the control can
   be disabled before anything is requested. The server still refuses the create
   for an undecided finding — see the Open questions note.

## Affected modules & files

- **shared contracts (Step 0, both copies)**
  - `server/src/vendor/shared/contracts/eval-ci.ts`
  - `client/src/vendor/shared/contracts/eval-ci.ts`
- **server (Track A)**
  - `src/db/schema/eval.ts` — three nullable columns on `eval_cases`
  - `src/db/migrations/0018_*.sql` (+ `meta/`) — generated, never hand-edited
  - `src/modules/eval/helpers.ts` — delete `findOverlap`, rename the derivation
  - `src/modules/eval/scoring.ts` — add `countMatchedFindings`
  - `src/modules/eval/repository.ts` — severity/category/latest result, run-list
    filter, per-agent summary, drop the expectation-replacement branch
  - `src/modules/eval/service.ts` — derive the kind, drop the overlap check,
    name-only update, verification entry point
  - `src/modules/eval/runner.ts` — `invokeCase()`, `verifyCase()`, latest-result
    write per case
  - `src/modules/eval/routes.ts` — verify route, `/eval-agents`
  - `src/db/seed.ts`
- **client (Track B)**
  - `src/lib/hooks/eval.ts`
  - `src/app/repos/[repoId]/pulls/[number]/_components/EvalCaseModal/*`
  - `src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx`
  - `src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx`
  - `src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/*`
  - `src/components/eval-runs/helpers.ts` (new), `.../RunHistoryTable/*`
  - `src/app/eval/_components/EvalDashboardView/*`
  - `messages/en/eval.json`, `messages/en/prReview.json`
- **tests (Track C)**
  - `server/test/eval-{contracts,helpers,scoring,runner,cases,runs,routes}*.ts`
  - `client/src/**/*.test.tsx` for every component above
  - `e2e/specs/13-agent-evals-tab.flow.json`,
    `e2e/specs/14-eval-dashboard.flow.json`,
    `e2e/specs/15-eval-run-compare.flow.json`

## Shared contract (frozen before the tracks fork)

### A. Contract edits — inside the existing `// ==== SPEC-03 eval pipeline ====` block

Keep the banner text as it is (the vendor-identity test slices from it). Edit in
place; append the three new schemas at the end of the block.

```ts
/** POST /agents/:id/eval-cases — the expectation type is NOT on the wire.
 *  It is derived server-side from the finding's decision (AC-40, AC-41). */
export const EvalCaseCreate = z.object({
  finding_id: z.string().uuid(),
  name: z.string().min(1),
});

/** PUT /eval-cases/:id — the name is a case's ONLY mutable field. The
 *  fragment, file, range, severity, category and expectation are captured at
 *  creation and never change (AC-45; SPEC-04 § Contracts, Eval case). */
export const EvalCaseUpdate = z.object({
  name: z.string().min(1),
});

/** A case's most recent outcome, from a suite run OR a verification. Persisted
 *  as jsonb on `eval_cases.latest_result`, so the read path safeParses it and
 *  falls back to null; a field added here later must be `.nullish()`. */
export const EvalCaseLatestResult = z.object({
  completed: z.boolean(),
  /** null when the invocation did not complete. */
  passed: z.boolean().nullable(),
  error: z.string().nullish(),
  findings: z.array(EvalReturnedFinding),
  /** AC-53's returned finding count: findings in this result that matched this
   *  case's expectation, counted server-side with the same rule the metrics
   *  use — never recomputed in the client. */
  matched_count: z.number().int(),
  ran_at: z.string(),
});

/** GET /findings/:id/eval-case-draft — `expectation_kind` REPLACES
 *  `default_expectation_kind`: it is derived, never a default to override
 *  (AC-40). null only when the finding carries no decision, in which case the
 *  action is unavailable and this endpoint is not reached (AC-42). */
export const EvalCaseDraft = z.object({
  finding_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
  suggested_name: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  fragment: z.string(),
  expectation_kind: EvalExpectationKind.nullable(),
  existing_case: EvalCaseRecord.nullable(),
});

/** EvalCaseRecord gains three REQUIRED-but-nullable keys. Every hand-built
 *  EvalCaseRecord fixture must supply all three (client/insights.md 2026-08-17).
 *  severity/category are null for a case created before they were captured —
 *  the row states them as unavailable, never as a default severity. */
export const EvalCaseRecord = z.object({
  // … unchanged keys …
  severity: z.string().nullable(),
  category: z.string().nullable(),
  latest_result: EvalCaseLatestResult.nullable(),
});

/** GET /eval-agents — AC-63. `latest_run` is the agent's most recent run of
 *  ANY status, or null when it has never been run (AC-4). */
export const EvalAgentSummary = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  latest_run: EvalSuiteRun.nullable(),
});
```

`EvalExpectation`, `EvalExpectationKind`, `EvalReturnedFinding`,
`EvalInvokedSkill`, `EvalCaseResult`, `EvalSuiteRun`, `EvalSuiteRunDetail`,
`EvalRunStatus` are **not edited**.

### B. HTTP surface (frozen — delta only)

| Method + path | Body | Response | Change |
|---|---|---|---|
| `GET /findings/:id/eval-case-draft` | — | `EvalCaseDraft` | field rename only |
| `POST /agents/:id/eval-cases` | `EvalCaseCreate` | `EvalCaseRecord` 201 / 200 | no type on the wire; **422** when the finding carries no decision |
| `PUT /eval-cases/:id` | `EvalCaseUpdate` | `EvalCaseRecord` | name only; an `expectations` key is no longer accepted |
| `POST /eval-cases/:id/verify` | — | `EvalCaseRecord` 200 | **new** — synchronous, one model call, writes only `eval_cases.latest_result` |
| `GET /eval-runs?limit=` | — | `EvalSuiteRun[]` | **every status**, newest first |
| `GET /eval-agents` | — | `EvalAgentSummary[]` | **new** — one row per agent, ordered by agent name + id |

Unchanged: `GET /agents/:id/eval-cases`, `GET /agents/:id/eval-runs`,
`POST /agents/:id/eval-runs`, `GET /eval-runs/:id`, `DELETE /eval-cases/:id`.
Every path keeps `getContext(container, req)` + workspace scoping, including the
read-only ones, and declares its params/body through
`IdParams`/`fastify-type-provider-zod`.

### C. Database shape (frozen — all of it in migration `0018`)

```
eval_cases (EXTEND — every column NULLABLE; the table has live rows)
  + severity       text NULL          -- copied from the finding at creation (AC-44)
  + category       text NULL          -- copied from the finding at creation (AC-44)
  + latest_result  jsonb NULL         -- EvalCaseLatestResult; the pointer that moves
```

No other table changes. `eval_case_expectations`, `eval_suite_runs`,
`eval_run_skills` and `eval_runs` are untouched — in particular **a verification
writes to none of them**.

### D. Frozen function signatures (Track A ↔ Track C)

```ts
// server/src/modules/eval/helpers.ts
export function expectationKindFor(
  f: { acceptedAt: Date | null; dismissedAt: Date | null },
): EvalExpectationKind | null;          // renamed from defaultExpectationKind
// findOverlap is DELETED.

// server/src/modules/eval/scoring.ts
/** AC-53 — findings in this result that matched ANY expectation of this case,
 *  by the same rule `matchesExpectation` applies to the metrics. */
export function countMatchedFindings(c: ScoredCase): number;

// server/src/modules/eval/runner.ts
export class EvalRunner {
  /** AC-46 — one invocation, scored alone, recorded ONLY on the case. */
  verifyCase(workspaceId: string, caseId: string): Promise<EvalCaseRecord>;
}

// client/src/components/eval-runs/helpers.ts (promoted, pure)
export function formatMetricPercent(v: number | null): DisplayValue;
export function formatPassCount(passed: number | null, total: number): DisplayValue;
export function formatRunCost(v: number | null): DisplayValue;
export function formatStartedAt(iso: string): string;
export function chronological(a: EvalSuiteRun, b: EvalSuiteRun): [EvalSuiteRun, EvalSuiteRun];

// client/.../EvalsTab/helpers.ts (pure)
export function caseExpectation(c: EvalCaseRecord): EvalExpectation | null;
/** AC-53 — 1 for a must_find case, 0 for a must_not_flag case. */
export function expectedFindingCount(c: EvalCaseRecord): number;
/** AC-58 — cases whose most recent result passed, out of the whole set. */
export function passedCaseCount(cases: EvalCaseRecord[]): number;
/** AC-57 — the newest run whose status is 'completed', or null. */
export function latestCompletedRun(runs: EvalSuiteRun[] | undefined): EvalSuiteRun | null;
```

## Tasks

### Step 0 — freeze the shared contract (before the tracks fork)

- [ ] D1 Apply Shared contract § A to the server's vendored copy, inside the existing `// ==== SPEC-03 eval pipeline ====` block (banner text unchanged — the vendor-identity test slices from it). `severity`/`category`/`latest_result` are `.nullable()` and never `.default(...)`: absent is a real state here, and a `.default()` on a persisted contract is a claim about a read path (`server/insights.md:48`) — `server/src/vendor/shared/contracts/eval-ci.ts` — owner: `implementer` — skill: `zod` — → AC-40, AC-44, AC-53, AC-54, AC-63 → `eval_contracts_create_payload_carries_no_expectation_type`, `eval_contracts_case_carries_nullable_severity_category_and_latest_result`
- [ ] D2 Re-sync the identical block into the client's vendored copy — **copy the bytes, do not retype**, and save with CRLF line endings; the previous re-sync failed the byte-identity test on line endings alone (`server/insights.md:61`) — `client/src/vendor/shared/contracts/eval-ci.ts` — owner: `implementer` — skill: `zod` — → AC-40, AC-44 → `eval_contracts_vendor_copies_are_identical`

---

### Track A — server

Files: `server/src/**` only (plus the generated migration). Disjoint from Tracks B and C.

- [ ] D3 Add `severity text NULL`, `category text NULL`, `latest_result jsonb NULL` to `eval_cases`. Nullable is not a convenience: the table has live rows, and SPEC-04's edge case requires a case created before this round to state severity and category as unavailable rather than showing a default. No new table, so **no `db/schema.ts` barrel edit and no `db/rows.ts` addition** — the existing `$inferSelect` types pick the columns up — `server/src/db/schema/eval.ts` — owner: `implementer` — skill: `postgresql-table-design`, `drizzle-orm-patterns` — → AC-44, AC-48 → `eval_case_captures_the_finding_severity_and_category`, `eval_verification_records_the_case_latest_result`
- [ ] D4 Generate and apply migration `0018`: `cd server && pnpm db:generate` then `pnpm db:migrate`. Never hand-edit the SQL. This diff only **adds** columns, so `drizzle-kit generate` should not prompt; if it does, split the schema edit per `server/insights.md:40` — `server/src/db/migrations/0018_*.sql`, `server/src/db/migrations/meta/*` — owner: `implementer` — skill: `drizzle-orm-patterns` — → AC-44 → `eval_case_captures_the_finding_severity_and_category`
- [ ] D5 **Removal + collapse in the repository.** (a) Delete the hand-written `EvalCaseRow`/`EvalExpectationRow` interfaces (`repository.ts:25-43`) and import the `$inferSelect` types from `db/rows.js` instead, so the column list is enumerated once. (b) Delete the expectation delete/re-insert branch from `updateCase` (`repository.ts:284-295`) — the name is now the only mutable field. (c) Map `severity`/`category`/`latest_result` in `toCaseRecord`, reading `latest_result` through `EvalCaseLatestResult.safeParse(...)` with a fallback to `null`, never a bare `as` (`repository.ts:486` is the existing instance of this rule). (d) Add `writeLatestResult(caseId, snapshot)`. (e) Rename `listCompletedSuiteRuns` → `listSuiteRuns` and **drop the `status = 'completed'` filter** (`repository.ts:460`) so AC-62's list carries running and failed runs too. (f) Add `latestRunPerAgent(workspaceId)` for AC-63, ordered by agent name then agent id — `server/src/modules/eval/repository.ts` — owner: `implementer` — skill: `drizzle-orm-patterns` — → AC-44, AC-48, AC-62, AC-63 → `eval_dashboard_endpoint_lists_every_run_newest_first`, `eval_agent_summaries_return_each_agents_latest_run`, `eval_verification_records_the_case_latest_result`
- [ ] D6 **Removal + addition in the pure helpers.** Delete `findOverlap` (`helpers.ts:107-121`) — its only production caller goes away in D9 and SPEC-04 retires the rule it enforced with nothing replacing it. Rename `defaultExpectationKind` → `expectationKindFor` (same body): the word "default" describes a pre-selection the user may override, which is exactly what AC-40 forbids, and the rename forces every call site to be revisited. Keep `normalizeRange`, `cutFragment`, `rangesOverlap` unchanged — `server/src/modules/eval/helpers.ts` — owner: `implementer` — skill: `typescript-expert` — → AC-41 → `eval_expectation_kind_is_derived_from_the_decision`
- [ ] D7 Add `countMatchedFindings(c: ScoredCase): number` to the pure scoring module — the count of findings in the case's result that match any expectation of that case, reusing `matchesExpectation` (`scoring.ts:26-30`) so AC-53's number and the metrics can never disagree. No new imports; the file still imports nothing from `drizzle-orm`, `db/schema`, `fastify` or any LLM type — `server/src/modules/eval/scoring.ts` — owner: `implementer` — skill: `typescript-expert` — → AC-53 → `eval_scoring_counts_findings_matching_the_case_expectation`
- [ ] D8 **`EvalRunner`: one invocation shape, two entry points.** (a) Extract the body of the per-case loop into a private `invokeCase(agent, evalCase, skillBodies)` returning `{ completed, findings, costUsd, error }` — the `reviewPullRequest({ … })` call at `runner.ts:130-138` moves there **verbatim**, keeping the frozen key list and its AC-17 header comment. (b) `execute()` calls it, and additionally writes the case's latest result (`writeLatestResult`) alongside its permanent per-run row, since SPEC-04 says a case's most recent result may come from either kind of invocation. (c) New `verifyCase(workspaceId, caseId)`: resolve the case workspace-scoped, resolve the agent workspace-scoped **first** and only then `agents.linkedSkills` (that method is not workspace-scoped on its own), keep only enabled links in link order, call `invokeCase` once, score with `casePassed` + `countMatchedFindings`, write `eval_cases.latest_result`, return the updated `EvalCaseRecord`. It must call **none** of `startSuiteRun`, `recordCaseResult`, `bumpCaseProgress`, `finalizeSuiteRun` — that absence is what makes AC-49/AC-50 structural. No run-in-progress check: AC-16 bars a second *run*, and SPEC-04's edge case explicitly permits verifying during one — `server/src/modules/eval/runner.ts` — owner: `implementer` — skill: `onion-architecture` — → AC-17, AC-18, AC-46, AC-48, AC-49, AC-50, AC-51 → `eval_verification_uses_the_same_frozen_invocation_as_a_run`, `eval_verification_invokes_the_agent_over_one_case`, `eval_verification_writes_no_suite_run_row`, `eval_verification_leaves_every_run_metric_and_result_unchanged`
- [ ] D9 **`EvalService`: derive, stop offering, stop editing.** (a) `getDraft` returns `expectation_kind` (renamed field) from `expectationKindFor(ctx.finding)`. (b) `createCase` no longer reads a kind from the body: it derives it from the finding's own decision and passes it to `insertCase`, and **throws a 422 `ValidationError` when the derivation is `null`** — a finding with no decision has no defensible type, which is AC-41's rule read in the only direction that keeps the endpoint total. (c) It copies `ctx.finding.severity` and `ctx.finding.category` into the row (AC-44). (d) `updateCase` drops the overlap check (`service.ts:133-141`) and forwards a name only. (e) New `verifyCase(workspaceId, id)` delegating to the runner — `server/src/modules/eval/service.ts` — owner: `implementer` — skill: `onion-architecture` — → AC-41, AC-43, AC-44, AC-45, AC-46 → `eval_case_kind_is_derived_from_the_finding_decision`, `eval_create_refuses_a_finding_with_no_decision`, `eval_create_stores_case_for_the_finding_agent`, `eval_case_captures_the_finding_severity_and_category`
- [ ] D10 Routes: add `POST /eval-cases/:id/verify` (params via `IdParams`, no body, 200 with the updated `EvalCaseRecord`) and `GET /eval-agents` (no params). Both call `getContext` and scope by workspace, like every existing path. Ring 4 only — parse, delegate, return; no Drizzle, no rules. `/eval-agents` is a distinct prefix on purpose so it can never be matched as an id by `/eval-runs/:id` (`server/insights.md:30`) — `server/src/modules/eval/routes.ts` — owner: `implementer` — skill: `fastify-best-practices` — → AC-46, AC-63 → `eval_verification_records_the_case_latest_result`, `eval_agent_summaries_return_each_agents_latest_run`
- [ ] D11 Seed, for the e2e surfaces and local demo: (a) give the two seeded eval cases the `severity`/`category` of the findings they came from; (b) give the `must_find` case a `latest_result` that **passed** (one grounded finding matching its expectation, `matched_count: 1`) and the `must_not_flag` case a `latest_result` that **failed** (one grounded finding inside its range, `matched_count: 1`), so AC-52/AC-53's copy has both directions on screen; (c) add a **third** case for the same agent with `severity`, `category` and `latest_result` all left NULL — the "created before this round / never run" state AC-54 and the severity edge case describe, and the shape every e2e and manual check needs to see stated as unavailable rather than defaulted. Keep every insert idempotent in the existing style — `server/src/db/seed.ts` — owner: `implementer` — skill: `drizzle-orm-patterns` — → AC-52, AC-54 → `e2e_agent_evals_tab_renders`

---

### Track B — client

Files: `client/src/**` (excluding `*.test.ts(x)`), `client/messages/**`. Disjoint from Tracks A and C.

- [ ] D12 `hooks/eval.ts`: add `useVerifyEvalCase` (`POST /eval-cases/:id/verify`, invalidating `["agent", agentId, "eval-cases"]` on success) and `useEvalAgentSummaries` (`GET /eval-agents`); give `useRecentEvalRuns` the same `refetchInterval` predicate `useAgentEvalRuns` already has (`hooks/eval.ts:97-105`), because the dashboard list now carries `running` runs; drop `expectation_kind` from `useCreateEvalCase`'s body type and narrow `useUpdateEvalCase`'s patch to `{ name }`. No barrel edit — `hooks/index.ts:16` already re-exports this file — `client/src/lib/hooks/eval.ts` — owner: `implementer` — skill: `react-best-practices` — → AC-46, AC-62, AC-63 → `evals_tab_verify_control_verifies_one_case`, `eval_dashboard_row_per_agent_states_its_latest_run`
- [ ] D13 **Removal + change in `EvalCaseModal`.** Delete the `role="radiogroup"` and its two radios (`EvalCaseModal.tsx:129-150`) and the `kind` state they drove; render the derived expectation as a **statement** built from `draft.expectation_kind` (AC-40) — a positive case reading as a requirement to find the problem at that file and range, a negative one as a requirement not to flag there. The confirm control is no longer gated on a type, only on the draft having loaded. Keep the `touchedRef` name-seeding shape and its value-based dependency list (`EvalCaseModal.tsx:35-40`) — it fixes a real reopen defect — but it now seeds the name only — `client/src/app/repos/[repoId]/pulls/[number]/_components/EvalCaseModal/{EvalCaseModal.tsx,helpers.ts,styles.ts}` — owner: `implementer` — skill: `react-best-practices` — → AC-40 → `eval_case_modal_states_the_derived_expectation`, `eval_case_modal_reopen_reflects_a_decision_that_changed_while_closed`
- [ ] D14 AC-42 on the finding card: when the finding carries neither `accepted_at` nor `dismissed_at` (both already read at `FindingCard.tsx:55-56`), render the eval-case control as **unavailable** — `disabled`, with an accessible name and adjacent copy stating that the finding must be accepted or dismissed first — and do not call `onCreateEvalCase`. No new prop and no new `FindingActionKind`; no fetch — `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx`, `.../FindingsPanel/FindingsPanel.tsx` — owner: `implementer` — skill: `react-best-practices` — → AC-42 → `finding_card_eval_action_unavailable_without_a_decision`
- [ ] D15 **Removal on the agent's evals surface.** Delete `<RunHistoryTable agentId={agent.id} />` (`EvalsTab.tsx:139`) and its import. The run history lives only on the dashboard from here on; nothing on this surface may render a run row, a run start time or a compare control — `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.tsx` — owner: `implementer` — skill: `react-best-practices` — → AC-59 → `evals_tab_presents_no_run_history`
- [ ] D16 Promote the pure formatters (`formatMetricPercent`, `formatPassCount`, `formatRunCost`, `formatStartedAt`, `chronological`, `DisplayValue`) from `RunHistoryTable/helpers.ts` to `client/src/components/eval-runs/helpers.ts` and repoint both existing importers (`RunHistoryTable.tsx`, `EvalDashboardView.tsx:15` — which already reaches across the component boundary today). A third consumer (the tab's metrics block, D17) is what makes this a real promotion rather than a speculative one — `client/src/components/eval-runs/helpers.ts`, `client/src/components/eval-runs/RunHistoryTable/{RunHistoryTable.tsx,helpers.ts}`, `client/src/app/eval/_components/EvalDashboardView/EvalDashboardView.tsx` — owner: `implementer` — skill: `frontend-ui-architecture` — → AC-57 → `evals_tab_shows_the_latest_completed_run_metrics`
- [ ] D17 **`EvalsTab` — the new surface.** (a) A metrics block for the agent's most recent **completed** run: recall, precision, citation accuracy and passed-out-of-total, each as text with an em dash plus a "not available" accessible label for an absent value (AC-57); when there is no completed run, state that no run has happened and render no metric value at all (AC-4). (b) A counter stating how many cases passed in their most recent result out of the total in the set (AC-58), from `passedCaseCount`. (c) Progress on the run control itself: while a run is in progress the control's own label reads "N of M cases run" (AC-60), and a visually-hidden sibling `<span role="status" aria-live="polite">` carries the same text so the announcement happens at most once per completed case without depending on the `Button` primitive forwarding ARIA props. Delete the separate progress block (`EvalsTab.tsx:120-124`). (d) No recall, precision or citation is rendered for the running run — the metrics block reads the latest *completed* run, which excludes it structurally (AC-61). Keep the empty-set statement and the disabled run control (AC-13) and the one-POST behaviour (AC-14) — `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/{EvalsTab.tsx,helpers.ts,styles.ts}` — owner: `implementer` — skill: `react-best-practices` — → AC-4, AC-56, AC-57, AC-58, AC-60, AC-61 → `evals_tab_shows_the_case_set`, `evals_tab_shows_the_latest_completed_run_metrics`, `evals_tab_states_no_run_has_happened`, `evals_tab_counts_cases_passed_in_their_latest_result`, `evals_tab_run_control_shows_progress`, `evals_tab_shows_no_metrics_for_a_running_run`
- [ ] D18 **`EvalsTab` case rows + case form.** Each row states, as **text** (never icon or colour alone): passed / failed / never run from `latest_result` (AC-52, AC-54), the expectation type from `caseExpectation(c)`, and the severity and category — or "unavailable" for each when the case carries none (AC-52 + SPEC-04's pre-capture edge case). A result line states the expected finding count (1 for `must_find`, 0 for `must_not_flag`) and the returned finding count from `latest_result.matched_count` (AC-53). Replace today's inline name-only edit form (`EvalsTab.tsx:46-67`) with an expandable case-form panel: the name as the only editable field, the expectation stated beside **the findings the agent returned for that case in its most recent result** — file, line range and grounding outcome, rendered as inert text, never markup (AC-55) — and a verification control. All three icon-only row controls (verify, open, delete) carry an accessible name identifying both the action and the case, and are ≥24×24 px — `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/{EvalsTab.tsx,helpers.ts,styles.ts}` — owner: `implementer` — skill: `react-best-practices` — → AC-52, AC-53, AC-54, AC-55 → `evals_tab_case_row_states_pass_kind_severity_and_category`, `evals_tab_case_row_states_expected_and_returned_counts`, `evals_tab_case_never_run_states_so`, `evals_tab_case_form_shows_expectation_beside_last_output`
- [ ] D19 The verification control on a case row calls `useVerifyEvalCase`; while it is in flight the control states so, and on completion the case form presents the findings the agent returned (AC-47) and the outcome is announced through a polite live region **without moving focus**. Verifying is permitted while a suite run is in progress — do not disable it on `runningRun(runs)` — `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.tsx` — owner: `implementer` — skill: `react-best-practices` — → AC-46, AC-47 → `evals_tab_verify_control_verifies_one_case`, `evals_tab_verification_presents_the_returned_findings`
- [ ] D20 `RunHistoryTable` becomes source-agnostic: props `{ runs: EvalSuiteRun[]; agentId: string | null; isLoading?: boolean }` instead of fetching by agent id (`RunHistoryTable.tsx:36`). When `agentId` is `null` the rows render **no selection checkbox and no compare control** — two runs of different agents are not comparable and must not be offered (AC-30 + SPEC-04's edge case). Everything else stays: one row per run with start time, agent version, the three metrics, pass count, incomplete count and **cost in the same row** (AC-35); an absent metric or cost is an em dash with a "not available" label, never `0` and never `?? 0` before display; the selection control's accessible name names the run by start time and agent version — `client/src/components/eval-runs/RunHistoryTable/{RunHistoryTable.tsx,index.ts,styles.ts}` — owner: `implementer` — skill: `react-best-practices` — → AC-30, AC-35 → `run_history_compare_needs_exactly_two`, `run_history_row_shows_cost_next_to_metrics`
- [ ] D21 **`EvalDashboardView` — one list plus a filter.** Delete the bespoke recent-runs table (`EvalDashboardView.tsx:32-78`) and the chip picker (`:83-95`). Render instead: (a) one row per agent from `useEvalAgentSummaries`, stating the agent's name and, from its most recent run, the start time, the configuration version, the passed-out-of-total count and the three metrics (AC-63), with an em dash plus "not available" where a value is absent; each row is a control whose selected state is exposed to assistive technology and is not conveyed by colour alone (AC-65); (b) **one** list of eval runs, newest first, from `useRecentEvalRuns` when no agent is selected and from `useAgentEvalRuns(selectedAgentId)` when one is (AC-62, AC-64), rendered by `RunHistoryTable`; (c) when the selected agent has no runs, state that this agent has no runs rather than falling back to the unfiltered list (AC-4); (d) when the workspace has no runs at all, state that no run has happened yet rather than rendering an empty table. Selecting the same agent again clears the filter — `client/src/app/eval/_components/EvalDashboardView/{EvalDashboardView.tsx,helpers.ts,styles.ts}` — owner: `implementer` — skill: `next-best-practices` — → AC-4, AC-62, AC-63, AC-64, AC-65, AC-66 → `eval_dashboard_lists_one_run_list_newest_first`, `eval_dashboard_row_per_agent_states_its_latest_run`, `eval_dashboard_filters_the_run_list_to_the_selected_agent`, `eval_dashboard_marks_the_selected_agent_row_as_selected`, `eval_dashboard_selected_agent_with_no_runs_states_so`
- [ ] D22 Copy: extend `messages/en/eval.json` with the keys the new surfaces need — the derived-expectation statement (both directions), the case-row pass/fail/never-run and severity/category-unavailable states, the expected/returned result line, the verification control and its outcome, the tab's latest-completed-run block and its no-run statement, the passed-cases counter, the dashboard's per-agent row headers and its "this agent has no runs" statement. **Reuse the keys that already fit** rather than adding near-duplicates — `evalsTab.neverRun`, `evalsTab.passed`, `evalsTab.failed`, `evalsTab.progress`, `runHistory.notAvailable`, `dashboard.noRuns`, `dashboard.table.*` all exist (`client/messages/en/eval.json:69-103`). Add the AC-42 unavailability copy to `messages/en/prReview.json` under `finding.*`. Leave the non-goal keys in place and unrendered — `client/messages/en/eval.json`, `client/messages/en/prReview.json` — owner: `implementer` — skill: `next-best-practices` — → AC-42, AC-54 → `finding_card_eval_action_unavailable_without_a_decision`, `evals_tab_case_never_run_states_so`

---

### Track C — tests

Files: `server/test/**`, `client/src/**/*.test.ts(x)`, `e2e/specs/**`. Disjoint from Tracks A and B by file.

**Retirements come first: a test bound to a retired criterion is deleted or rewritten here, by name.**

- [ ] D23 **Delete the tests bound to retired SPEC-03 AC-11**, which asserted a rejection the product can no longer provoke: `eval_overlapping_expectations_are_rejected` (`server/test/eval-cases.it.test.ts:349`) and `eval_find_overlap_reports_the_two_ranges` (`server/test/eval-helpers.test.ts:139`), together with the `findOverlap` import and the `expectation` fixture helper if nothing else uses it. Do not rewrite them into something else — SPEC-04's retirement map says nothing replaces AC-11. In the same pass, delete `eval_contracts_reject_missing_expectation_kind` (`server/test/eval-contracts.test.ts:47`) and `eval_case_modal_requires_a_confirmed_expectation_type` (`.../EvalCaseModal.test.tsx:106`), both bound to retired AC-7 — `server/test/eval-cases.it.test.ts`, `server/test/eval-helpers.test.ts`, `server/test/eval-contracts.test.ts`, `client/src/app/repos/[repoId]/pulls/[number]/_components/EvalCaseModal/EvalCaseModal.test.tsx` — owner: `test-writer` — skill: `typescript-expert` — → (retired SPEC-03 AC-7, AC-11 — see the Retirement traceability table) → deletion is verified by `pnpm test:unit` and `pnpm test:integration` staying green with those names absent
- [ ] D24 Contract tests: `EvalCaseCreate` has **no** `expectation_kind` key and a payload carrying one is not honoured; `EvalCaseUpdate` accepts a name and nothing else; `EvalCaseRecord` requires `severity`, `category` and `latest_result` and accepts `null` for all three; `EvalCaseLatestResult` parses a document whose optional `error` is absent; `EvalAgentSummary.latest_run` accepts `null`; the two vendor copies are still byte-identical from the banner onward (keep this test as it is — it is the only thing that catches a retyped re-sync) — `server/test/eval-contracts.test.ts` — owner: `test-writer` — skill: `zod` — → AC-40, AC-44, AC-54, AC-63 → `eval_contracts_create_payload_carries_no_expectation_type`, `eval_contracts_update_payload_accepts_only_a_name`, `eval_contracts_case_carries_nullable_severity_category_and_latest_result`, `eval_contracts_vendor_copies_are_identical`
- [ ] D25 Helper + scoring unit tests: rename `eval_default_expectation_kind_from_decision` → `eval_expectation_kind_is_derived_from_the_decision` (accepted → `must_find`, dismissed → `must_not_flag`, undecided → `null`); add `eval_scoring_counts_findings_matching_the_case_expectation` covering a `must_find` case hit once, hit twice, and not at all; a `must_not_flag` case with a finding inside its range (count 1) and with one outside every labelled range (count 0, the load-bearing rule); and an ungrounded finding inside the range (count 0, since `matchesExpectation` rejects it). Keep every other test in both files — `server/test/eval-helpers.test.ts`, `server/test/eval-scoring.test.ts` — owner: `test-writer` — skill: `typescript-expert` — → AC-41, AC-53 → `eval_expectation_kind_is_derived_from_the_decision`, `eval_scoring_counts_findings_matching_the_case_expectation`
- [ ] D26 Runner unit tests against a counting `LLMProvider` and stub repositories, hermetic: `verifyCase` invokes the agent exactly once over the case's own fragment (AC-46); the `ReviewInput` it builds is **key-for-key identical** to the one a suite run builds for the same case and agent — assert on the captured object, not on a comment (AC-17, AC-18); `verifyCase` calls **none** of the stub repository's `startSuiteRun`/`recordCaseResult`/`bumpCaseProgress`/`finalizeSuiteRun` and calls `writeLatestResult` exactly once (AC-49, AC-50, AC-51); a run also writes each case's latest result as it goes. Keep `eval_progress_counts_completed_of_total`, rebinding it to AC-60 — `server/test/eval-runner.test.ts` — owner: `test-writer` — skill: `typescript-expert` — → AC-17, AC-18, AC-46, AC-49, AC-50, AC-51, AC-60 → `eval_verification_uses_the_same_frozen_invocation_as_a_run`, `eval_verification_invokes_the_agent_over_one_case`, `eval_verification_writes_no_suite_run_row`, `eval_progress_counts_completed_of_total`
- [ ] D27 Case-lifecycle integration tests (real Postgres via `startPg`/`dockerAvailable`, `secrets: new MockSecretsProvider()` in the overrides — an unmocked adapter otherwise reaches the real network and spends money): creating from an accepted finding stores `must_find` and from a dismissed one `must_not_flag`, with **no type on the request body** (AC-41, AC-43); creating from an undecided finding is refused with a 422 that states a decision is required (AC-41); the stored case carries the finding's severity and category (AC-44) and keeps its fragment, file, range, type, **severity and category** after the finding is re-decided, edited and deleted (AC-45); `PUT` with a name changes only the name; **one test builds its fixture in the OLD shape** — insert an `eval_cases` row **raw**, with `severity`, `category` and `latest_result` all NULL, exactly as a row created before this round looks on disk, and assert `GET /agents/:id/eval-cases` returns it with all three as `null` rather than throwing or defaulting (AC-52, AC-54). Keep `eval_second_conversion_returns_the_existing_case`, `eval_draft_carries_file_range_and_fragment` and `eval_edit_and_delete_leave_recorded_runs_unchanged`, dropping the latter's expectation-editing half — `server/test/eval-cases.it.test.ts` — owner: `test-writer` — skill: `drizzle-orm-patterns` — → AC-5, AC-10, AC-12, AC-41, AC-43, AC-44, AC-45, AC-52, AC-54 → `eval_case_kind_is_derived_from_the_finding_decision`, `eval_create_refuses_a_finding_with_no_decision`, `eval_create_stores_case_for_the_finding_agent`, `eval_case_captures_the_finding_severity_and_category`, `eval_case_is_immutable_when_its_finding_changes`, `eval_case_row_created_before_severity_capture_reads_as_unavailable`
- [ ] D28 Run + verification integration tests, same fixture shape and the same `MockSecretsProvider` rule: a completed run writes each covered case's `latest_result` (AC-48 data path); **verifying a case after a completed run leaves that run's recall, precision, citation accuracy, passed count and every per-case `eval_runs` row byte-identical** — snapshot the rows before and after and compare (AC-50) — while the case's own `latest_result` moves (AC-48); no new `eval_suite_runs` row exists afterwards and `GET /agents/:id/eval-runs` returns the same list it did before (AC-49, AC-51); a verification started while a suite run is `running` is accepted, not refused (SPEC-04 edge case). Keep every existing test in this file — `server/test/eval-runs.it.test.ts` — owner: `test-writer` — skill: `drizzle-orm-patterns` — → AC-48, AC-49, AC-50, AC-51 → `eval_verification_records_the_case_latest_result`, `eval_verification_leaves_every_run_metric_and_result_unchanged`, `eval_verification_writes_no_suite_run_row`
- [ ] D29 Route integration tests: `GET /eval-runs` returns runs of **every** status — a `running` one and a `failed` one both appear, newest first (AC-62), which is the assertion the old completed-only filter would fail; `GET /eval-agents` returns one row per agent carrying its most recent run, and `null` for an agent that has never been run (AC-63, AC-4); `POST /eval-cases/:id/verify` 404s for another workspace's case, and the two new paths are covered by the existing cross-workspace scoping sweep. Rename `eval_dashboard_lists_completed_runs_newest_first` → `eval_dashboard_endpoint_lists_every_run_newest_first` and `eval_agent_surface_returns_cases_and_run_history` → `eval_agent_endpoints_return_cases_and_runs`, both bound to retired SPEC-03 criteria; keep `eval_agent_with_no_completed_run_has_no_metrics` — `server/test/eval-routes.it.test.ts` — owner: `test-writer` — skill: `fastify-best-practices` — → AC-4, AC-62, AC-63, AC-64 → `eval_dashboard_endpoint_lists_every_run_newest_first`, `eval_agent_summaries_return_each_agents_latest_run`, `eval_agent_endpoints_return_cases_and_runs`, `eval_agent_with_no_completed_run_has_no_metrics`
- [ ] D30 `EvalCaseModal` tests (fetch mocked, `fireEvent`, assertions only after an `await findBy*`): the modal states the derived expectation for an accepted finding and for a dismissed one, and **renders no `radiogroup` and no control that changes the type** — `queryByRole("radiogroup")` is null and neither expectation label is a `radio` (AC-40); rewrite `eval_case_modal_reopen_reflects_a_decision_that_changed_while_closed` to assert the *statement* changes on reopen after the decision flipped, keeping the regression it guards; keep the existing-case and cannot-cut-a-fragment cases — `client/src/app/repos/[repoId]/pulls/[number]/_components/EvalCaseModal/EvalCaseModal.test.tsx` — owner: `test-writer` — skill: `react-testing-library` — → AC-40 → `eval_case_modal_states_the_derived_expectation`, `eval_case_modal_reopen_reflects_a_decision_that_changed_while_closed`
- [ ] D31 `FindingCard` tests: a finding with no decision renders the eval-case control as unavailable, with copy stating it must be accepted or dismissed first, and clicking it does not call `onCreateEvalCase` (AC-42); an accepted finding and a dismissed one both render it available and invoke the callback. Extend the existing file — `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.test.tsx` — owner: `test-writer` — skill: `react-testing-library` — → AC-5, AC-42 → `finding_card_offers_the_eval_case_action`, `finding_card_eval_action_unavailable_without_a_decision`
- [ ] D32 `EvalsTab` tests — the surface's removals and additions. **AC-59 is asserted positively**: with the runs query returning two completed runs, the tab renders no compare control, no run start time and no run version — `queryByText` on each is null — while the case set still renders (AC-56). The metrics block shows the latest **completed** run's three metrics and its passed-out-of-total (AC-57); with a `running` run and one older completed run, it shows the completed one's numbers and renders no metric attributable to the running run (AC-61); with no completed run it states that no run has happened and renders no metric value (AC-4). The run control's own label carries "N of M" while a run is in progress (AC-60). The passed-cases counter reads the cases' most recent results (AC-58). Every hand-built `EvalCaseRecord` fixture must supply `severity`, `category` and `latest_result` — they are required keys, and omitting one is a typecheck error *and* a render-time throw (`client/insights.md:28`). Keep `evals_tab_empty_set_blocks_the_run_control` and `evals_tab_run_control_starts_one_run` — `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.test.tsx` — owner: `test-writer` — skill: `react-testing-library` — → AC-4, AC-13, AC-14, AC-56, AC-57, AC-58, AC-59, AC-60, AC-61 → `evals_tab_shows_the_case_set`, `evals_tab_presents_no_run_history`, `evals_tab_shows_the_latest_completed_run_metrics`, `evals_tab_states_no_run_has_happened`, `evals_tab_counts_cases_passed_in_their_latest_result`, `evals_tab_run_control_shows_progress`, `evals_tab_shows_no_metrics_for_a_running_run`, `evals_tab_empty_set_blocks_the_run_control`, `evals_tab_run_control_starts_one_run`
- [ ] D33 `EvalsTab` per-case tests: a row states passed / failed as text (not by icon or colour alone) plus its expectation type, severity and category (AC-52); a case whose `severity`/`category` are `null` states them as unavailable and shows no default severity; a case with no `latest_result` states it has never been run and renders neither passed nor failed (AC-54); the result line reads "expected 1 … got 1" for a hit `must_find` case, "expected 0 … got 0" for a silent `must_not_flag` case and "expected 0 … got 1" for a flagged one (AC-53); opening a case shows its expectation beside the findings returned in its most recent result, each with file and line range, rendered as text (AC-55); the verification control fires exactly one POST and, once it resolves, the returned findings render (AC-46, AC-47) — `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.test.tsx` — owner: `test-writer` — skill: `react-testing-library` — → AC-46, AC-47, AC-52, AC-53, AC-54, AC-55 → `evals_tab_case_row_states_pass_kind_severity_and_category`, `evals_tab_case_row_states_expected_and_returned_counts`, `evals_tab_case_never_run_states_so`, `evals_tab_case_form_shows_expectation_beside_last_output`, `evals_tab_verify_control_verifies_one_case`, `evals_tab_verification_presents_the_returned_findings`
- [ ] D34 `RunHistoryTable` tests: update every render to the new `{ runs, agentId }` props; with `agentId: null` no row renders a selection checkbox and no compare control renders (AC-30 + the different-agents edge case); with an agent selected, the existing invariant holds — 0 or 1 selected disables Compare, exactly 2 enables it, and the third row's checkbox is itself disabled (the shape this component structurally enforces, `client/insights.md:24`). Keep `run_history_row_shows_cost_next_to_metrics`, `run_history_absent_cost_is_not_zero` and `run_history_states_failed_to_complete_count`; move `run_history_states_no_run_and_renders_no_metrics`'s AC-4 assertion to the dashboard test if the empty state moves with the fetch — `client/src/components/eval-runs/RunHistoryTable/RunHistoryTable.test.tsx` — owner: `test-writer` — skill: `react-testing-library` — → AC-22, AC-30, AC-35, AC-37 → `run_history_compare_needs_exactly_two`, `run_history_row_shows_cost_next_to_metrics`, `run_history_absent_cost_is_not_zero`, `run_history_states_failed_to_complete_count`
- [ ] D35 `EvalDashboardView` tests: **one** run list renders across agents, newest first, and no second run list exists — assert the count of rendered run rows equals the number of runs returned, so a re-introduced second list fails (AC-62); each agent row states that agent's name and its latest run's start time, version, passed-out-of-total and three metrics (AC-63); selecting an agent narrows the run list to that agent's runs (AC-64) and marks that agent's row as selected in a way assistive technology can read — assert on `aria-pressed`/`aria-current`, not on a style (AC-65); a selected agent with no runs states so rather than falling back to the unfiltered list (AC-4); an empty workspace states that no run has happened yet — `client/src/app/eval/_components/EvalDashboardView/EvalDashboardView.test.tsx` — owner: `test-writer` — skill: `react-testing-library` — → AC-4, AC-62, AC-63, AC-64, AC-65 → `eval_dashboard_lists_one_run_list_newest_first`, `eval_dashboard_row_per_agent_states_its_latest_run`, `eval_dashboard_filters_the_run_list_to_the_selected_agent`, `eval_dashboard_marks_the_selected_agent_row_as_selected`, `eval_dashboard_selected_agent_with_no_runs_states_so`
- [ ] D36 `RunCompareDialog` tests: no behavioural change, but rebind `compare_dialog_shows_both_values_and_the_delta` from retired SPEC-03 AC-31 to AC-66 in the file's own AC comments, and update any fixture that now needs the new `EvalCaseRecord` keys. Keep the case-set, prompt-diff, skills-diff, cost-delta and focus-trap tests as they are — `client/src/components/eval-runs/RunCompareDialog/RunCompareDialog.test.tsx` — owner: `test-writer` — skill: `react-testing-library` — → AC-32, AC-33, AC-36, AC-39, AC-66 → `compare_dialog_shows_both_values_and_the_delta`, `compare_dialog_diffs_the_two_system_prompts`, `compare_dialog_states_differing_case_sets`, `compare_dialog_states_differing_invoked_skills`, `compare_dialog_shows_both_costs_and_the_delta`
- [ ] D37 e2e flow 13 (agent evals tab): keep the tab-reaching steps, and replace the final assertions with copy only the **new** surface renders — a seeded case's own name plus its per-case result line ("expected … got …") and the never-run statement of the third seeded case. A `wait --url tab=evals` alone still passes on a broken build (`client/insights.md:63`), and the old case-set heading assertion no longer distinguishes the SPEC-04 surface from the SPEC-03 one — `e2e/specs/13-agent-evals-tab.flow.json` — owner: `test-writer` — skill: `frontend-ui-architecture` — → AC-56 → `e2e_agent_evals_tab_renders`
- [ ] D38 e2e flow 14 (dashboard): rewrite for one list plus a filter. **The current final step asserts `$0.007` on the premise that "the Recent runs list carries no cost column" — that premise dies with the two-list layout and the step must go, not be re-pointed.** New shape: open `/eval` from the sidebar, assert the dashboard's own copy and a seeded agent row with its latest run's version, then select that agent and assert the run list is now that agent's (a run start time only that agent has), and that the agent row is marked selected — `e2e/specs/14-eval-dashboard.flow.json` — owner: `test-writer` — skill: `frontend-ui-architecture` — → AC-62, AC-64 → `e2e_eval_dashboard_filters_by_agent`
- [ ] D39 e2e flow 15 (comparison): AC-66 opens the comparison from **the dashboard**, not from the agent editor — rewrite the flow to select the agent on `/eval`, check the two seeded runs' selection controls there, open the comparison and assert on the same copy it asserts today (the two compared versions, a metric value and a delta, and the differing-invoked-skills statement) — `e2e/specs/15-eval-run-compare.flow.json` — owner: `test-writer` — skill: `frontend-ui-architecture` — → AC-66 → `e2e_eval_run_compare_shows_deltas`

---

### Integration

- [ ] D40 Integration pass — files: none (verification only, no source edits). Run the Full verification block end to end. Confirm the tracks meet: the client contract copy is byte-identical to the server's (D24 green); the seeded data flows 13/14/15 depend on (D11) is present in the hermetic e2e database; `POST /agents/:id/eval-runs` → poll → `POST /eval-cases/:id/verify` → `GET /agents/:id/eval-cases` round-trips through the real routes with a mock provider, with the case's `latest_result` moving and the run's recorded rows unchanged; and the removals actually landed — run the two greps in the Full block. Report failures back rather than patching Track A/B files from here — owner: `implementer` — skill: `engineering-insights` — → AC-48, AC-50, AC-62 → `eval_verification_leaves_every_run_metric_and_result_unchanged`, `eval_dashboard_endpoint_lists_every_run_newest_first`

## Traceability

Every acceptance criterion in SPEC-04. Rows marked "— (shipped)" are carried
criteria this plan does not change; their proof is the test already in the
suite, which stays green.

| AC | Tasks | Verified by |
|----|-------|-------------|
| AC-4 | D17, D21, D29, D32, D35 | `evals_tab_states_no_run_has_happened`, `eval_dashboard_selected_agent_with_no_runs_states_so`, `eval_agent_with_no_completed_run_has_no_metrics` |
| AC-5 | D27, D31 | `eval_draft_carries_file_range_and_fragment`, `finding_card_offers_the_eval_case_action` |
| AC-10 | D27 | `eval_second_conversion_returns_the_existing_case` |
| AC-12 | D5, D27 | `eval_edit_and_delete_leave_recorded_runs_unchanged` |
| AC-13 | D32 | `evals_tab_empty_set_blocks_the_run_control`, `eval_empty_case_set_refuses_to_run` |
| AC-14 | D32 | `evals_tab_run_control_starts_one_run`, `eval_run_covers_the_set_as_it_was_at_start` |
| AC-16 | — (shipped) | `eval_runs_one_running_per_agent`, `eval_orphaned_running_run_is_reaped_on_boot` |
| AC-17 | D8, D26 | `eval_verification_uses_the_same_frozen_invocation_as_a_run`, `eval_invocation_sees_only_the_case_fragment` |
| AC-18 | D8, D26 | `eval_verification_uses_the_same_frozen_invocation_as_a_run`, `eval_invocation_uses_the_agents_model_provider_and_skills` |
| AC-19 | — (shipped) | `eval_run_records_agent_version` |
| AC-20 | — (shipped) | `eval_failed_case_does_not_stop_the_run` |
| AC-21 | — (shipped) | `eval_scoring_excludes_incomplete_cases` |
| AC-22 | D34 | `eval_run_states_failed_to_complete_count`, `run_history_states_failed_to_complete_count` |
| AC-23 | — (shipped) | `eval_scoring_matches_on_file_and_overlap` |
| AC-24 | — (shipped) | `eval_scoring_recall_over_must_find` |
| AC-25 | — (shipped) | `eval_scoring_precision_ignores_unlabelled` |
| AC-26 | — (shipped) | `eval_scoring_citation_accuracy_over_all_returned` |
| AC-27 | — (shipped) | `eval_scoring_absent_metric_is_null_not_zero`, `eval_contracts_keep_absent_metrics_nullable` |
| AC-28 | — (shipped) | `eval_scoring_case_pass_rule` |
| AC-29 | — (shipped) | `eval_scoring_performs_zero_model_calls` |
| AC-30 | D20, D34 | `run_history_compare_needs_exactly_two` |
| AC-32 | D36 | `compare_dialog_diffs_the_two_system_prompts` |
| AC-33 | D36 | `compare_dialog_states_differing_case_sets` |
| AC-34 | — (shipped) | `eval_run_records_total_model_call_cost` |
| AC-35 | D20, D34 | `run_history_row_shows_cost_next_to_metrics` |
| AC-36 | D36 | `compare_dialog_shows_both_costs_and_the_delta` |
| AC-37 | D34 | `run_history_absent_cost_is_not_zero`, `eval_contracts_keep_absent_metrics_nullable` |
| AC-38 | — (shipped) | `eval_run_records_invoked_skill_versions` |
| AC-39 | D36 | `compare_dialog_states_differing_invoked_skills` |
| AC-40 | D1, D2, D13, D24, D30 | `eval_contracts_create_payload_carries_no_expectation_type`, `eval_case_modal_states_the_derived_expectation`, `eval_case_modal_reopen_reflects_a_decision_that_changed_while_closed` |
| AC-41 | D6, D9, D25, D27 | `eval_expectation_kind_is_derived_from_the_decision`, `eval_case_kind_is_derived_from_the_finding_decision`, `eval_create_refuses_a_finding_with_no_decision` |
| AC-42 | D14, D22, D31 | `finding_card_eval_action_unavailable_without_a_decision` |
| AC-43 | D9, D27 | `eval_create_stores_case_for_the_finding_agent` |
| AC-44 | D1, D2, D3, D4, D5, D9, D24, D27 | `eval_case_captures_the_finding_severity_and_category`, `eval_contracts_case_carries_nullable_severity_category_and_latest_result` |
| AC-45 | D9, D27 | `eval_case_is_immutable_when_its_finding_changes` |
| AC-46 | D8, D9, D10, D12, D19, D26, D33 | `eval_verification_invokes_the_agent_over_one_case`, `evals_tab_verify_control_verifies_one_case` |
| AC-47 | D19, D33 | `evals_tab_verification_presents_the_returned_findings` |
| AC-48 | D3, D5, D8, D28 | `eval_verification_records_the_case_latest_result` |
| AC-49 | D8, D26, D28 | `eval_verification_writes_no_suite_run_row` |
| AC-50 | D8, D26, D28 | `eval_verification_leaves_every_run_metric_and_result_unchanged` |
| AC-51 | D8, D26, D28 | `eval_verification_writes_no_suite_run_row` |
| AC-52 | D11, D18, D27, D33 | `evals_tab_case_row_states_pass_kind_severity_and_category`, `eval_case_row_created_before_severity_capture_reads_as_unavailable` |
| AC-53 | D1, D7, D18, D25, D33 | `eval_scoring_counts_findings_matching_the_case_expectation`, `evals_tab_case_row_states_expected_and_returned_counts` |
| AC-54 | D1, D11, D18, D22, D24, D27, D33 | `evals_tab_case_never_run_states_so`, `eval_case_row_created_before_severity_capture_reads_as_unavailable` |
| AC-55 | D18, D33 | `evals_tab_case_form_shows_expectation_beside_last_output` |
| AC-56 | D17, D32, D37 | `evals_tab_shows_the_case_set`, `e2e_agent_evals_tab_renders` |
| AC-57 | D16, D17, D32 | `evals_tab_shows_the_latest_completed_run_metrics` |
| AC-58 | D17, D32 | `evals_tab_counts_cases_passed_in_their_latest_result` |
| AC-59 | D15, D32 | `evals_tab_presents_no_run_history` |
| AC-60 | D17, D26, D32 | `evals_tab_run_control_shows_progress`, `eval_progress_counts_completed_of_total` |
| AC-61 | D17, D32 | `evals_tab_shows_no_metrics_for_a_running_run` |
| AC-62 | D5, D12, D21, D29, D35, D38, D40 | `eval_dashboard_endpoint_lists_every_run_newest_first`, `eval_dashboard_lists_one_run_list_newest_first`, `e2e_eval_dashboard_filters_by_agent`, `nav_shortcut_help_derives_from_nav` |
| AC-63 | D1, D5, D10, D12, D21, D24, D29, D35 | `eval_agent_summaries_return_each_agents_latest_run`, `eval_dashboard_row_per_agent_states_its_latest_run` |
| AC-64 | D21, D29, D35, D38 | `eval_dashboard_filters_the_run_list_to_the_selected_agent`, `eval_agent_endpoints_return_cases_and_runs`, `e2e_eval_dashboard_filters_by_agent` |
| AC-65 | D21, D35 | `eval_dashboard_marks_the_selected_agent_row_as_selected` |
| AC-66 | D21, D36, D39 | `compare_dialog_shows_both_values_and_the_delta`, `e2e_eval_run_compare_shows_deltas` |

### Retirement traceability

Behaviour SPEC-04 removes, the shipped test that asserts it today, and what
proves the removal. These rows are deliberately outside the table above: they
are bound to SPEC-03 numbers, which no longer exist.

| Retired (SPEC-03) | Shipped test asserting it | Task | Evidence of removal |
|---|---|---|---|
| AC-1 (evals section shows the run history) | `evals_tab_shows_case_set_and_run_history`, `eval_agent_surface_returns_cases_and_run_history` | D15, D29, D32 | AC-59's positive assertion: no compare control, no run start time, no run version on the tab |
| AC-2 / AC-3 (two dashboard lists) | `eval_dashboard_lists_recent_runs_newest_first`, `eval_dashboard_shows_a_selected_agents_history`, `eval_dashboard_lists_completed_runs_newest_first` | D21, D29, D35 | one run list only — the rendered run-row count equals the returned run count |
| AC-6 / AC-7 / AC-8 (user-chosen expectation type) | `eval_case_modal_preselects_from_the_decision`, `eval_case_modal_requires_a_confirmed_expectation_type`, `eval_contracts_reject_missing_expectation_kind` | D13, D23, D24, D30 | `queryByRole("radiogroup")` is null; `EvalCaseCreate` has no `expectation_kind` key |
| AC-9 (freeze without severity/category) | `eval_case_is_immutable_when_its_finding_changes` | D27 | same test, extended to severity and category (AC-45) |
| AC-11 (overlapping expectations rejected) | `eval_overlapping_expectations_are_rejected`, `eval_find_overlap_reports_the_two_ranges` | **D23 (deleted, not rewritten)**, D5, D6, D9 | `findOverlap` and the `expectations` key are gone: `eval_contracts_update_payload_accepts_only_a_name` plus the Full block's grep |
| AC-15 (progress in its own block) | `evals_tab_shows_progress_and_no_metrics_while_running` | D17, D32 | split into `evals_tab_run_control_shows_progress` (AC-60) and `evals_tab_shows_no_metrics_for_a_running_run` (AC-61) |
| AC-31 (comparison from any selection) | `compare_dialog_shows_both_values_and_the_delta`, `e2e_eval_run_compare_shows_deltas` | D36, D39 | the e2e flow now opens the comparison from the dashboard (AC-66) |

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
- `cd server && pnpm test:integration --reporter=dot` (Docker; D27/D28/D29 are
  `*.it.test.ts`). If one file fails only in the whole-suite run, re-run that file
  alone before concluding a regression — `server/insights.md:64`.
- `cd client && pnpm typecheck`
- `cd client && pnpm test:unit --reporter=dot`
- `cd evals && pnpm eval:quality`
- `pnpm verify:l06` (repo root — must exit 0 and run none of the live model tiers)
- **Removal guard (AC-11 retirement + AC-40):**
  `grep -rn "findOverlap\|expectation_kind\|default_expectation_kind" server/src client/src`
  → hits only in `client/src/vendor/shared` / `server/src/vendor/shared` for the
  *type* `EvalExpectationKind`, and **no** hit for `findOverlap`,
  `expectation_kind` or `default_expectation_kind`.
- **AC-49/AC-50 structural guard:**
  `grep -n "startSuiteRun\|recordCaseResult\|bumpCaseProgress\|finalizeSuiteRun" server/src/modules/eval/runner.ts`
  → every hit is inside `execute()`, none inside `verifyCase()`.
- **AC-17 static guard (unchanged from the SPEC-03 plan):**
  `grep -rn "repoIntel\|repoMap\|buildCallers\|assembleForRun\|ContextService" server/src/modules/eval/`
  → **no hits**.
- **Ring guard:**
  `grep -rn "drizzle-orm\|db/schema\|fastify" server/src/modules/eval/scoring.ts server/src/modules/eval/helpers.ts`
  → **no hits**.
- `./scripts/e2e.sh` — this plan changes two UI entry points' contents (the
  agent editor's Evals tab and the `/eval` route) and moves where the comparison
  is opened from, so the browser flows are mandatory. 15 flows should pass.
- Manual smoke, **owner: `human`** (needs a browser and a real API key; never
  the only evidence for any AC — every AC above is bound to an automated test):
  `./scripts/dev.sh`, open a PR, confirm the eval-case action is unavailable on
  an undecided finding and available once decided, create a case, verify it on
  its own and confirm the run history did not move, run the set, and confirm the
  dashboard's single list filters to the agent and opens the comparison.

## Explicit note

Architecture and security review are out of scope for `implementer` and are
handled by separate review agents/skills after implementation.

## Open questions / assumptions

1. **A create request for an undecided finding is refused with 422.** SPEC-04
   states AC-42 on the client (the action is unavailable and says why) and AC-41
   on the type derivation, but writes no criterion for the server path. Refusing
   is the only behaviour consistent with AC-41 — there is no third type to give
   such a case — and leaving it unspecified would let a direct API call create a
   case with no defensible label. Planned as a 422 `ValidationError`; bound to
   AC-41.
2. **A verification is served synchronously.** One model call, no client-side
   timeout (`client/src/lib/api.ts:21-33`) and no Fastify request timeout
   configured, so the only bound is Node's 300 s server default. If a real
   provider is ever slow enough to hit that, the fix is the run's shape
   (background + poll), not a longer timeout — but nothing observed so far
   suggests it is needed.
3. **The suite run also writes each case's `latest_result`.** SPEC-04 §
   Contracts (*Case result*) says a case's most recent outcome comes from
   "whichever invocation produced it: a suite run or a single-case verification",
   and AC-58's counter reads those results, so a run must move them. The run's
   own per-case rows stay the separate permanent copy.
4. **`EvalCaseRecord.expectations` stays an array of one**, for the reason in
   Placement decision 8. If a later round wants the contract to say "exactly one"
   structurally, that is its own piece of work.
5. **`GET /eval-runs` changes meaning** from "recent completed runs" to "recent
   runs of any status". Anything reading it as a completed-only feed would break
   — checked, the only consumer is `useRecentEvalRuns`
   (`client/src/lib/hooks/eval.ts:117-122`), which this plan updates.
6. **Existing `eval_cases` rows in the developer's workspace keep NULL severity,
   category and latest result.** No backfill: SPEC-04's edge case says such a
   case states them as unavailable, and inventing a severity would be worse than
   admitting the case does not know. The seed adds a fresh third case in exactly
   that state so the surface is exercised without depending on anyone's local
   database.
7. **The `Modal` primitive is still left untouched.** The case form is an inline
   panel precisely so this plan does not create a second surface needing the
   focus trap the vendored `Modal` lacks. That pre-existing a11y gap is still its
   own piece of work.
