# Development Plan: Eval Pipeline — Phase A (contracts, schema, scoring, case CRUD)

Spec: docs/specs/cross/SPEC-03-eval-pipeline.md
Date: 2026-08-22
Execution mode: multi-agent (Step 0 freeze → 2 parallel tracks → Integration)

Phase 1 of 3. Siblings:
`docs/plans/2026-08-22-eval-pipeline-b-suite-runs.md` (Phase B),
`docs/plans/2026-08-22-eval-pipeline-c-client-surfaces.md` (Phase C).
**B and C must not start before this file's Integration track is green** — both
code against the contracts frozen here.

Design refs:
`docs/specs/cross/_design/SPEC-03-eval-pipeline/06-eval-case-positive.png`,
`07-eval-case-negative.png` (the case shape this phase persists).

## Why three files instead of one phased file

`/impl <plan-path>` runs one plan end to end. 57 acceptance criteria across
server, client and shared contracts is more than one such invocation should
carry, and the three phases are **sequential, not parallel** — B needs A's
contracts and repository, C needs B's run endpoints. Three files give three
independently verifiable `/impl` runs, each with its own Fast loop and Full
verification, instead of one plan whose Verification block can only be run
after everything exists. The whole-spec AC map below keeps the set honest: no
`AC-N` is orphaned across the three files.

## Whole-spec AC → phase map (all 57, no orphans)

| Phase | ACs |
|---|---|
| **A** (this file) | AC-3, AC-4, AC-5, AC-8, AC-9(server), AC-11, AC-12, AC-13, AC-14, AC-15, AC-16, AC-17, AC-18, AC-19, AC-20, AC-46, AC-47, AC-49 |
| **B** | AC-11(runner call site), AC-21, AC-23, AC-24(payload), AC-27, AC-28, AC-29, AC-30, AC-31, AC-32(payload), AC-33, AC-34(read path), AC-35(payload), AC-36, AC-38(computation), AC-40, AC-41, AC-42, AC-49, AC-50(server half), AC-51, AC-52, AC-53, AC-54(computation) |
| **C** | AC-1, AC-2, AC-6, AC-7, AC-8(client), AC-9(client message), AC-10, AC-20(presentation), AC-22, AC-23(control), AC-24(presentation), AC-25, AC-26, AC-29(presentation), AC-31, AC-32(confirmation), AC-33(presentation), AC-34(presentation), AC-35, AC-36, AC-37, AC-38(presentation), AC-39, AC-40–AC-42(presentation), AC-43, AC-44, AC-45, AC-48, AC-50(presentation), AC-54(presentation), AC-55, AC-56, AC-57 |

Many criteria are deliberately split across two phases — a server-side rule
and a client-side presentation, or a pure computation and its rendering.
**Each half is bound to its own named test in its own phase file**, so no half
ships unproven, and the union of the three Traceability tables covers AC-1 to
AC-57 with no gap and no orphan.

## Goal

Give the eval pipeline its foundation: the Zod contracts every later phase
codes against (in **both** vendored copies), the persistence model that
replaces the empty per-case `eval_runs` slot with a run-session table plus a
per-case-result table, a **pure, model-free scorer** that turns expectations
plus grounded findings into per-case pass and run-level recall / precision /
citation accuracy, and the eval-case CRUD surface — including seeding a case
from an accepted or dismissed finding with its agent and repository derived
server-side.

## Out of scope

- Suite runs, the background runner, per-case context resolution, preview
  runs, run history, dashboards and comparison — **Phase B**.
- Every client surface, including the case dialog, the Evals tab, the finding
  action and both dashboards — **Phase C**.
- `pnpm verify:l06` (AC-57) — composed in **Phase C**, once every piece it
  invokes exists.
- Any change to `reviewer-core/`. This feature **consumes** `groundFindings`,
  `sliceDiff` and `reviewPullRequest` unchanged. (The spec's `Modules:` header
  lists `reviewer-core`; no file in that package is edited by any phase.)
- Any change to `server/src/modules/reviews/**`. The PR review path is the
  reference pattern for Phase B's runner and is **read, never modified**.
- A seed script or a fixture that creates eval cases. The course's "≥8 eval
  cases" is demo data gathered by hand; **no test and no seed asserts a case
  count**.
- Deleting `EvalTrendPoint` (`contracts/eval-ci.ts:57-65`). It becomes
  unreferenced when `EvalDashboard` loses `trend`; it stays in place as unused
  starter scaffolding, per root `CLAUDE.md` "don't repurpose or clean them up".
- Repurposing `eval_cases.input_files` / `input_meta`. The spec's non-goals
  exclude the **Files** and **PR meta** input tabs (mockups 06/07), so both
  columns stay unused.

## Constraints

Every claim below was read in this session at the line given.

1. **`eval_runs` is per-case shaped and empty.**
   `server/src/db/schema/eval.ts:22-35` — `case_id` FK, `ran_at`, `pass`,
   `recall`, `precision`, `citation_accuracy`. `grep -rn "evalRuns|eval_runs"`
   over the repo (excluding `server/clones/**`) returns only
   `schema/eval.ts:22`, `schema.ts:37,76`, `migrations/0000_init.sql:129,377`,
   the migration snapshots, and a doc comment in `eval-ci.ts:11` — **no
   repository, no route, no seed row**. The spec's Edge cases confirm the slot
   "holds no rows and carries no shape this feature must honour". It is
   dropped here, on the user's explicit instruction, which overrides root
   `CLAUDE.md`'s "unused tables are expected to sit empty".
2. **`drizzle-kit generate` hangs on a same-diff remove+add.**
   `server/insights.md`, Tool & Library Notes 2026-08-04: an interactive
   "created or renamed from X?" prompt reads raw keypresses and never resolves
   on this sandbox's stdin. It is documented for columns; a diff that drops
   `eval_runs` **and** creates `eval_suite_runs` / `eval_case_results` presents
   the same rename ambiguity at table level. **T5 and T7 are therefore two
   separate `pnpm db:generate` passes**, drop-only first, create-only second.
