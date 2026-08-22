# Development Plan: Eval Pipeline — Phase B (suite runs, background runner, per-case context)

Spec: docs/specs/cross/SPEC-03-eval-pipeline.md
Date: 2026-08-22
Execution mode: multi-agent (Step 0 freeze → 2 parallel tracks → Integration)

Phase 2 of 3. Depends on
`docs/plans/2026-08-22-eval-pipeline-a-foundation.md` being fully green:
every contract, the scorer, the schema and the case repository come from
there and are **not re-opened here**. Phase C
(`docs/plans/2026-08-22-eval-pipeline-c-client-surfaces.md`) consumes the
HTTP surface frozen below.

## Goal

Make an agent's whole eval set runnable as an asynchronous background job:
start returns immediately with a pending run whose case set is already frozen,
a background loop evaluates one captured case at a time — resolving that
case's own repository's project-context attachments, capturing the paths and
the text as used — scores each result with the Phase A scorer, and aggregates
recall, precision, citation accuracy, counts and cost. Plus the read paths
that later surface it: run history with per-run metric deltas, a run
comparison including the captured system-prompt diff, the workspace
dashboard, the run-all-agents fan-out, and a single-case preview that
persists nothing.

## Out of scope

- **Every client surface.** Phase C renders all of this; nothing under
  `client/` is touched by this plan.
- **Any modification of `server/src/modules/reviews/**`.** `run-executor.ts`
  is the reference pattern for the runner and is read, never edited. The
  eval runner is new code in a new file.
- Reusing the SSE run bus (`server/src/platform/sse.ts`). Eval runs are
  observed by polling — see the decision below.
- Cancelling an eval run, retrying a case, or resuming a run after a process
  restart. No AC asks for any of them.
- Rescoring a past run after a case is edited; recomputing a comparison over a
  common case subset. Both are explicit spec Edge-case decisions.
- Repo-intel enrichment, the PR description and the derived PR intent. All
  three are spec non-goals and are structurally absent because
  `buildEvalReviewInput` (Phase A) cannot express them.
- A feature-specific time budget or rate limit (spec, Non-functional
  requirements).
- `pnpm verify:l06` — Phase C.

## Constraints

Every claim below was read in this session at the line given.