3. **`server/src/db/migrations/` is do-not-touch by hand.**
   `server/CLAUDE.md:57`. Migrations are **generated**, never written.
   Migrations are not applied on boot (`server/CLAUDE.md:49`) — `pnpm
   db:migrate` is manual.
4. **`server/src/db/schema.ts` enumerates every table three times in one
   file**: `export * from './schema/eval'` (line 23), the import list
   (line 37) and the `schema` object (lines 75-78). Lines 37 and 75-78 must
   both change when `evalRuns` goes and two tables arrive.
5. **`@devdigest/shared` has no source package — the two vendored copies are
   the source.** `Glob **/contracts/eval-ci.ts` returns only
   `client/src/vendor/shared/contracts/eval-ci.ts` and
   `server/src/vendor/shared/contracts/eval-ci.ts` (plus unrelated repo clones
   under `server/clones/`). Root `CLAUDE.md`: "A change to the source package
   must be manually re-synced into each vendor copy." **Every contract task
   below names both files.**
6. **`contracts/findings.ts` imports nothing but zod** (line 1), so
   `knowledge.ts` may import `Finding` from it with no cycle. `eval-ci.ts:3`
   already imports from `knowledge.js`, so the dependency direction
   `eval-ci → knowledge → findings` is the existing one.
7. **Both barrels already re-export `knowledge.js` and `eval-ci.js`**
   (`server/src/vendor/shared/index.ts:21,26`, same lines in the client copy).
   Reshaping in place therefore needs **no barrel edit**, and no new export
   name can collide at the barrel the way `AgentStats` did
   (`server/insights.md`, Codebase Patterns 2026-08-04).
8. **`server/test/contracts.test.ts:146-154` parses the old per-case
   `EvalRun`** (`recall`, `precision`, `citation_accuracy`, `traces_passed`,
   `traces_total`, `duration_ms`, `cost_usd`, `per_trace:[{name,pass,expected,
   actual}]`). Reshaping `EvalRun` breaks it — T20 updates it.
9. **`groundFindings` returns exactly the raw-vs-grounded pair citation
   accuracy needs.** `reviewer-core/src/grounding.ts:52-85` returns
   `{ kept, dropped }`; the raw count is `kept.length + dropped.length`.
   `reviewer-core/src/review/run.ts:210-221` shows `reviewPullRequest`
   surfacing `review.findings` (= `ground.kept`) and `dropped`.
10. **`sliceDiff` already extracts one file's slice of a unified diff.**
    `reviewer-core/src/review/reduce.ts:58-72`, exported at
    `reviewer-core/src/index.ts:35`. AC-4's "hunks of that finding's file"
    is that slice — no new diff-slicing code.
11. **`findingContext` resolves a finding to its review and pull request.**
    `server/src/modules/reviews/repository/review.repo.ts:146-160` returns
    `{ finding, review, pull }`; `review.agentId` is AC-5's owner and
    `pull.repoId` is AC-46's repository. `findings.ts:17-20` shows the
    workspace guard shape (`ctx.pull.workspaceId !== workspaceId` → 404) to
    copy.
12. **`loadDiff` needs a `Container`, a repo row and a pull row.**
    `server/src/modules/reviews/diff-loader.ts:12-30`; its fallback
    `diffFromPrFiles(repo, prId)` (lines 33-44) needs only the
    `ReviewRepository` and a PR id. The seed endpoint uses `loadDiff`, which
    means the evals service takes the same two rows — see decision 5 below.
13. **A new service takes explicit deps.** `onion-architecture` "Dependencies
    of a service"; `ContextService` (`server/src/modules/context/service.ts:30-51`)
    is the in-repo precedent. `container: Container` is grandfathered for the
    four existing services only.
14. **Routes must declare zod schemas via `fastify-type-provider-zod`.**
    `server/CLAUDE.md:38-39` — never `Schema.parse(req.body)` in a handler.
    The one tolerated exception in the repo is `reviews/routes.ts:32`; do not
    copy it.
15. **The spec forbids a feature-specific rate limit.** Non-functional
    requirements: "This feature SHALL NOT define a rate limit of its own."
    `reviews/routes.ts:29` sets `config: { rateLimit: { max: 10 … } }` — **do
    not copy that onto any eval route.**
16. **A static grep guard matches doc comments too.** `server/insights.md`,
    Codebase Patterns 2026-08-07. Phase C's purity check (AC-57) scans
    `scoring.ts`; T11 keeps `scoring.ts` free of any prose naming a provider,
    and Phase C's checker parses `import` lines only rather than raw text.
17. **`Finding` carries `file`, `start_line`, `end_line`** and is normalised by
    `normalizeFindingLines` before grounding (`grounding.ts:59`), so a kept
    finding's line pair is already ordered.

## Placement decisions

Each traces to a preloaded skill's rule, not to preference.

- **New module `server/src/modules/evals/`** with `routes.ts` (ring 4),
  `service.ts` (ring 2), `helpers.ts` (ring 2, pure), `scoring.ts` (ring 2,
  pure), `constants.ts` (ring 2) and `repository/` split per aggregate with a
  composing facade — `onion-architecture` "Module anatomy", which names
  `modules/reviews/` as the pattern to copy for a repository folder.
- **`scoring.ts` lives in the evals module, not in `reviewer-core`.**
  `onion-architecture`'s quick decision table puts "prompt assembly,
  grounding, diff reasoning" in ring 0 and everything else about a use case in
  ring 2. Scoring is eval-domain logic with exactly one consumer;
  `reviewer-core/CLAUDE.md:1-6` scopes that package to "diff → prompt → LLM →
  grounded findings". The file imports **types only** from `@devdigest/shared`
  and nothing else, which is what makes AC-19's purity mechanically checkable.
- **`resolveExpectations` and `buildEvalReviewInput` are pure functions in
  `helpers.ts`.** `onion-architecture` "What crosses each boundary": pure
  transforms belong in `helpers.ts`, never in a route. Both are the subject of
  unit-tested ACs (AC-8/AC-9 and AC-11) and must be callable with no DB.
- **Contracts are reshaped in the existing `knowledge.ts` / `eval-ci.ts`
  slots** rather than added in a new file — the `zod` skill's
  `compose-shared-schemas`, plus the user's instruction to adapt the existing
  `EvalCaseInput` / `EvalRunRecord` / `EvalRunResult` / `EvalDashboard` /
  `EvalRun` / `EvalPerTrace` / `EvalCase` / `EvalOwnerKind` slots. Consequence:
  no barrel edit (constraint 7).
- **Ownership (`agent_id`) and repository (`repo_id`) are derived server-side
  on the seed-create path, never taken from the request body** — `security`
  A08 (mass assignment: "destructure only expected fields … never
  `Model.create(req.body)`"). AC-5 and AC-46 are then structurally true, not
  merely tested.
- **Every read and write is workspace-scoped**, including the pure read paths
  — `security` A01 "deny by default" and the spec's NFR "readable and writable
  only within the requesting user's workspace, on every path".
- **`eval_suite_runs` gets a partial unique index on `(agent_id) WHERE state
  IN ('pending','running')`** — `postgresql-table-design` "Partial" indexing
  and "UNIQUE". AC-23's "only one run in progress per agent" becomes a
  database invariant rather than a check-then-insert race between two tabs.
  (The table is created here so the schema lands in one place; **Phase B**
  writes to it.)
- **`eval_case_results` freezes the case's name, diff, repository and
  expectations at run start.** `postgresql-table-design` "Normalize first …
  denormalize only for measured need" would argue against copying; the spec
  overrides it twice — AC-30 (a mid-run edit must not change the run's case
  set) and the Edge case "Editing a case between two runs … nothing is
  rescored retroactively". A frozen copy is the requirement, not an
  optimisation.
- **`case_id` and `case_repo_id` use `ON DELETE SET NULL`, not `CASCADE`** —
  the Edge case "Deleting a case that appears in past runs. Past results
  survive with the case name they captured". `eval_cases.repo_id` is likewise
  `ON DELETE SET NULL`, which lands the case in AC-49/AC-50's "no repository
  association" state rather than deleting it.

## Entry points & duplicate registries

- **`server/src/modules/index.ts:31-47`** — the module registry. `evals` must
  be added there (import + one entry). Covered by **T15**.
- **`server/src/db/schema.ts`** — three enumerations of the same tables in one
  file: `export *` (line 23, unchanged), the import list (line 37) and the
  `schema` object (lines 75-78). Both the import and the object change.
  Covered by **T5** (drop `evalRuns`) and **T7** (add the two new tables).
  *Not collapsible*: the `schema` object is Drizzle's client typing input and
  the `export *` is the public surface; they serve different consumers.
- **`server/src/vendor/shared/contracts/*` ↔ `client/src/vendor/shared/contracts/*`**
  — the same two contract files exist twice and are **not** generated from
  each other (root `CLAUDE.md`; `client/insights.md` 2026-08-05 records that
  the two copies are not even byte-identical today). Every contract task below
  (T1–T4) names **both** paths and ends with a `diff` check (T19).
- **Both `vendor/shared/index.ts` barrels** — checked
  (`server/src/vendor/shared/index.ts:17-29`): `knowledge.js` and
  `eval-ci.js` are already `export *`-ed, so **no barrel edit is needed** and
  no new name can collide there.
- **`server/test/contracts.test.ts:12,146`** — a second place asserting the
  `EvalRun` shape. Covered by **T20**.
- **`FeatureModelId`** (`contracts/platform.ts:14-20`) — checked: an eval run
  uses the **agent's own** `provider`/`model` (`schema/agents.ts:15-16`), so
  **no new feature-model id is needed and no registry is touched**.
- `grep -rn "EvalDashboard|EvalRunRecord|EvalRunResult|EvalCaseInput|
  EvalPerTrace|EvalTrendPoint" client/src server/src reviewer-core/src mcp/src`
  — **checked, the only hits are the two contract-file copies themselves and
  the two barrels.** Nothing else in the repo consumes these shapes, so
  reshaping them breaks no consumer beyond `contracts.test.ts`.
- `grep -rn "eval" mcp/src` — **checked, nothing**; the MCP server exposes no
  eval surface and is untouched by all three phases.

## Affected modules & files

- **shared contracts (× 2 copies)**:
  `server/src/vendor/shared/contracts/knowledge.ts`,
  `client/src/vendor/shared/contracts/knowledge.ts`,
  `server/src/vendor/shared/contracts/eval-ci.ts`,
  `client/src/vendor/shared/contracts/eval-ci.ts`
- **server schema**: `server/src/db/schema/eval.ts`, `server/src/db/schema.ts`,
  `server/src/db/migrations/**` (generated only)
- **server module** (new): `server/src/modules/evals/routes.ts`,
  `service.ts`, `helpers.ts`, `scoring.ts`, `constants.ts`,
  `repository/index.ts`, `repository/case.repo.ts`, `repository/run.repo.ts`
- **server registry**: `server/src/modules/index.ts`
- **server tests** (new/edited): `server/test/eval-scoring.test.ts`,
  `server/test/eval-helpers.test.ts`, `server/test/eval-cases.it.test.ts`,
  `server/test/contracts.test.ts`

## Step 0 — the frozen contract (written before the tracks fork)

Both tracks code against exactly this. Nothing here changes after T4 lands.

### Contract shapes — `contracts/knowledge.ts` (both copies)

```ts
// unchanged
export const EvalOwnerKind = z.enum(['skill', 'agent']);

// new
export const EvalExpectationKind = z.enum(['must_find', 'must_not_flag']);
export const EvalExpectation = z.object({
  kind: EvalExpectationKind,
  file: z.string().min(1),
  start_line: z.number().int().min(0),
  end_line: z.number().int().min(0),
  title: z.string().nullish(),      // display only
  severity: z.string().nullish(),   // display only (AC-56)
  category: z.string().nullish(),   // display only (AC-56)
});
export const EvalCaseOrigin = z.object({
  finding_id: z.string().nullable(),
  pr_id: z.string().nullable(),
  pr_number: z.number().int().nullable(),
  finding_title: z.string().nullable(),
});
export const EvalRunState = z.enum(['pending', 'running', 'completed', 'failed']);
export const EvalCaseStatus = z.enum(['pending', 'passed', 'failed', 'errored']);
export const EvalContextDocument = z.object({
  repo_id: z.string().nullable(), path: z.string(), text: z.string(),
});
export const EvalContextExclusion = z.object({ path: z.string(), reason: z.string() });
export const EvalCapturedContext = z.object({
  documents: z.array(EvalContextDocument),
  excluded: z.array(EvalContextExclusion),
});

// RESHAPED in place — the per-case result (a "trace" is a case)
export const EvalPerTrace = z.object({
  case_id: z.string().nullable(),
  name: z.string(),
  status: EvalCaseStatus,
  pass: z.boolean(),
  errored: z.boolean(),
  error: z.string().nullable(),
  findings: z.array(Finding),          // grounded findings only
  raw_findings_count: z.number().int(),
  expected_count: z.number().int(),    // AC-20 "expected"
  matched_count: z.number().int(),     // AC-20 "obtained"
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
  stored: z.boolean(),                 // false for a preview (AC-33)
});

// RESHAPED in place — the suite-run session
export const EvalRun = z.object({
  id: z.string(),
  agent_id: z.string(),
  agent_name: z.string().nullable(),
  state: EvalRunState,
  started_at: z.string(),
  finished_at: z.string().nullable(),
  system_prompt: z.string(),
  provider: z.string(),
  model: z.string(),
  strategy: z.string(),
  skills: z.array(z.string()),                 // captured linked skill NAMES, link order
  captured_context: EvalCapturedContext,       // AC-53
  recall: z.number().min(0).max(1).nullable(),
  precision: z.number().min(0).max(1).nullable(),
  citation_accuracy: z.number().min(0).max(1).nullable(),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  errored_count: z.number().int(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  per_trace: z.array(EvalPerTrace),
});

// RESHAPED in place — the persisted case
export const EvalCase = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,          // always 'agent' in this feature
  owner_id: z.string(),               // the agent id
  name: z.string(),
  input_diff: z.string(),
  repo_id: z.string().nullable(),
  repo_full_name: z.string().nullable(),
  expectations: z.array(EvalExpectation),
  polarity: EvalExpectationKind,      // derived; all expectations share one kind
  origin: EvalCaseOrigin.nullable(),
  notes: z.string().nullable(),
  last_outcome: EvalPerTrace.nullable(),   // AC-34; null until Phase B, always null here
  created_at: z.string(),
  updated_at: z.string(),
});
```

Metrics are `.nullable()` on purpose: AC-29 requires a failed run to carry
**no** metrics, and `nullable` is the only shape that can say "absent" rather
than "zero" (`client/insights.md` 2026-07-30 on `?? 0` hiding "missing").
Nothing here uses `.default(...)`: no eval record predates this feature (spec,
Edge cases), so there is no legacy document for a default to rescue, and
`.default()` on a shape that is never `.parse()`d on read is decorative
(`server/insights.md`, Recurring Errors 2026-08-17).

### Contract shapes — `contracts/eval-ci.ts` (both copies)

```ts
// RESHAPED — create/update payload. `owner_kind`/`owner_id` REMOVED: the agent
// comes from the route, never from the body (security A08).
export const EvalCaseInput = z.object({
  name: z.string().min(1),
  input_diff: z.string().min(1),
  repo_id: z.string().uuid().nullable(),
  expectations: z.array(EvalExpectation),
  notes: z.string().nullish(),
});
export const EvalCaseUpdate = EvalCaseInput.partial();

export const EvalMetricDelta = z.object({
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  cost_usd: z.number().nullable(),
});

// RESHAPED — one row of an agent's run history
export const EvalRunRecord = z.object({
  id: z.string(),
  agent_id: z.string(),
  started_at: z.string(),
  state: EvalRunState,
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  errored_count: z.number().int(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
  delta: EvalMetricDelta.nullable(),   // AC-38; null for the earliest run
});

// RESHAPED — a preview result, never stored (AC-33)
export const EvalRunResult = z.object({
  case_id: z.string(),
  stored: z.literal(false),
  result: EvalPerTrace,
});

// RESHAPED — the workspace dashboard (no trend, no alert: both are non-goals)
export const EvalDashboardEntry = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  model: z.string(),
  cases_total: z.number().int(),
  never_run: z.boolean(),
  running: z.boolean(),
  last_run_started_at: z.string().nullable(),
  traces_passed: z.number().int().nullable(),
  traces_total: z.number().int().nullable(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
});
export const EvalDashboard = z.object({
  agents: z.array(EvalDashboardEntry),
  // AC-32's confirmation payload, read with the dashboard so no extra call is
  // needed before the confirm dialog opens.
  run_all: z.object({ agent_count: z.number().int(), case_count: z.number().int() }),
});

// NEW (no existing slot) — Phase B fills it, Phase C renders it
export const EvalPromptDiffLine = z.object({
  kind: z.enum(['same', 'added', 'removed']), text: z.string(),
});
export const EvalComparisonMetric = z.object({
  key: z.enum(['recall', 'precision', 'citation_accuracy', 'cost_usd']),
  earlier: z.number().nullable(),
  later: z.number().nullable(),
  delta: z.number().nullable(),
});
export const EvalComparison = z.object({
  earlier: EvalRunRecord,
  later: EvalRunRecord,
  metrics: z.array(EvalComparisonMetric),
  prompt_diff: z.array(EvalPromptDiffLine),
  case_sets_differ: z.boolean(),
  earlier_case_count: z.number().int(),
  later_case_count: z.number().int(),
  context_differs: z.boolean(),
});

// NEW — the prefill returned for a finding (AC-1/AC-3/AC-4); persists nothing
export const EvalCaseSeed = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  repo_id: z.string(),
  repo_full_name: z.string(),
  name: z.string(),
  input_diff: z.string(),
  expectations: z.array(EvalExpectation),
  origin: EvalCaseOrigin,
});
```

### Module surface — `server/src/modules/evals/scoring.ts` (pure, ring 2)

```ts
export interface Zone { file: string; start: number; end: number }
export function normalizeZonePath(path: string): string;
export function zonesOverlap(a: Zone, b: Zone): boolean;            // AC-12
export function expectationZone(e: EvalExpectation): Zone;
export function findingZone(f: Finding): Zone;
export function matchesAny(z: Zone, expectations: EvalExpectation[]): boolean;
export interface CaseScore {
  passed: boolean;
  expectedCount: number;    // AC-20 expected
  matchedCount: number;     // AC-20 obtained
  truePositives: number;    // AC-16 numerator
  groundedCount: number;
  rawCount: number;
}
export function scoreCase(
  expectations: EvalExpectation[], grounded: Finding[], rawCount: number,
): CaseScore;                                                        // AC-13, AC-14, AC-20
export interface RunCaseInput {
  polarity: EvalExpectationKind;
  errored: boolean;
  score: CaseScore | null;   // null when the case errored
}
export interface RunMetrics {
  recall: number; precision: number; citation_accuracy: number;
  passed: number; total: number;
}
export function aggregate(cases: RunCaseInput[]): RunMetrics;        // AC-15..AC-18
```

### Module surface — `server/src/modules/evals/helpers.ts` (pure, ring 2)

```ts
export function polarityOf(expectations: EvalExpectation[]): EvalExpectationKind;
export function validateExpectations(e: EvalExpectation[]): void;    // throws ValidationError (AC-9)
export function resolveExpectations(                                 // AC-8 + AC-9
  stored: EvalExpectation[] | null,
  incoming: EvalExpectation[] | undefined,
): EvalExpectation[];
export function seedExpectationFrom(finding: FindingRow): EvalExpectation;  // AC-3
export function buildEvalReviewInput(args: {                         // AC-11
  systemPrompt: string; model: string; strategy: ReviewStrategy;
  diff: UnifiedDiff; llm: LLMProvider;
  skills: string[]; specs: { path: string; text: string }[];
  sessionId?: string;
}): ReviewInput;
export function caseRowToDto(row: EvalCaseRow, repoFullName: string | null,
  lastOutcome: EvalPerTrace | null): EvalCase;
/** AC-49: a case with no repository association resolves NO context, and the
 *  resolver is not called at all. `resolve` is injected so this stays pure. */
export function contextInputFor(
  caseRepoId: string | null,
  resolve: (repoId: string) => Promise<AssembledRunContext>,
): Promise<AssembledRunContext>;
```

`resolveExpectations` is the whole of AC-8 and the server half of AC-9:

| `stored` polarity | `incoming` | result |
|---|---|---|
| any | `undefined` | keep `stored` |
| `must_not_flag` | `[]` | keep `stored` — **AC-8** |
| `must_find` / new case | `[]` | `ValidationError` — **AC-9** |
| any | non-empty, mixed kinds | `ValidationError` — **AC-9** |
| any | non-empty, one kind, each with file + start + end | replace |

`buildEvalReviewInput` sets **only** `systemPrompt`, `model`, `strategy`,
`diff`, `llm`, `skills` (when non-empty), `specs` (when non-empty) and
`sessionId`. It sets **no** `callers`, `repoMap`, `prDescription`, `intent`,
`task`, `memory` — that absence is AC-11, and it is asserted on the returned
object's own keys. `sessionId` is exempt because `run.ts:187-194` forwards it
to `completeStructured`, never to `assemblePrompt`, so it is not prompt
content. `task` is omitted rather than synthesised: `prompt.ts:164` is
`if (parts.task) userSections.push(parts.task)`, so absence is clean.

### HTTP surface (this phase)

```
GET    /agents/:id/eval-cases         → EvalCase[]
POST   /agents/:id/eval-cases         → EvalCase        (AC-47)
PUT    /eval-cases/:id                → EvalCase        (AC-8, AC-9)
DELETE /eval-cases/:id                → 204
GET    /findings/:id/eval-case-seed   → EvalCaseSeed    (AC-3, AC-4)
POST   /findings/:id/eval-case        → EvalCase        (AC-5, AC-46)
```

`POST /findings/:id/eval-case` accepts `{ name, input_diff?, expectations?,
notes? }` and derives `agent_id` from `review.agentId` and `repo_id` from
`pull.repoId` — **neither is readable from the body**. No route in this phase
declares a `config.rateLimit` (constraint 15).

## Tasks

### Step 0 — freeze the contract (must land before either track forks)

- [ ] T1 Add `EvalExpectationKind`, `EvalExpectation`, `EvalCaseOrigin`, `EvalRunState`, `EvalCaseStatus`, `EvalContextDocument`, `EvalContextExclusion`, `EvalCapturedContext` exactly as in Step 0; add `import { Finding } from './findings.js'` — `server/src/vendor/shared/contracts/knowledge.ts`, `client/src/vendor/shared/contracts/knowledge.ts` — owner: `implementer` — skill: `zod` — → AC-12 → `eval_contracts_parse`
- [ ] T2 Reshape `EvalPerTrace`, `EvalRun` and `EvalCase` in place per Step 0; leave `EvalOwnerKind` untouched — same two `knowledge.ts` files — owner: `implementer` — skill: `zod` — → AC-18 → `eval_contracts_parse`
- [ ] T3 Reshape `EvalCaseInput`, `EvalRunRecord`, `EvalRunResult`, `EvalDashboard`; add `EvalCaseUpdate`, `EvalMetricDelta`, `EvalDashboardEntry`, `EvalCaseSeed`; leave `EvalTrendPoint` in place and unreferenced — `server/src/vendor/shared/contracts/eval-ci.ts`, `client/src/vendor/shared/contracts/eval-ci.ts` — owner: `implementer` — skill: `zod` — → AC-47 → `eval_contracts_parse`
- [ ] T4 Add `EvalPromptDiffLine`, `EvalComparisonMetric`, `EvalComparison` (Phase B/C fill and render them; declared here so the contract is frozen once) — same two `eval-ci.ts` files — owner: `implementer` — skill: `zod` — → AC-40 → `eval_contracts_parse`

### Track A — server implementation (files disjoint from Track B)

- [ ] T5 **Migration pass 1, drop-only.** Delete `evalRuns` from `server/src/db/schema/eval.ts`; remove it from the import list (line 37) and the `schema` object (line 76) of `server/src/db/schema.ts`; run `pnpm db:generate` and commit the generated DROP migration **with no other schema change in the working tree** (constraint 2) — `server/src/db/schema/eval.ts`, `server/src/db/schema.ts`, `server/src/db/migrations/**` — owner: `implementer` — skill: `drizzle-orm-patterns` — → AC-18 → `eval_case_crud_it`
- [ ] T6 Extend `evalCases`: `repoId uuid` → `repos.id` `ON DELETE SET NULL` (nullable), `originFindingId uuid` → `findings.id` `ON DELETE SET NULL`, `originPrId uuid` → `pull_requests.id` `ON DELETE SET NULL`, `inputDiff` → `.notNull().default('')`, `expectedOutput` → `.notNull().default('[]')`, `createdAt`/`updatedAt` `timestamptz notNull default now()`; index `(ownerId)` and `(workspaceId)`; leave `inputFiles`/`inputMeta` untouched — `server/src/db/schema/eval.ts` — owner: `implementer` — skill: `postgresql-table-design` — → AC-46 → `eval_case_crud_it`
- [ ] T7 **Migration pass 2, create-only.** Add `evalSuiteRuns` and `evalCaseResults` per Step 0's persistence notes below; register both in `server/src/db/schema.ts` (import line + `schema` object); run `pnpm db:generate` a second time and commit — `server/src/db/schema/eval.ts`, `server/src/db/schema.ts`, `server/src/db/migrations/**` — owner: `implementer` — skill: `postgresql-table-design` — → AC-18 → `eval_case_crud_it`
- [ ] T8 `EvalCaseRepository`: `listForAgent`, `getById`, `create`, `update`, `delete`, all workspace-scoped, ordering by `created_at ASC, id ASC` (a unique final tiebreaker — `server/insights.md` 2026-08-04) — `server/src/modules/evals/repository/case.repo.ts` — owner: `implementer` — skill: `drizzle-orm-patterns` — → AC-47 → `eval_case_crud_it`
- [ ] T9 `EvalRunRepository` skeleton — `createRun`, `insertCaseResults`, `getRun`, `listRunsForAgent`, `latestCompletedRun`, `activeRunForAgent`; **method bodies only, no caller in this phase** (Phase B wires them) — `server/src/modules/evals/repository/run.repo.ts` — owner: `implementer` — skill: `drizzle-orm-patterns` — → AC-18 → `eval_case_crud_it`
- [ ] T10 `EvalRepository` composing facade over the two files, mirroring `modules/reviews/repository.ts` — `server/src/modules/evals/repository/index.ts` — owner: `implementer` — skill: `drizzle-orm-patterns` — → AC-47 → `eval_case_crud_it`
- [ ] T11 `scoring.ts` exactly per the Step 0 surface. Zero runtime imports; type-only imports from `@devdigest/shared`. Path comparison is case-sensitive after stripping a leading `a/` or `b/` and normalising `\` to `/`. **No doc comment in this file may name a model provider, an SDK or `llm`** (constraint 16) — `server/src/modules/evals/scoring.ts` — owner: `implementer` — skill: `typescript-expert` — → AC-12, AC-13, AC-14, AC-15, AC-16, AC-17, AC-18, AC-19, AC-20 → `eval_scoring_unit`
- [ ] T12 `helpers.ts` exactly per the Step 0 surface — the `resolveExpectations` table, `buildEvalReviewInput`'s omission set, and `contextInputFor` (which must **not** call `resolve` when `caseRepoId` is `null`) — `server/src/modules/evals/helpers.ts` — owner: `implementer` — skill: `typescript-expert` — → AC-8, AC-9, AC-11, AC-49 → `eval_helpers_unit`
- [ ] T13 `EvalService` with **explicit deps** (`{ repo: EvalRepository; agents: AgentsRepository; repos: RepoRepository; reviews: ReviewRepository; container: Pick<Container,'git'|'config'> }` — see decision 5 below): `listCases`, `createCase`, `updateCase`, `deleteCase`, `seedFromFinding`, `createFromFinding`. Every method takes `workspaceId` first and enforces it on **every** branch, including early returns (`server/insights.md`, Codebase Patterns 2026-08-05) — `server/src/modules/evals/service.ts` — owner: `implementer` — skill: `onion-architecture` — → AC-3, AC-4, AC-5, AC-8, AC-9, AC-46, AC-47 → `eval_case_crud_it`
- [ ] T14 `routes.ts` — the six routes above, each with a zod `params`/`body` schema via `fastify-type-provider-zod`, none with `config.rateLimit` — `server/src/modules/evals/routes.ts`, `server/src/modules/evals/constants.ts` — owner: `implementer` — skill: `fastify-best-practices` — → AC-47 → `eval_case_crud_it`
- [ ] T15 Register `evals` in the module registry (one import + one entry) — `server/src/modules/index.ts` — owner: `implementer` — skill: `fastify-best-practices` — → AC-47 → `eval_case_crud_it`

### Track B — tests (files disjoint from Track A)

- [ ] T16 `eval_scoring_unit` — hermetic unit tests over `scoring.ts`: overlap at one shared line, adjacent-but-not-overlapping, different file, path forms (`a/src/x.ts`, `b/src/x.ts`, `src\x.ts`) resolving to one file, **case-sensitivity** (`src/X.ts` ≠ `src/x.ts`); positive-case pass/fail; negative-case pass/fail; a finding matching both a `must_find` and a `must_not_flag` expectation (not a true positive, fails the negative case); recall with no `must_find` case = 1; precision with zero grounded findings = 1; citation accuracy with zero raw = 1; passed/total counts; the AC-20 expected/obtained pair for both polarities; duplicate overlapping expectations both counted. Assert the module's import list contains no runtime import — `server/test/eval-scoring.test.ts` — owner: `test-writer` — skill: `typescript-expert` — → AC-12, AC-13, AC-14, AC-15, AC-16, AC-17, AC-18, AC-19, AC-20 → `eval_scoring_unit`
- [ ] T17 `eval_helpers_unit` — `resolveExpectations` across all five rows of the table (AC-8's keep-on-empty and AC-9's four rejections); `polarityOf`; `seedExpectationFrom` producing `must_find` for an accepted finding and `must_not_flag` for a dismissed one; and **AC-11**: assert `Object.keys(buildEvalReviewInput({...}))` contains none of `callers`, `repoMap`, `prDescription`, `intent`, `task`, `memory`, and that `specs`/`skills` are absent (not empty arrays) when the inputs are empty — `server/test/eval-helpers.test.ts` — owner: `test-writer` — skill: `typescript-expert` — → AC-8, AC-9, AC-11 → `eval_helpers_unit`
- [ ] T18 `eval_case_crud_it` — Postgres-backed integration test. Inject `secrets: new MockSecretsProvider()` in `appWith` overrides so no adapter can reach the network (`server/insights.md`, Recurring Errors 2026-08-05). Covers: `GET /findings/:id/eval-case-seed` on an **accepted** finding returns one `must_find` expectation carrying that finding's file and line range (**AC-3**) and an `input_diff` containing that file's hunks over that range (**AC-4**); the same on a **dismissed** finding returns `must_not_flag` (**AC-3**); `POST /findings/:id/eval-case` persists `owner_id = review.agent_id` **even when the body carries a different agent id** (**AC-5**) and `repo_id = pull.repo_id` (**AC-46**); `POST /agents/:id/eval-cases` persists the body's `repo_id` (**AC-47**); `PUT /eval-cases/:id` with `expectations: []` on a `must_not_flag` case leaves the stored expectations unchanged (**AC-8**) and the same request on a `must_find` case is rejected with the reason (**AC-9**); a finding from another workspace 404s on both finding routes. **No assertion anywhere on how many cases exist** — `server/test/eval-cases.it.test.ts` — owner: `test-writer` — skill: `drizzle-orm-patterns` — → AC-3, AC-4, AC-5, AC-8, AC-9, AC-46, AC-47 → `eval_case_crud_it`
- [ ] T19 `eval_contracts_parse` — parse a valid `EvalCase`, `EvalRun`, `EvalPerTrace`, `EvalCaseInput`, `EvalRunRecord`, `EvalDashboard`, `EvalCaseSeed` and `EvalComparison`; assert a mixed-kind `expectations` array and an out-of-range metric are rejected; and assert the **server and client copies of both contract files are byte-identical** for the eval blocks by importing both and comparing `JSON.stringify` of a shared fixture parsed through each — `server/test/eval-contracts.test.ts` — owner: `test-writer` — skill: `zod` — → AC-12, AC-18, AC-40, AC-47 → `eval_contracts_parse`
- [ ] T20 Update the existing `EvalRun` assertion to the session shape (it currently parses the per-case shape at line 146) — `server/test/contracts.test.ts` — owner: `test-writer` — skill: `zod` — → AC-18 → `eval_contracts_parse`
- [ ] T21 `eval_case_no_repo_unit` — **AC-49**: assert that the context input assembled for a case whose `repo_id` is `null` contains no project-context document, by calling the resolver seam directly with a null repo id and asserting `{ documents: [], excluded: [] }` and that `ContextService.assembleForRun` was **not** called (spy). The seam lives in `helpers.ts` as `contextInputFor(caseRepoId, resolve)`; T12 adds it — `server/test/eval-helpers.test.ts` — owner: `test-writer` — skill: `typescript-expert` — → AC-49 → `eval_helpers_unit`

### Integration

- [ ] T22 `pnpm db:migrate` against a local Postgres, then `pnpm typecheck` in **both** `server/` and `client/` (the client compiles the reshaped contracts too) and the full Fast loop; confirm `git diff --stat` shows exactly **two** generated migration files and that neither was hand-edited — owner: `implementer` — skill: `drizzle-orm-patterns` — → AC-18 → `eval_case_crud_it`
- [ ] T23 `diff server/src/vendor/shared/contracts/knowledge.ts client/src/vendor/shared/contracts/knowledge.ts` and the same for `eval-ci.ts`; every difference must be one that already existed before this phase (`client/insights.md` 2026-08-05: the copies are not wholly identical today) — no **new** divergence in an eval block — owner: `implementer` — skill: `zod` — → AC-47 → `eval_contracts_parse`

### Persistence detail for T7

```ts
export const evalSuiteRuns = pgTable('eval_suite_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  state: text('state', { enum: ['pending','running','completed','failed'] }).notNull().default('pending'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  systemPrompt: text('system_prompt').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  strategy: text('strategy').notNull(),
  skills: jsonb('skills').notNull().default(sql`'[]'::jsonb`),            // [{name, body}]
  capturedContext: jsonb('captured_context').notNull().default(sql`'{"documents":[],"excluded":[]}'::jsonb`),
  casesTotal: integer('cases_total').notNull().default(0),
  casesDone: integer('cases_done').notNull().default(0),
  passedCount: integer('passed_count').notNull().default(0),
  erroredCount: integer('errored_count').notNull().default(0),
  recall: doublePrecision('recall'),
  precision: doublePrecision('precision'),
  citationAccuracy: doublePrecision('citation_accuracy'),
  costUsd: doublePrecision('cost_usd'),
  durationMs: integer('duration_ms'),
}, (t) => ({
  agentStartedIdx: index('eval_suite_runs_agent_started_idx').on(t.agentId, t.startedAt),
  workspaceIdx: index('eval_suite_runs_workspace_idx').on(t.workspaceId),
  // AC-23 as a database invariant, not a check-then-insert race.
  oneActivePerAgent: uniqueIndex('eval_suite_runs_one_active_per_agent')
    .on(t.agentId).where(sql`${t.state} in ('pending','running')`),
}));