1. **`ContextService.assembleForRun(workspaceId, agentId, prRepoId)` already
   does everything AC-51 and AC-52 need.**
   `server/src/modules/context/service.ts:198-246`: it filters entries whose
   `repo_id !== prRepoId` to `excluded` with reason `other_repo` (line 214),
   reads each survivor via `readDocument(root, entry.path)` and, when the read
   returns `null`, pushes `{ path, reason: 'absent' }` and **continues**
   (lines 217-222), then applies the token budget with reason `over_budget`
   (lines 229-241). AC-51 ("continue evaluating that case without that
   document") and AC-52 ("record that attachment's path together with the
   reason") are therefore **already implemented** — this phase captures and
   persists the result, it does not reimplement it. **Reuse it; do not write a
   second resolver.**
2. **Context is scoped to a repository, so it must resolve per case.**
   `server/src/db/schema/context.ts:144-157` — a `context_attachments` row
   carries `repo_id` (NOT NULL, FK → `repos`) and `path`; `assembleForRun`
   reads text from `repo.clonePath` (`service.ts:204-217`). A suite whose
   cases come from two repositories assembles different documents per case.
3. **`ContextService` takes explicit deps and is constructed per use.**
   `server/src/modules/context/service.ts:30-51`;
   `run-executor.ts:480-486` shows the exact construction
   (`{ repo: new ContextRepository(db), agents, tokenizer, cloneDir, repos }`).
   The eval runner constructs it the same way. This is the filesystem
   dependency the runner acquires.
4. **`assembleForRun` throws `NotFoundError` when the repo is not in the
   workspace** (`service.ts:299-303` via `requireRepo`). A case whose
   `repo_id` points at a deleted repo therefore throws — the runner must treat
   that as "no context for this case", **not** as an errored case (spec Edge
   case: a missing context document is deliberately not machinery failure).
5. **`reviewPullRequest` returns exactly what scoring needs.**
   `reviewer-core/src/review/run.ts:220-231`: `review.findings` are the
   grounded survivors, `dropped` are the rejects, and `tokensIn`/`tokensOut`/
   `costUsd` come from the provider. `costUsd` is `null` when any chunk
   reported `null` (line 197) — propagate `null`, never `0`.
6. **The PR review path is fire-and-forget with no await.**
   `server/src/modules/reviews/service.ts:131-137` — `void
   this.executor.executeRuns(...).catch(...)`, response returned immediately.
   This is the pattern to copy for AC-21.
7. **`container.llm(provider)` throws `ConfigError` when the key is missing.**
   `server/src/platform/container.ts:192-212`. A run started without an API
   key therefore errors **every** case, which is exactly the AC-29 scenario
   the spec calls out ("recall 0%, precision 100% produced by a missing API
   key cannot be read as a prompt regression").
8. **A `.it.test.ts` must mock `secrets`, not just `llm`.**
   `server/insights.md`, Recurring Errors 2026-08-05: injecting only
   `llm.openai` still let a differently-keyed provider fall through to the
   developer's real `~/.devdigest/secrets.json` and make a paid call.
   `secrets: new MockSecretsProvider()` is one line and strictly broader.
9. **`waitForPrRuns` throws on timeout rather than returning partial data.**
   `server/insights.md`, Codebase Patterns 2026-08-07. The eval equivalent
   (T18) must do the same, reporting the run state it did see.
10. **`agents.linkedSkills(agentId)` is not workspace-scoped.**
    `server/src/modules/reviews/run-executor.ts:443-446` says so explicitly:
    safe only because the agent row was already fetched workspace-scoped. The
    eval runner must fetch the agent through `agents.getById(workspaceId, id)`
    **first**, exactly as the review path does.
11. **A skill whose library toggle is off is skipped.**
    `run-executor.ts:453-460` filters `links.filter(l => l.skill.enabled)`.
    The eval capture uses the same filter so "the agent as configured" means
    the same thing on both paths.
12. **No route in this feature may declare `config.rateLimit`.** Spec,
    Non-functional requirements. `reviews/routes.ts:29` does; it is not a
    precedent to copy here.
13. **`ORDER BY` on a non-unique column needs the primary key appended.**
    `server/insights.md`, Recurring Errors 2026-08-04. Run history orders by
    `started_at DESC, id DESC`.
14. **No diff library exists in `server/package.json`.** The system-prompt
    diff (AC-41) is implemented as a small deterministic line diff in
    `helpers.ts`; adding a dependency for it would be a supply-chain decision
    (`security` A03) taken for four rendered lines.

## Placement decisions

- **`server/src/modules/evals/runner.ts` — ring 2, explicit deps.**
  `onion-architecture` "Where the side effects go": a background job's body is
  a service method, and "a job is another way to enter a use case — like HTTP
  — so it must not contain logic that HTTP cannot also reach". The runner is a
  ring-2 class taking `{ repo, agents, context, llm, logger }`; it holds no
  `Container` (the skill's rule for new services) and no Drizzle import.
- **Context resolution stays in `ContextService`; the runner memoises per
  `repo_id` within one run.** `onion-architecture` "Ports: when to add one" —
  do not add a second implementation of a capability that already exists with
  one caller. The memo is a `Map<string, AssembledRunContext>` local to one
  `execute()` call, so a 12-case suite over one repository reads each document
  once, and two repositories resolve twice.
- **Metric aggregation, delta computation, comparison assembly and the prompt
  diff are pure functions in `helpers.ts`**, not in the runner and not in a
  route — `onion-architecture` "Turning a row into an API shape → ring 2,
  `helpers.ts` (pure)". This is what makes AC-38, AC-40, AC-41, AC-42 and
  AC-54 unit-testable with no database, as the spec's traceability requires.
- **Runs are observed by polling, not SSE.** AC-26 requires the outcome to
  appear "without the user reloading that surface"; a TanStack Query
  `refetchInterval` on `GET /eval-runs/:id` while `state` is non-terminal
  satisfies it. The SSE bus is per-`run_id` in-memory state built for the
  review path (`platform/sse.ts:19-101`) and touching it would put eval
  concerns into a shared platform object for no requirement. `frontend-ui-architecture`'s
  "server state lives in a query cache" makes the client half trivial.
- **`POST /eval-cases/:id/preview` is plain request/response and writes
  nothing** — the user's settled decision and AC-33. It shares the per-case
  evaluation function with the runner so the two can never diverge.

## Entry points & duplicate registries

- **`server/src/modules/evals/routes.ts`** already exists from Phase A; this
  phase adds routes to the same plugin. **No new entry in
  `server/src/modules/index.ts`** — checked, `evals` was registered by Phase A
  T15.
- **Route-ordering hazard.** `server/insights.md` 2026-08-04: a static segment
  declared after a `:id` sibling can be shadowed. `GET
  /agents/:id/eval-runs/active` is declared **before** any
  `/agents/:id/eval-runs/:x` route (there is none in this plan, but declare it
  first anyway and carry the comment), and `/evals/dashboard` is declared
  before `/evals/run-all`. Covered by **T13**.
- **`server/src/db/schema.ts`** — checked, no change in this phase: Phase A
  T7 registered both new tables.
- **Both `vendor/shared` contract copies** — checked, no change in this phase:
  every shape this phase fills (`EvalRun`, `EvalRunRecord`, `EvalComparison`,
  `EvalDashboard`, `EvalRunResult`, `EvalCapturedContext`) was frozen in
  Phase A Step 0. If this phase discovers a missing field, **stop and amend
  Phase A's contract in both copies rather than adding a local type.**
- `grep -rn "assembleForRun" server/src` — **checked**: the only caller today
  is `run-executor.ts:487`. This phase adds a second caller and modifies
  neither the method nor the first caller.
- `grep -rn "FeatureModelId\|resolveFeatureModel" server/src/modules/evals` —
  **checked, nothing, and nothing is added**: an eval run uses the agent's own
  `provider`/`model` (`schema/agents.ts:15-16`), so the feature-model registry
  (`contracts/platform.ts:14-20`) is untouched.

## Affected modules & files

- **server module**: `server/src/modules/evals/runner.ts` (new),
  `server/src/modules/evals/service.ts`,
  `server/src/modules/evals/helpers.ts`,
  `server/src/modules/evals/repository/run.repo.ts`,
  `server/src/modules/evals/repository/index.ts`,
  `server/src/modules/evals/routes.ts`,
  `server/src/modules/evals/constants.ts`
- **server tests**: `server/test/eval-metrics.test.ts` (new),
  `server/test/eval-compare.test.ts` (new),
  `server/test/eval-runs.it.test.ts` (new),
  `server/test/helpers/eval-runs.ts` (new),
  `server/test/eval-helpers.test.ts` (extended)

## Step 0 — the frozen contract (written before the tracks fork)

### HTTP surface added by this phase

```
POST   /agents/:id/eval-runs               → EvalRun         (AC-21; 409 if one is active — AC-23)
GET    /agents/:id/eval-runs               → EvalRunRecord[] (AC-36, AC-38; newest first)
GET    /agents/:id/eval-runs/active        → EvalRun | null  (AC-23, AC-24)
GET    /agents/:id/eval-compare?a=&b=      → EvalComparison  (AC-40, AC-41, AC-42, AC-54)
GET    /eval-runs/:id                      → EvalRun         (AC-24, AC-26, AC-29)
POST   /eval-cases/:id/preview             → EvalRunResult   (AC-33)
GET    /evals/dashboard                    → EvalDashboard   (AC-35, AC-32 payload)
POST   /evals/run-all                      → { runs: EvalRun[] } (AC-31)
```

Every route is workspace-scoped via `getContext(container, req)` and declares
zod `params`/`querystring`/`body` schemas via `fastify-type-provider-zod`
(`server/CLAUDE.md:38-39`). **None declares `config.rateLimit`** (constraint
12).

`GET /agents/:id/eval-cases` (Phase A) gains a populated `last_outcome` in
this phase: the case's result from the most recent **completed** suite run
that included it, or `null` (AC-34). Its `EvalCase` shape does not change.

### Runner surface — `server/src/modules/evals/runner.ts`

```ts
export interface EvalSuiteRunnerDeps {
  repo: EvalRepository;
  agents: AgentsRepository;
  buildContext: () => ContextService;     // constructed per run, as run-executor.ts:480 does
  llm: (provider: Provider) => Promise<LLMProvider>;
  logger?: Logger;
}

export class EvalSuiteRunner {
  constructor(deps: EvalSuiteRunnerDeps);

  /** Capture config + case set, persist a pending run + one frozen result row
   *  per captured case, fire `execute` without awaiting, return the run. */
  start(workspaceId: string, agentId: string): Promise<EvalRun>;

  /** The background loop. Public so the integration test can drive it, and so
   *  a future job runner can call it. Never throws: a per-case failure is
   *  recorded on that case's row and the loop continues (AC-27). */
  execute(workspaceId: string, runId: string): Promise<void>;

  /** One case, no persistence — shared with `execute` so the two can never
   *  diverge. `capturedContext` is the resolved documents for this case. */
  evaluateOne(input: EvaluateOneInput): Promise<EvaluateOneOutput>;
}

export interface EvaluateOneInput {
  systemPrompt: string; provider: Provider; model: string; strategy: ReviewStrategy;
  skills: string[];
  documents: { path: string; text: string }[];
  inputDiff: string;
  expectations: EvalExpectation[];
  sessionId: string;
}
export interface EvaluateOneOutput {
  result: EvalPerTrace;                    // `stored` is set by the caller
  documents: { path: string; text: string }[];
  excluded: { path: string; reason: string }[];
}
```

### Pure helpers added to `server/src/modules/evals/helpers.ts`

```ts
export function runMetricsFrom(results: EvalCaseResultRow[]): RunMetrics | null;  // null when every case errored (AC-29)
export function metricDelta(later: EvalRunRow, earlier: EvalRunRow | null): EvalMetricDelta | null;  // AC-38
export function diffPromptLines(earlier: string, later: string): EvalPromptDiffLine[];  // AC-41
export function buildComparison(earlier: EvalRunRow, later: EvalRunRow,
  earlierResults: EvalCaseResultRow[], laterResults: EvalCaseResultRow[]): EvalComparison; // AC-40, AC-42, AC-54
export function contextKey(d: EvalContextDocument): string;      // `${repo_id ?? ''}:${path}`
export function mergeCapturedContext(prev: EvalCapturedContext,
  next: { documents: EvalContextDocument[]; excluded: EvalContextExclusion[] }): EvalCapturedContext;  // AC-53
```

`buildComparison` orders its two arguments earlier-first by `started_at`,
sets `case_sets_differ` by comparing the two runs' **sets of `case_id`**
(falling back to `case_name` for a result whose case has since been deleted)
and always reports `earlier_case_count` / `later_case_count` (AC-42). It sets
`context_differs` when the two runs' captured contexts differ in the set of
`contextKey`s **or** in the text stored for any shared key (AC-54).

`diffPromptLines` is a deterministic line-level diff (longest-common-
subsequence over lines, no dependency, no fuzzy matching). Identical prompts
produce only `same` lines.

### The state machine (AC-21 → AC-29), implemented in `execute`

| From | Event | To |
|---|---|---|
| — | `start()` persists the run and its frozen result rows | `pending` |
| `pending` | the first case's evaluation begins | `running` |
| `running` | a case result is recorded | `running`, `cases_done += 1` |
| `running` | every captured case has a result and **at least one was evaluated** | `completed`, metrics written |
| `running` | every captured case errored | `failed`, **metrics stay `null`** (AC-29) |

A run started for an agent with **zero** cases is never created — the route
rejects with a 400 before any row is written (AC-22's server half; the client
does not offer the control at all).

## Tasks

### Track A — server implementation (files disjoint from Track B)

- [ ] T1 `runMetricsFrom` per AC-15–AC-18: recall over `must_find` cases only (errored `must_find` cases count in the denominator and are not passed), 1 when there is no `must_find` case; precision = summed true positives / summed grounded findings, 1 when the denominator is 0; citation accuracy = summed grounded / summed raw, 1 when raw is 0; returns `null` when every case errored — `server/src/modules/evals/helpers.ts` — owner: `implementer` — skill: `typescript-expert` — → AC-29 → `eval_metrics_unit`
- [ ] T2 `metricDelta` — per-metric difference against the immediately preceding **completed** run of the same agent; `null` (not zeroes) for the earliest completed run — `server/src/modules/evals/helpers.ts` — owner: `implementer` — skill: `typescript-expert` — → AC-38 → `eval_metrics_unit`
- [ ] T3 `diffPromptLines` — LCS line diff, no dependency added — `server/src/modules/evals/helpers.ts` — owner: `implementer` — skill: `typescript-expert` — → AC-41 → `eval_compare_unit`
- [ ] T4 `contextKey` + `mergeCapturedContext` — union across cases, first occurrence of a key wins, excluded entries deduped by `path + reason` — `server/src/modules/evals/helpers.ts` — owner: `implementer` — skill: `typescript-expert` — → AC-53 → `eval_compare_unit`
- [ ] T5 `buildComparison` per the Step 0 contract — `server/src/modules/evals/helpers.ts` — owner: `implementer` — skill: `typescript-expert` — → AC-40, AC-42, AC-54 → `eval_compare_unit`
- [ ] T6 `EvalRunRepository` bodies: `createRunWithFrozenCases` (one transaction — the run row plus one `eval_case_results` row per case, `ordinal` ascending; the service owns the transaction per `onion-architecture` "Transactions are owned by the service"), `markRunning`, `recordCaseResult`, `completeRun`, `failRun`, `appendCapturedContext`, `getRunWithResults`, `listRunsForAgent` (`started_at DESC, id DESC`), `latestCompletedRun`, `activeRunForAgent`, `lastOutcomeByCase(agentId)`, `dashboardRows(workspaceId)` — `server/src/modules/evals/repository/run.repo.ts`, `server/src/modules/evals/repository/index.ts` — owner: `implementer` — skill: `drizzle-orm-patterns` — → AC-30, AC-36 → `eval_runs_it`
- [ ] T7 `EvalSuiteRunner.evaluateOne`: build the review input with Phase A's `buildEvalReviewInput` (never a hand-built object), call `reviewPullRequest`, compute `rawCount = review.findings.length + dropped.length`, score with Phase A's `scoreCase`, and return an `EvalPerTrace`. Any throw becomes `status: 'errored'`, `pass: false`, `error: <message>`, zero findings — `server/src/modules/evals/runner.ts` — owner: `implementer` — skill: `typescript-expert` — → AC-28 → `eval_runs_it`
- [ ] T8 `EvalSuiteRunner.start`: fetch the agent workspace-scoped (`agents.getById`) **before** `linkedSkills` (constraint 10), capture `system_prompt`/`provider`/`model`/`strategy` and the enabled linked skills' `{name, body}` in link order (constraint 11), read the agent's cases, reject with a 400-mapped error when there are none, then persist the run and its frozen case rows in one transaction and `void this.execute(...).catch(log)` — `server/src/modules/evals/runner.ts` — owner: `implementer` — skill: `onion-architecture` — → AC-21, AC-30 → `eval_runs_it`
- [ ] T9 `EvalSuiteRunner.execute`: mark `running` on the first case; for each frozen result row in `ordinal` order — resolve context via a per-`case_repo_id` memo over `ContextService.assembleForRun`, treating a `null` repo id as `{documents:[],excluded:[]}` **without calling the resolver** (AC-49) and a resolver throw as the same empty result with an `excluded` entry carrying the reason (constraint 4); merge into the run's captured context (AC-53); `evaluateOne`; `recordCaseResult`; increment `cases_done`. A per-case failure never aborts the loop (AC-27). At the end: every case errored → `failRun` with metrics left `null` (AC-29), otherwise `completeRun` with `runMetricsFrom` — `server/src/modules/evals/runner.ts` — owner: `implementer` — skill: `onion-architecture` — → AC-24, AC-27, AC-28, AC-29, AC-49, AC-51, AC-52, AC-53 → `eval_runs_it`
- [ ] T10 `EvalService.startSuiteRun` (409 `AppError` when `activeRunForAgent` returns a row **and** on the partial-unique-index violation from a concurrent second attempt — catch the constraint error and translate it, never let a Postgres error code reach the route, `onion-architecture` "Errors"), `getRun`, `listRuns` (attaching `metricDelta`), `compareRuns`, `dashboard`, `runAllAgents`, `previewCase` — `server/src/modules/evals/service.ts` — owner: `implementer` — skill: `onion-architecture` — → AC-23, AC-31, AC-33, AC-36, AC-38, AC-40 → `eval_runs_it`
- [ ] T11 `EvalService.previewCase`: resolve the agent + the case's context exactly as `execute` does, call `evaluateOne`, return `{ case_id, stored: false, result }` and **write nothing** — `server/src/modules/evals/service.ts` — owner: `implementer` — skill: `onion-architecture` — → AC-33 → `eval_runs_it`
- [ ] T12 `EvalService.dashboard`: one entry per agent with ≥1 eval case (an agent with cases and no completed run is present with `never_run: true`, not hidden), plus `run_all: { agent_count, case_count }` counting exactly the agents that would be started (AC-32) — `server/src/modules/evals/service.ts` — owner: `implementer` — skill: `drizzle-orm-patterns` — → AC-31, AC-32 → `eval_runs_it`
- [ ] T13 Routes for the eight endpoints above, `/agents/:id/eval-runs/active` and `/evals/dashboard` declared before their `:id`-shaped siblings with the "so the static segment can never be read as a uuid" comment (`server/insights.md` 2026-08-04); `GET /agents/:id/eval-cases` extended to populate `last_outcome` from `lastOutcomeByCase` (AC-34); no `config.rateLimit` anywhere — `server/src/modules/evals/routes.ts`, `server/src/modules/evals/constants.ts` — owner: `implementer` — skill: `fastify-best-practices` — → AC-21, AC-33, AC-34, AC-35, AC-36 → `eval_runs_it`
- [ ] T14 `EvalService.getCase*` gains a `context_note` on the `EvalCase` DTO stating that no project context will be resolved when `repo_id` is `null` — the **server half** of AC-50; Phase C renders it. Add the field to `EvalCase` in **both** `vendor/shared/contracts/knowledge.ts` copies as `resolves_context: z.boolean()` (true iff `repo_id !== null`), rather than a prose string, so the client owns the wording — `server/src/vendor/shared/contracts/knowledge.ts`, `client/src/vendor/shared/contracts/knowledge.ts`, `server/src/modules/evals/helpers.ts` — owner: `implementer` — skill: `zod` — → AC-50 → `eval_metrics_unit`

### Track B — tests (files disjoint from Track A)

- [ ] T15 `eval_metrics_unit` — `runMetricsFrom` over: all-passing mixed set; a run with no `must_find` case (recall 1); a run with zero grounded findings (precision 1, citation 1, recall 0); a run where one `must_find` case errored (denominator unchanged, not passed, contributes no findings); a run where **every** case errored (returns `null`). `metricDelta` for the earliest completed run (`null`, not zeroes) and for a later one. `resolves_context` true/false — `server/test/eval-metrics.test.ts` — owner: `test-writer` — skill: `typescript-expert` — → AC-29, AC-38, AC-50 → `eval_metrics_unit`
- [ ] T16 `eval_compare_unit` — `diffPromptLines` on identical prompts (all `same`), one added line, one removed line, one replaced line. `buildComparison`: earlier-first ordering regardless of argument order; all four metric pairs with their deltas; `case_sets_differ` false for identical case sets and true when they differ, with both counts present; `context_differs` false for identical captures, true when a path is added, true when a **shared path's text** changed. `mergeCapturedContext` deduping by `contextKey` and keeping the first occurrence — `server/test/eval-compare.test.ts` — owner: `test-writer` — skill: `typescript-expert` — → AC-40, AC-41, AC-42, AC-53, AC-54 → `eval_compare_unit`
- [ ] T17 Extend the Phase A helper test with the eval-input assembly used by the runner: assert `evaluateOne`'s review input carries the captured system prompt, model, strategy, skills and documents and **nothing else** (re-asserting AC-11 at the runner's call site, not just the helper's) — `server/test/eval-helpers.test.ts` — owner: `test-writer` — skill: `typescript-expert` — → AC-11 → `eval_helpers_unit`
- [ ] T18 `waitForEvalRun(app, runId, { timeoutMs })` — polls `GET /eval-runs/:id` until `state` is `completed` or `failed`; on timeout it **throws** with the last observed state, `cases_done`/`cases_total` and the per-case statuses (never returns partial data — `server/insights.md` 2026-08-07) — `server/test/helpers/eval-runs.ts` — owner: `test-writer` — skill: `typescript-expert` — → AC-21 → `eval_runs_it`
- [ ] T19 `eval_runs_it` — Postgres-backed. `appWith` overrides carry **both** `secrets: new MockSecretsProvider()` and a `MockLLMProvider` keyed for the seeded agent's provider (constraint 8). Covers: `POST /agents/:id/eval-runs` returns `state: 'pending'` **before** any case is evaluated (**AC-21**); a second `POST` while one is active returns 409 (**AC-23**); the run reaches `completed` with `recall`/`precision`/`citation_accuracy`, `traces_passed`/`traces_total` and its `per_trace` rows persisted (**AC-36**, and the Course-verification "integration test of a suite run"); a case created **after** the run started is absent from that run's `per_trace` (**AC-30**); one case whose LLM call throws leaves the other cases evaluated (**AC-27**) and that case recorded `errored` and not passed (**AC-28**); a run whose every case throws ends `failed` with `recall`/`precision`/`citation_accuracy` all `null` (**AC-29**); `POST /eval-cases/:id/preview` returns a result with `stored: false` and adds **no** row to `eval_suite_runs` or `eval_case_results` (**AC-33**); `GET /agents/:id/eval-cases` returns `last_outcome` from the most recent completed run and `null` for a case no completed run included (**AC-34**); the dashboard lists an agent with cases and no completed run as `never_run` (**AC-35**) and `POST /evals/run-all` starts one run per agent with ≥1 case (**AC-31**); a run for an agent in another workspace 404s. **No assertion on how many cases exist** — `server/test/eval-runs.it.test.ts` — owner: `test-writer` — skill: `drizzle-orm-patterns` — → AC-21, AC-23, AC-27, AC-28, AC-29, AC-30, AC-31, AC-33, AC-34, AC-35, AC-36 → `eval_runs_it`
- [ ] T20 `eval_context_it` — Postgres-backed, project-context specifics. Two repositories with clone paths on disk (mirroring `server/test/context-run.it.test.ts`'s fixture shape), an agent with attachments in **both**, and two cases each associated with a different repository: assert the run's `captured_context.documents` is the **union** of what the two cases used, each carrying the **text as read** (**AC-53**); delete one attached file from a working copy before the run and assert the case is still evaluated (**AC-51**) and the run records that path with a reason (**AC-52**); a case with `repo_id: null` produces no document and no resolver call (**AC-49**) — `server/test/eval-context.it.test.ts` — owner: `test-writer` — skill: `drizzle-orm-patterns` — → AC-49, AC-51, AC-52, AC-53 → `eval_context_it`
- [ ] T21 **Regression fixture in the old shape.** `EvalCase` gains `resolves_context` in T14 and `last_outcome` is populated for the first time in this phase. Build one `EvalCase` fixture as a **raw object literal without `resolves_context` and without `last_outcome`** — the shape Phase A's route returned — and assert the read path copes: `EvalCase.safeParse(legacy)` fails **loudly** (both fields are required, so a stale server build cannot silently satisfy a new client), and the repository's own mapper always supplies both. Do **not** build the fixture through `EvalCase.parse()` — a fixture that carries the new keys cannot fail (`server/insights.md`, Recurring Errors 2026-08-17) — `server/test/eval-contracts.test.ts` — owner: `test-writer` — skill: `zod` — → AC-50 → `eval_contracts_parse`

### Integration

- [ ] T22 Run the full block below; then confirm by inspection that
      `server/src/modules/reviews/` is untouched
      (`git diff --name-only server/src/modules/reviews` is empty) and that
      `grep -rn "rateLimit" server/src/modules/evals` returns nothing —
      owner: `implementer` — skill: `fastify-best-practices` — → AC-21 → `eval_runs_it`

## Traceability

| AC | Tasks | Verified by |
|----|-------|-------------|
| AC-11 | T7, T17 | `eval_helpers_unit` |
| AC-21 | T8, T13, T18, T19, T22 | `eval_runs_it` |
| AC-23 | T10, T19 | `eval_runs_it` |
| AC-24 | T9, T13 | `eval_runs_it` |
| AC-27 | T9, T19 | `eval_runs_it` |
| AC-28 | T7, T9, T19 | `eval_runs_it` |
| AC-29 | T1, T9, T15, T19 | `eval_metrics_unit`, `eval_runs_it` |
| AC-30 | T6, T8, T19 | `eval_runs_it` |
| AC-31 | T10, T12, T19 | `eval_runs_it` |
| AC-32 | T12 | `eval_runs_it` |
| AC-33 | T10, T11, T13, T19 | `eval_runs_it` |
| AC-34 | T13, T19 | `eval_runs_it` |
| AC-35 | T12, T13, T19 | `eval_runs_it` |
| AC-36 | T6, T10, T13, T19 | `eval_runs_it` |
| AC-38 | T2, T10, T15 | `eval_metrics_unit` |
| AC-40 | T5, T10, T16 | `eval_compare_unit` |
| AC-41 | T3, T16 | `eval_compare_unit` |
| AC-42 | T5, T16 | `eval_compare_unit` |
| AC-49 | T9, T20 | `eval_context_it` |
| AC-50 | T14, T15, T21 | `eval_metrics_unit`, `eval_contracts_parse` |
| AC-51 | T9, T20 | `eval_context_it` |
| AC-52 | T9, T20 | `eval_context_it` |
| AC-53 | T4, T9, T16, T20 | `eval_compare_unit`, `eval_context_it` |
| AC-54 | T5, T16 | `eval_compare_unit` |

AC-24 has no dedicated integration assertion of its own here — the progress
pair (`cases_done` / `cases_total`) is asserted as part of `eval_runs_it`'s
completed-run row, and its **presentation** is bound to a client test in
Phase C. AC-32's confirmation copy is likewise Phase C; this phase only
proves the payload it is built from.

## Verification

### Fast loop (implementer / test-writer, after every step)

- `cd server && pnpm typecheck`
- `cd server && pnpm test:unit --reporter=dot`
- `cd client && pnpm typecheck` (T14 touches the client's contract copy)

### Full (plan-verifier, once at the end)

- `cd server && pnpm typecheck`
- `cd client && pnpm typecheck`
- `cd server && pnpm test:unit --reporter=dot`
- `cd client && pnpm test:unit --reporter=dot`
- `cd server && pnpm db:migrate` (no new migration in this phase; confirms the
  Phase A migrations are applied before the integration tests run)
- `cd server && pnpm test:integration --reporter=dot` — three DB-backed files
  here (`eval-runs.it.test.ts`, `eval-context.it.test.ts`, plus Phase A's
  `eval-cases.it.test.ts`). Re-run a single file before concluding a
  regression (`server/insights.md`, Open Questions 2026-08-05).
- `git diff --name-only server/src/modules/reviews` is empty.
- `grep -rn "rateLimit" server/src/modules/evals` returns nothing.
- No e2e in this phase: it adds **no** UI entry point.

## Explicit note

Architecture and security review are out of scope for `implementer` and are
handled by separate review agents/skills after implementation.

## Open questions / assumptions

- **A run is not resumable across a process restart.** The review path reaps
  orphaned runs on boot (`reviews/repository.ts:123-127`
  `reapStaleRunningRuns`). No AC requires the equivalent for eval runs, and
  the partial unique index would otherwise block every future run for an
  agent whose run died mid-flight. **Assumption: `start` treats a `running`
  run whose `started_at` is older than `STALE_RUN_MS` (constant, 30 min) as
  failed and replaces it.** If that is wrong, the alternative is an explicit
  cancel control, which the spec does not ask for.
- **`assembleForRun` throwing for a deleted repository** is treated as "no
  context, reason recorded" rather than an errored case (constraint 4). The
  spec's Edge cases decide this for a missing *document*; extending it to a
  missing *repository* is the consistent reading, but it is an inference.
- **AC-24's "number of cases already evaluated"** is `cases_done`, incremented
  after each result is recorded — so a case currently in flight counts as not
  yet evaluated. The spec does not disambiguate; this reading matches
  "already evaluated".