export const evalCaseResults = pgTable('eval_case_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => evalSuiteRuns.id, { onDelete: 'cascade' }),
  caseId: uuid('case_id').references(() => evalCases.id, { onDelete: 'set null' }),
  ordinal: integer('ordinal').notNull(),
  caseName: text('case_name').notNull(),
  caseRepoId: uuid('case_repo_id').references(() => repos.id, { onDelete: 'set null' }),
  caseInputDiff: text('case_input_diff').notNull(),
  caseExpectations: jsonb('case_expectations').notNull(),
  status: text('status', { enum: ['pending','passed','failed','errored'] }).notNull().default('pending'),
  error: text('error'),
  findings: jsonb('findings').notNull().default(sql`'[]'::jsonb`),
  rawFindingsCount: integer('raw_findings_count').notNull().default(0),
  expectedCount: integer('expected_count').notNull().default(0),
  matchedCount: integer('matched_count').notNull().default(0),
  costUsd: doublePrecision('cost_usd'),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  runOrdinalUq: uniqueIndex('eval_case_results_run_ordinal_uq').on(t.runId, t.ordinal),
  caseIdx: index('eval_case_results_case_idx').on(t.caseId),
}));
```

`case_name`, `case_input_diff`, `case_expectations` and `case_repo_id` are the
frozen copy AC-30 and the "Editing a case between two runs" edge case require.
`cost_usd` is nullable and never defaulted to `0`: "Cost not reported by the
model provider … presented as unavailable, never as zero".

### Decision 5 — why `EvalService` carries a narrow `Container` slice

`onion-architecture` says a new service takes explicit deps and never
`container: Container`. AC-4 needs `loadDiff`
(`modules/reviews/diff-loader.ts:12-30`), whose signature is
`(container, repo, workspaceId, pull, repoRow)` — it reads `container.git`.
The service therefore takes `container: Pick<Container, 'git' | 'config'>`,
which is the shorthand the skill explicitly permits ("`Pick<Container, …>` is
an acceptable shorthand … What is not acceptable is `container: Container`").
Do **not** widen it, and do **not** modify `diff-loader.ts`.

## Traceability

| AC | Tasks | Verified by |
|----|-------|-------------|
| AC-3 | T12, T13, T18 | `eval_case_crud_it` |
| AC-4 | T13, T18 | `eval_case_crud_it` |
| AC-5 | T13, T18 | `eval_case_crud_it` |
| AC-8 | T12, T13, T17, T18 | `eval_helpers_unit`, `eval_case_crud_it` |
| AC-9 | T12, T13, T17, T18 | `eval_helpers_unit`, `eval_case_crud_it` |
| AC-11 | T12, T17 | `eval_helpers_unit` |
| AC-12 | T1, T11, T16, T19 | `eval_scoring_unit` |
| AC-13 | T11, T16 | `eval_scoring_unit` |
| AC-14 | T11, T16 | `eval_scoring_unit` |
| AC-15 | T11, T16 | `eval_scoring_unit` |
| AC-16 | T11, T16 | `eval_scoring_unit` |
| AC-17 | T11, T16 | `eval_scoring_unit` |
| AC-18 | T2, T5, T7, T9, T11, T16, T20, T22 | `eval_scoring_unit`, `eval_contracts_parse` |
| AC-19 | T11, T16 | `eval_scoring_unit` |
| AC-20 | T11, T16 | `eval_scoring_unit` |
| AC-46 | T6, T13, T18 | `eval_case_crud_it` |
| AC-47 | T3, T8, T10, T13, T14, T15, T18, T23 | `eval_case_crud_it` |
| AC-49 | T12, T21 | `eval_helpers_unit` |

## Verification

### Fast loop (implementer / test-writer, after every step)

- `cd server && pnpm typecheck`
- `cd server && pnpm test:unit --reporter=dot`
- `cd client && pnpm typecheck` (the reshaped contracts compile there too)

### Full (plan-verifier, once at the end)

- `cd server && pnpm typecheck`
- `cd client && pnpm typecheck`
- `cd server && pnpm test:unit --reporter=dot`
- `cd client && pnpm test:unit --reporter=dot`
- `cd server && pnpm db:migrate` (Docker Postgres running)
- `cd server && pnpm test:integration --reporter=dot` — `eval-cases.it.test.ts`
  is DB-backed. If the full `.it.test` suite is flaky, re-run the single file
  before concluding a regression (`server/insights.md`, Open Questions
  2026-08-05).
- `git diff --name-only server/src/db/migrations` shows exactly two new `.sql`
  files plus their snapshots, and nothing under `migrations/` was hand-edited.
- No e2e in this phase: it adds **no** UI entry point. Phase C adds them and
  owns `./scripts/e2e.sh`.

## Explicit note

Architecture and security review are out of scope for `implementer` and are
handled by separate review agents/skills after implementation.

## Open questions / assumptions

- **AC-11 vs the spec's parity sentence.** "Untrusted inputs" says "An eval
  invocation and an ordinary review of the same diff differ only in where the
  diff came from", but an ordinary review always appends a task line
  (`run-executor.ts:232` — `taskLine(pull) + rankNote`), which needs a pull
  request an eval case does not have. AC-11's "SHALL contain nothing else"
  is treated as binding and `task` is omitted. `prompt.ts:164` handles
  absence, so the prompt is well-formed. Assumed, not asked.
- **`skills` capture granularity.** The spec says a run captures "linked
  skills"; it does not say names or bodies. The DB column stores
  `[{name, body}]` (bodies are needed to evaluate every case of the run from
  one capture) and the DTO exposes names only, to keep the API payload small.
  Assumed.
- **`EvalPerTrace` keeps its name** although the spec calls the shape a "case
  result". Renaming would remove a barrel export for no behavioural gain, and
  the user's instruction was to adapt the existing slots. The mapping is
  recorded in Step 0.
