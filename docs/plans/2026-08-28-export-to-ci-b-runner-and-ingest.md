# Development Plan: Export to CI — Phase B (the runner, and bringing results back)

Spec: docs/specs/cross/SPEC-05-export-to-ci.md
Date: 2026-08-28
Execution mode: single-agent (one ordered `/impl` pass)

Phase 2 of 3. Siblings:
`docs/plans/2026-08-28-export-to-ci-a-contracts-generation-install.md` (Phase A,
**must be green before this file starts**),
`docs/plans/2026-08-28-export-to-ci-c-client-surfaces.md` (Phase C).

Run this plan with **`/impl-sec`**, not `/impl`. It adds a new API surface, it
parses an archive a repository collaborator can influence, and it changes code
that executes inside someone else's CI with that repository's credentials.

Design refs: none. This phase has no UI; the two screens that render what it
records are Phase C's.

## Goal

Make a CI run explainable and retrievable. On the runner side: end a fork pull
request with a passing check and a stated reason instead of a credential
failure, honour the publication mode the export chose, and write a result that
names the repository, the commit, the pull request, the verdict, the manifest
version, the model and the runner build. On the studio side: add the two
GitHub-port methods a pull-based refresh needs, verify every retrieved result
against the workflow run it came from before storing any part of it, record the
run against its installation and its agent, and record the same run in the
`agent_runs` history marked as having originated in CI.

## Out of scope

- Every client surface. CI Runs, the agent's CI view and the wizard are
  **Phase C**; this phase only produces the data and the read endpoints.
- Any change to `reviewer-core/`. The review pipeline, the grounding gate,
  `wrapUntrusted`/`INJECTION_GUARD`, `toReviewPayload`, `countBlockers` and
  `gateTriggered` are **consumed unchanged**. `agent-runner/CLAUDE.md`, "Do Not
  Touch Without Reading" and its invariant list are binding: if a change here
  seemed to require bypassing the grounding gate or hand-rolling the wrap, it
  would be a spec discussion, not a workaround.
- Replacing `process.env` reads in `agent-runner/` with a `SecretsProvider`.
  `agent-runner/CLAUDE.md`, "Why This Package Intentionally Breaks the
  `SecretsProvider` Rule" — the chokepoint is scoped to `server/` and there is
  nothing on the other end of that abstraction inside someone else's CI. **Do
  not "fix" it.**
- Any inbound endpoint, tunnel or callback for CI to push a result to. AC-14
  exists to forbid exactly that.
- Paging, cursors, time windows, background polling or scheduled retrieval. A
  refresh looks at a fixed small number of the newest runs per installation and
  stops.
- Re-running a CI review from the studio, editing a CI run, or turning a CI
  finding into anything else.
- Surfacing a CI run on any pull-request page. `modules/pulls/**` is not
  edited, and `modules/reviews/**` is edited in **exactly one file, for one
  predicate** — see the exception below.
- **Exception, deliberate and scoped:**
  `server/src/modules/reviews/repository/run.repo.ts` gains a `source =
  'local'` predicate on `runStatsByAgent` (T19). Nothing else in
  `modules/reviews/**` is touched — not `service.ts`, not `routes.ts`, not
  `run-executor.ts`, not any other function in that same file. The reason it
  cannot stay out of scope: AC-24 writes the first `agent_runs` row this
  repository has ever seen with `source: 'ci'`, and `runStatsByAgent`
  (`run.repo.ts:23-38`) filters only on `workspaceId` and `agent_id is not
  null`, so the agent cards' "N runs / $avg" would silently absorb CI runs the
  user never ran. The user decided on 2026-08-28 that the cards keep meaning
  exactly what they meant before, and that the spec's "nor a CI review
  presented as something the user ran" holds literally.
- Storing finding text from a CI run. The result record carries counts only, by
  contract.
- Changing the generated workflow. Phase A already emits the artifact-upload
  step; this phase changes no generator.

## Constraints

Every claim below was read in this session at the line given.

1. **The runner resolves the fork flag but never acts on it.**
   `agent-runner/src/context.ts:30-32` documents `isFork` as "informational
   only", `:92` sets it, and `grep isFork agent-runner/src` finds no other
   consumer — `run.ts:83-173` has no fork branch. Today a fork pull request
   reaches `run.ts:100-102`, which throws when `GITHUB_TOKEN` cannot post, or
   reaches the model call with an empty `OPENROUTER_API_KEY`
   (`agent-runner/src/index.ts:39`); either way the hard-fail path at
   `run.ts:167-172` returns `exitCode: 1` with **no artifact**, i.e. a red check
   and a credential error. That is precisely what AC-12 forbids.
2. **The fork branch must come before the token check.** `run.ts:99-102` is the
   first statement after `resolvePrContext`; inserting the fork branch *after*
   it would still hard-fail a fork run configured to post.
3. **`PrContext` carries no commit sha.** `agent-runner/src/context.ts:22-33`
   has `owner`, `repo`, `prNumber`, `title`, `body`, `isFork` and nothing else,
   although `:36-42` already types the `pull_request` event payload it parses.
   AC-15's commit check needs one.
4. **The publication mode never reaches the runner today.**
   `agent-runner/src/index.ts:25-33` resolves it from an optional
   `DEVDIGEST_POST_AS` env var and falls back to `'github_review'`;
   `agent-runner/insights/INSIGHTS.md`, Open Questions 2026-07-08 records this
   as an unclosed cross-track gap. Phase A closed it in the contract by adding
   `AgentManifest.post_as`; this phase closes it in the runner.
5. **The deterministic verdict already exists as `payload.event`.**
   `run.ts:132-138` computes `toReviewPayload(outcome.review, { failOn:
   manifest.ci_fail_on, … })` plus `countBlockers`/`gateTriggered` over the
   **grounded** findings and discards `outcome.review.verdict` on purpose. The
   `APPROVE → COMMENT` downgrade at `agent-runner/src/github.ts:70` is local to
   the POST body and does not mutate `payload`, so `payload.event` is the true
   deterministic verdict to record.
6. **`CiResultArtifact` is `safeParse`d on write already.**
   `agent-runner/src/artifact.ts:45-52` validates the object it just built
   against the same contract the studio will parse on the way back in. Adding
   required fields therefore fails loudly in the runner's own tests rather than
   silently at ingest.
7. **`artifact.version` currently means the runner build.**
   `agent-runner/src/artifact.ts:6` `RUNNER_VERSION = '1'`, assigned to
   `version` at `:42`; the contract field is `version: z.string().nullish()`
   (`contracts/eval-ci.ts:296`). The spec asks for a *manifest* version, a
   *model* and a *runner build* as three separate things, so `version` is
   replaced by `runner_build` — a rename inside a contract with exactly two
   consumers (`artifact.ts`, and this phase's ingest), and **no persisted
   artifact exists anywhere** to be broken by it (constraint 8).
8. **Nothing has ever been recorded.** `grep -rn
   "ciInstallations|ciRuns|ci_installations|ci_runs"` over the repo (excluding
   `server/clones/**`) returns only `schema/ci.ts`, `schema.ts:44,86-87`,
   `migrations/0000_init.sql:49,57,367,368`, the snapshots, and contract doc
   comments — plus, after Phase A, that phase's own module. There is no stored
   `ci_runs` row and no artifact in any repository, so a `NOT NULL` column add
   needs no backfill and a contract rename breaks no reader.
9. **`GitHubClient` has no workflow-run listing and no artifact download.**
   `server/src/vendor/shared/adapters.ts:143-167` — the interface ends at
   `currentLogin()`. Adding a port method means the interface, the octokit
   adapter (`server/src/adapters/github/octokit.ts`) and the mock
   (`server/src/adapters/mocks.ts:132-233`) change **together**
   (`onion-architecture`, "Ports: when to add one", steps 1, 2 and 4).
10. **The client's `vendor/shared/adapters.ts` is not a mirror and must not be
    synced here.** `client/insights.md`, Codebase Patterns 2026-08-05: the
    client copy is already missing `GitHubClient.commitFiles`/`findOpenPr`,
    "presumably because the client only ever needed a subset historically", and
    the advice is to diff only the block being added. The client never
    constructs a `GitHubClient`, so the two new methods go into the **server
    copy only**.
11. **`fflate` is already a server dependency and its `unzipSync({ filter })`
    runs against the central directory before decompression.**
    `server/package.json:33`; `server/insights.md`, Tool & Library Notes
    2026-08-04 — the filter receives `{ name, size, originalSize, compression }`
    and returning `false` means those bytes are never inflated, with the caveat
    that `originalSize` is attacker-controlled and the decompressed length must
    be re-checked afterwards. `modules/skills/import.ts` is the in-repo
    precedent for an untrusted-archive policy.
12. **`agent_runs.source` is already `'local' | 'ci'`, defaulting to
    `'local'`** — `server/src/db/schema/runs.ts:25`. `pr_id` (`:14`) and
    `agent_id` (`:13`) are both nullable with `ON DELETE set null`, so a CI run
    for a pull request the studio never imported records cleanly.
13. **The only existing `agent_runs` writer hardcodes the local shape.**
    `modules/reviews/repository/run.repo.ts:160-184` `createAgentRun` requires
    `prId: string` and sets `source: 'local'` literally at `:180`. It cannot be
    reused for a CI run, and `modules/reviews/**` is out of scope, so the CI
    module owns its own insert — see Entry points.
14. **`runStatsByAgent` counts every run of an agent with no `source` filter.**
    `modules/reviews/repository/run.repo.ts:23-38` — `count(*)::int` and
    `avg(cost_usd)` over `agent_runs`, with a `where` at `:36` carrying only
    `eq(workspaceId)` and `agent_id is not null`. There is no `source`
    predicate anywhere in the function. The spec's Contracts section says a CI
    review must never be "presented as something the user ran", so **T19 adds
    that predicate** (user decision, 2026-08-28).
    **The function's doc comment asserts the opposite of what T19 makes true**:
    `run.repo.ts:18` reads "`runCount` counts every run (that is what 'N runs'
    means on the card)". Once the predicate lands that sentence is false, and a
    comment contradicting the code beside it is worse than no comment — **T19
    rewrites it in the same edit**. The rest of that block (`:19-21`, on
    `avg()` ignoring NULL costs) stays accurate and is left alone.
15. **`drizzle-kit generate` hangs on a same-table diff that both removes and
    adds columns** — `server/insights.md`, Tool & Library Notes 2026-08-04.
    This phase's migration is **ADD-only plus two `SET NOT NULL`s on empty
    columns**: nothing is renamed and nothing is dropped, so `github_url` and
    `status` keep their names even though `job_url` and a split status would
    read better.
16. **Migrations are generated, never hand-written, and not applied on boot** —
    `server/CLAUDE.md`, Do-not-touch and Gotchas.
17. **A `.default()` on a persisted contract is a claim about a read path.**
    `server/insights.md`, Recurring Errors 2026-08-17 — `getRunTrace` cast
    instead of parsing, so every `.default()` on `RunTrace` was decorative and
    legacy documents came back missing keys. Every `.default()` added here is
    on `CiResultArtifact`, which **is** parsed on both ends
    (`artifact.ts:45`, and this phase's `verifyResult`).
18. **`agent-runner` typecheck needs `reviewer-core`'s own `node_modules`.**
    `agent-runner/insights/INSIGHTS.md`, What Doesn't Work 2026-07-08: this is
    not a monorepo, so `moduleResolution: "Bundler"` never reaches
    `agent-runner/node_modules` from `reviewer-core/src/llm/*.ts`. Run `cd
    reviewer-core && pnpm install` once before `cd agent-runner && pnpm
    typecheck`.
19. **A discriminated union in the runner must be narrowed on `artifact ===
    null`, not on `error`** — `agent-runner/insights/INSIGHTS.md`, Recurring
    Errors 2026-07-08. The fork branch returns a `RunCiSuccess`, so it must
    carry a non-null `artifact`, a `posted` and both gate fields.
20. **Every read and write is workspace-scoped**, on every branch including
    early returns — spec NFR; `security` A01; `server/insights.md`, Codebase
    Patterns 2026-08-05.
21. **Handoff-sized task bullets** — `/impl` copies task lines verbatim into
    spawn prompts. Prefer `file:line` references over pasted schema or code
    blocks; if a single task bullet would exceed ~2 KB, point at the frozen
    surface below instead of embedding it.

## Placement decisions

Each traces to a preloaded skill's rule, not to preference.

- **Two new methods on `GitHubClient`, described in domain vocabulary.**
  `onion-architecture`, "Ports: when to add one" — the capability is "the latest
  runs of a named workflow" and "the result file attached to a run", not
  "octokit's `listWorkflowRuns`". `octokit` and `fflate` imports stay inside
  `adapters/github/octokit.ts`; the service never learns that an artifact is a
  zip.
- **Unzipping happens in the adapter, not the service.**
  `onion-architecture`'s import table: `fflate` is a technology, and a service
  that imports it has put archive handling in the core. The port returns the
  entry's text or `null`.
- **`verifyResult` is a pure function in `modules/ci/ingest.ts`, taking the
  parsed run facts and the raw artifact text.** `onion-architecture`, "What
  crosses each boundary": pure transforms belong in ring 2 and must be callable
  with no database and no network. AC-15 is the criterion the spec marks
  "server integration", but its rule is a pure decision and gets its own unit
  test as well — a rejected result must be provable without a container.
- **The CI module owns its `agent_runs` insert.** A repository is a ring-3
  driven adapter and may touch any table; ownership by module is a convention.
  Reusing `createAgentRun` is impossible on its own terms — it requires a
  `pr_id` a CI run does not have and hardcodes `source: 'local'` at
  `run.repo.ts:180` (constraint 13) — so widening it would mean changing the
  local review path's own writer to serve a case it has no data for. That
  remains true even though T19 now edits one other function in that same file:
  the exception granted there is a single read predicate, not a licence to
  reshape the local run writer. The duplication is recorded in Entry points so
  the next reader finds both writers.
- **`ci_runs` gains `workspace_id NOT NULL`** rather than being scoped through
  its installation at query time — `server/src/db/schema.ts:4-7`'s repo-wide
  tenancy rule and `postgresql-table-design`'s NOT NULL guidance. Constraint 8
  makes the non-null add free.
- **`unique (ci_installation_id, provider_run_id)`.**
  `postgresql-table-design`, "UNIQUE" and "Upsert-Friendly Design" — the
  conflict target `ON CONFLICT` needs an exact matching unique index. This is
  what makes "refreshing repeatedly does not multiply runs" a database
  invariant rather than a check-then-insert race between two refresh clicks.
- **`status` and `verdict` are separate columns.** The spec: the single status
  field today "conflates 'the job finished' with 'the review found nothing'".
  `postgresql-table-design`, "Enums": both are business-logic-driven evolving
  sets, so `TEXT` plus the contract's `z.enum`, not a Postgres enum type.
- **`verdict`, `findings_count` and the three severity counts are nullable.**
  An unfinished or unavailable run has no verdict and no counts, and the spec is
  explicit that a zero-finding review and a review that never happened must not
  look alike. `null` is the only value that says "absent" rather than "zero"
  (`client/insights.md`, What Doesn't Work 2026-07-30).
- **A rejected result creates no row.** AC-15. It is reported in the refresh
  response instead, per the edge case "the refresh states that a result was
  rejected and for which workflow run".
- **An unfinished run *does* create a row**, in `in_progress`, so the edge case
  "presented as in progress, with no verdict and no counts" has something to
  present. The skip-before-fetch rule therefore applies to **terminal** rows
  only; an `in_progress` row is re-examined on the next refresh.
- **Size caps and an entry allowlist before decompression.** `security` A08
  (unvalidated uploads) and A05; `server/insights.md`, Tool & Library Notes
  2026-08-04 on `unzipSync({ filter })` and the attacker-controlled
  `originalSize`. The archive comes from a workflow run in a repository whose
  collaborators can upload an artifact of that name.
- **Refresh carries a route-level rate limit**, the two read routes do not.
  `security` A06 — one click fans out to `installations × (1 + 20)` GitHub
  calls. Precedent: `modules/reviews/routes.ts:29`.

## Entry points & duplicate registries

- **`server/src/vendor/shared/adapters.ts` → `adapters/github/octokit.ts` →
  `adapters/mocks.ts`** — three files enumerate `GitHubClient`'s methods and all
  three must change together or the build breaks (the mock `implements
  GitHubClient`). Covered by **T5, T6, T7**.
- **`client/src/vendor/shared/adapters.ts`** — checked: deliberately **not**
  updated. It already omits `commitFiles`/`findOpenPr` (constraint 10) and the
  client constructs no `GitHubClient`. Recorded so a later "sync the vendor
  copies" pass does not read the omission as an oversight.
- **`server/src/db/schema.ts`** — checked: `ciRuns` is already imported (line
  44) and already in the `schema` object (line 87). This phase adds columns
  only, so **neither list changes**.
- **`server/src/modules/index.ts`** — checked: Phase A already registered `ci`.
  This phase adds routes to the existing plugin, so **the registry does not
  change**.
- **`agent_runs` now has two writers** — `modules/reviews/repository/run.repo.ts:160-184`
  (`createAgentRun`, local runs, `source:'local'` hardcoded at `:180`) and this
  phase's `CiRepository.insertCiAgentRun` (`source:'ci'`). Not collapsible:
  the local writer requires a `pr_id` a CI run does not have.
  `server/insights.md`, Codebase Patterns 2026-08-05 warns that a second write
  path to one table is how duplication goes unnoticed — it is named here on
  purpose, and **T16 asserts the CI writer sets `source: 'ci'` and leaves
  `pr_id` null**.
- **`agent_runs` now also has two *readers* that mean different things** —
  `runStatsByAgent` (`run.repo.ts:23-38`, the agent cards' "N runs / $avg",
  which T19 narrows to `source = 'local'`) and this phase's CI run list (which
  reads `ci_runs`, not `agent_runs`, and so is unaffected). Every **other**
  consumer of `agent_runs` was checked: `modules/pulls/routes.ts:136,139`
  joins `agent_runs` **from `reviews`** on `reviews.run_id`, and a CI run
  creates no `reviews` row, so a PR page can never pick one up — which is what
  keeps the spec's "the studio's pull-request pages are untouched" true
  structurally rather than by convention. `db/seed.ts:434-449` inserts one run
  with an explicit `source: 'local'` (`:449`), so the seeded fixture's run count
  survives T19 unchanged and no existing test's expected number moves.
- `grep -rn "runStatsByAgent" server/src` — **checked**, exactly three hits
  besides the declaration at `run.repo.ts:23`: the composing facade at
  `modules/reviews/repository.ts:109-110`, and its single consumer,
  `modules/agents/service.ts:77`. One definition, one predicate to change;
  nothing else computes this rollup, so T19 cannot leave a second copy stale.
- **`server/src/modules/ci/constants.ts`** — `WORKFLOW_FILE` and
  `RESULT_ARTIFACT_NAME`/`RESULT_FILE` are set by Phase A's generator and
  **read** by this phase's refresh. One definition, two consumers; do not
  re-declare either string in the ingest code.
- `grep -rn "CiResultArtifact" server/src client/src agent-runner/src` —
  **checked**: `agent-runner/src/artifact.ts:2,32,45`, `agent-runner/src/run.ts:2`,
  the two contract copies, and (after this phase) `modules/ci/ingest.ts`.
  Nothing else parses or builds it.
- `grep -rn "source.*'ci'\|source === \"ci\"" server/src client/src` —
  **checked, nothing today**: `agent_runs.source` has an unused `'ci'` member
  (`schema/runs.ts:25`) and no reader distinguishes the two values yet. T14
  becomes the first.

## Affected modules & files

- **shared contracts (× 2 copies)**:
  `server/src/vendor/shared/contracts/eval-ci.ts`,
  `client/src/vendor/shared/contracts/eval-ci.ts`
- **shared adapters (server copy only)**:
  `server/src/vendor/shared/adapters.ts`
- **server adapters**: `server/src/adapters/github/octokit.ts`,
  `server/src/adapters/mocks.ts`
- **server schema**: `server/src/db/schema/ci.ts`,
  `server/src/db/migrations/**` (generated only)
- **server module**: `server/src/modules/ci/constants.ts`,
  `ingest.ts` (new), `repository.ts`, `service.ts`, `routes.ts`
- **server, scoped exception**:
  `server/src/modules/reviews/repository/run.repo.ts` — `runStatsByAgent` only
  (one predicate plus its doc comment, T19). No other file under
  `modules/reviews/**` is edited.
- **agent-runner**: `agent-runner/src/context.ts`, `artifact.ts`, `run.ts`,
  `index.ts`
- **server tests (new/extended)**: `server/test/ci-contracts.test.ts`
  (extended), `server/test/ci-ingest.test.ts` (new),
  `server/test/ci-ingest.it.test.ts` (new)
- **agent-runner tests (extended)**: `agent-runner/src/run.test.ts`

## Frozen surface

Phase C codes against exactly this.

### Contracts — `contracts/eval-ci.ts` (both copies)

```ts
// RESHAPED (eval-ci.ts:266) — the observable states of a run the studio holds.
// `rejected` is NOT a member: a rejected result records nothing (AC-15) and is
// reported on the refresh response instead.
export const CiRunStatus = z.enum(['in_progress', 'recorded', 'unavailable']);

// RESHAPED (eval-ci.ts:289-299) — what the runner attaches to its workflow run.
// Carries no secret, no finding text (AC-13).
export const CiResultArtifact = z.object({
  schema_version: z.number().int().positive().default(1),
  repo: z.string().min(1),            // "owner/name"                (AC-15)
  head_sha: z.string().min(1),        // pull_request.head.sha       (AC-15, US-8)
  workflow_sha: z.string().min(1),    // process.env.GITHUB_SHA      (see Open questions)
  pr_number: z.number().int().positive(),                          // (AC-15)
  agent: z.string().min(1),
  manifest_version: z.number().int().positive(),                   // (US-8)
  model: z.string().min(1),                                        // (US-8)
  runner_build: z.string().min(1),    // replaces `version`         (US-8)
  verdict: CiVerdict,                                              // (AC-16, AC-23)
  /** Non-null only when `verdict === 'skipped'` — AC-12's stated reason. */
  skip_reason: z.string().nullable(),
  findings_count: z.number().int(),
  critical: z.number().int(),
  warning: z.number().int(),
  suggestion: z.number().int(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
});

// RESHAPED (eval-ci.ts:270-282).
export const CiRun = z.object({
  id: z.string(),
  ci_installation_id: z.string().nullable(),
  agent_id: z.string().nullable(),
  agent_name: z.string().nullable(),
  repo: z.string(),
  pr_number: z.number().int().nullable(),
  head_sha: z.string().nullable(),
  status: CiRunStatus,
  verdict: CiVerdict.nullable(),
  unavailable_reason: z.string().nullable(),
  findings_count: z.number().int().nullable(),
  critical: z.number().int().nullable(),
  warning: z.number().int().nullable(),
  suggestion: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
  ran_at: z.string().nullable(),
  job_url: z.string(),                 // AC-16 "the location of the job"
  model: z.string().nullable(),
  manifest_version: z.number().int().nullable(),
  runner_build: z.string().nullable(),
});

export const CiRefreshRejection = z.object({
  job_url: z.string(),
  reason: z.string(),
});

/** Response of `POST /ci/refresh`. */
export const CiRefreshResult = z.object({
  runs: z.array(CiRun),
  recorded: z.number().int(),
  skipped_existing: z.number().int(),
  rejected: z.array(CiRefreshRejection),
  installations_checked: z.number().int(),
});
```

### Port additions — `server/src/vendor/shared/adapters.ts` (server copy only)

```ts
/** One run of a workflow, as the code-hosting platform reports it. */
export interface CiWorkflowRunRef {
  /** The platform's own run id, as a string. */
  id: string;
  runNumber: number;
  /** The commit the run reviewed, as the platform records it. */
  headSha: string;
  finished: boolean;
  conclusion: string | null;
  /** Where a human reads the job. */
  htmlUrl: string;
  createdAt: string;
  /** Pull requests the platform associates with the run; may be empty. */
  prNumbers: number[];
}

// added to GitHubClient:
  /** The `limit` most recent runs of `workflowFile`, newest first. `[]` when
   *  the workflow is unknown to the repository. */
  listWorkflowRuns(repo: RepoRef, workflowFile: string, limit: number): Promise<CiWorkflowRunRef[]>;
  /** The text of `entryName` inside the run's `artifactName` attachment, or
   *  `null` when the run has no such attachment or it holds no such entry. */
  downloadRunArtifactEntry(
    repo: RepoRef, runId: string, artifactName: string, entryName: string,
  ): Promise<string | null>;
```

### Module surface — `server/src/modules/ci/ingest.ts` (pure, ring 2)

```ts
export interface WorkflowRunFacts {
  repo: string;        // "owner/name" of the repository the run belongs to
  headSha: string;
  prNumbers: number[];
  jobUrl: string;
}
export type VerifyResult =
  | { ok: true; artifact: CiResultArtifact }
  | { ok: false; reason: string };

/** AC-15. Pure: no database, no network, never throws. */
export function verifyResult(rawText: string, run: WorkflowRunFacts): VerifyResult;

/** payload.event → CiVerdict. Deterministic; never the model's self-report. */
export function verdictFromEvent(event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'): CiVerdict;
```

`verifyResult` rejects, with a reason naming the mismatch, when: the text is not
JSON; `CiResultArtifact.safeParse` fails; `artifact.repo` differs from
`run.repo` (compared case-insensitively — GitHub repository names are); neither
`artifact.head_sha` nor `artifact.workflow_sha` equals `run.headSha`; or
`run.prNumbers` is non-empty and does not contain `artifact.pr_number`. When
the platform reports no pull request for the run, the pull-request check is
vacuous — a result is rejected only when it *names* something other than what
the run says, and a run that says nothing contradicts nothing.

### New constants — `server/src/modules/ci/constants.ts`

```ts
/** Per installation, per refresh. Fixed and small: no paging, no cursor. */
export const REFRESH_RUN_LIMIT = 20;
/** Hard caps on the attacker-influenceable archive. */
export const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
export const MAX_RESULT_BYTES = 256 * 1024;
```

### HTTP surface (this phase)

```
POST /ci/refresh              → CiRefreshResult   (AC-14, AC-15, AC-24)
GET  /ci/runs                 → CiRun[]           (AC-16)
GET  /agents/:id/ci-runs      → CiRun[]           (AC-23)
```

Only `refresh` declares `config: { rateLimit: { max: 5, timeWindow: '1 minute' } }`.
Both reads are workspace-scoped and ordered `ran_at DESC NULLS LAST, id DESC`
(a unique final tiebreaker — `server/insights.md`, Recurring Errors 2026-08-04).

### Refresh sequence (service, ring 2)

Per installation of the requesting workspace, newest workflow run first:

1. `listWorkflowRuns(repoRef, WORKFLOW_FILE, REFRESH_RUN_LIMIT)`.
2. Load the provider run ids already stored **in a terminal status**
   (`recorded` or `unavailable`) for that installation; skip those runs
   **before fetching anything** and count them into `skipped_existing`.
3. A run that has not finished → upsert an `in_progress` row (no verdict, no
   counts) and continue.
4. Otherwise `downloadRunArtifactEntry(...)`. `null` → upsert an `unavailable`
   row carrying the reason and the job url, never a row with zero findings.
5. `verifyResult(text, facts)`. Not ok → push `{ job_url, reason }` onto
   `rejected` and **record nothing** (AC-15).
6. Ok → insert an `agent_runs` row with `source: 'ci'`, `pr_id: null` (AC-24),
   then upsert the `ci_runs` row in `recorded` with the verdict, the counts, the
   cost, the duration, the commit, the model, the manifest version, the runner
   build and the new `agent_run_id`.

### Runner changes

- `context.ts` — `PrContext` gains `headSha: string`, read from
  `pull_request.head.sha` in the already-typed payload
  (`agent-runner/src/context.ts:36-42`), defaulting to `''`.
- `run.ts` — immediately after `resolvePrContext` and **before** the
  `GITHUB_TOKEN` check at `:99-102`: if `ctx.isFork`, build a `skipped`
  artifact (zero counts, `skip_reason` stating that pull requests from forks
  are not reviewed), write it to `deps.resultPath`, and return a
  `RunCiSuccess` with `exitCode: 0`, `posted: { kind: 'none' }`,
  `blockers: 0`, `gateTriggered: false` (**AC-12**). No diff is fetched, no
  model is called, nothing is posted.
- `run.ts` — the publication mode becomes `manifest.post_as ?? deps.postAs`,
  so the manifest wins and `DEVDIGEST_POST_AS` remains the fallback
  (**AC-11**). The `GITHUB_TOKEN` check and both post calls read the resolved
  value, not `deps.postAs`.
- `artifact.ts` — `buildResultArtifact` takes `repo`, `headSha`,
  `workflowSha`, `manifestVersion`, `model`, `verdict` and `skipReason` in
  addition to what it takes today, and emits `runner_build: RUNNER_VERSION` in
  place of `version`.
- `index.ts` — passes `env.GITHUB_SHA ?? ''` through as the workflow sha. No
  other change; it keeps reading `process.env` directly, which is correct here
  (`agent-runner/CLAUDE.md`).

## Tasks

- [ ] T1 Reshape `CiRunStatus` and `CiResultArtifact` in place exactly per the Frozen surface (`version` → `runner_build`; `pr_number` becomes required; repo/commit/verdict/model/manifest fields added) — `server/src/vendor/shared/contracts/eval-ci.ts`, `client/src/vendor/shared/contracts/eval-ci.ts` — owner: `implementer` — skill: `zod` — → AC-15 → `ci_verify_unit`
- [ ] T2 Reshape `CiRun`; add `CiRefreshRejection` and `CiRefreshResult` per the Frozen surface; grep the whole `contracts/` folder for each new name first (`server/insights.md`, Codebase Patterns 2026-08-04) — same two `eval-ci.ts` files — owner: `implementer` — skill: `zod` — → AC-16 → `ci_ingest_it`
- [ ] T3 Extend `ciRuns`: `workspaceId uuid NOT NULL` → `workspaces.id` cascade, `agentId uuid` → `agents.id` set null, `agentRunId uuid` → `agent_runs.id` set null, `providerRunId text NOT NULL`, `headSha text`, `verdict text`, `unavailableReason text`, `criticalCount`/`warningCount`/`suggestionCount integer`, `durationMs integer`, `manifestVersion integer`, `model text`, `runnerBuild text`; set `.notNull()` on the existing `githubUrl` and `.notNull().default('in_progress')` on the existing `status` (both columns are empty — constraint 8). Add `uniqueIndex('ci_runs_installation_provider_uq').on(ciInstallationId, providerRunId)`, `index('ci_runs_workspace_ran_idx').on(workspaceId, ranAt)`, `index('ci_runs_agent_idx').on(agentId)`. **Rename nothing, drop nothing** (constraint 15) — `server/src/db/schema/ci.ts` — owner: `implementer` — skill: `postgresql-table-design` — → AC-16 → `ci_ingest_it`
- [ ] T4 Run `cd server && pnpm db:generate` once and commit the generated migration unmodified; confirm the SQL contains no `DROP` and no rename — `server/src/db/migrations/**` (generated) — owner: `implementer` — skill: `drizzle-orm-patterns` — → AC-16 → `ci_ingest_it`
- [ ] T5 Add `CiWorkflowRunRef` and the two `GitHubClient` methods to the **server copy only** of the port, exactly per the Frozen surface; do **not** touch `client/src/vendor/shared/adapters.ts` (constraint 10) — `server/src/vendor/shared/adapters.ts` — owner: `implementer` — skill: `onion-architecture` — → AC-14 → `ci_ingest_it`
- [ ] T6 Implement both methods on `OctokitGitHubClient`, wrapped in the file's existing `withRetry(() => withTimeout(…, TIMEOUT))` shape (pattern: `octokit.ts:332-349`): list the workflow's runs by file name and map them onto `CiWorkflowRunRef` (`[]` on a 404 for an unknown workflow); download the named artifact, refuse an archive over `MAX_ARTIFACT_BYTES` before inflating, use `fflate`'s `unzipSync({ filter })` to inflate **only** the named entry and only when its declared size is under `MAX_RESULT_BYTES`, re-check the inflated length afterwards (`server/insights.md`, Tool & Library Notes 2026-08-04 — `originalSize` is attacker-controlled), and return the decoded text or `null` — `server/src/adapters/github/octokit.ts` — owner: `implementer` — skill: `onion-architecture` — → AC-14 → `ci_ingest_it`
- [ ] T7 Add both methods to `MockGitHubClient` with settable fixtures (`workflowRuns: CiWorkflowRunRef[]`, `artifactEntries: Record<string, string | null>` keyed by run id) and a `downloadCalls: string[]` recorder, so a test can prove a run was skipped **before** its artifact was fetched — `server/src/adapters/mocks.ts` — owner: `implementer` — skill: `onion-architecture` — → AC-14 → `ci_ingest_it`
- [ ] T8 `ingest.ts`: `verifyResult` and `verdictFromEvent` exactly per the Frozen surface — pure, no imports beyond zod/contracts, never throws — `server/src/modules/ci/ingest.ts` — owner: `implementer` — skill: `typescript-expert` — → AC-15 → `ci_verify_unit`
- [ ] T9 Add `REFRESH_RUN_LIMIT`, `MAX_ARTIFACT_BYTES`, `MAX_RESULT_BYTES` to the existing CI constants; do not re-declare `WORKFLOW_FILE`, `RESULT_ARTIFACT_NAME` or `RESULT_FILE` — `server/src/modules/ci/constants.ts` — owner: `implementer` — skill: `typescript-expert` — → AC-14 → `ci_ingest_it`
- [ ] T10 Extend `CiRepository`: `listInstallationsForWorkspace`, `terminalProviderRunIds(installationId, ids)`, `upsertRun(...)` using `onConflictDoUpdate` on `(ciInstallationId, providerRunId)`, `listRunsForWorkspace`, `listRunsForAgent`, `insertCiAgentRun(...)` (writes `agent_runs` with `source: 'ci'`, `pr_id: null`, `status: 'done'`), plus a row→`CiRun` mapper; every method workspace-scoped, reads ordered `ran_at DESC NULLS LAST, id DESC` — `server/src/modules/ci/repository.ts` — owner: `implementer` — skill: `drizzle-orm-patterns` — → AC-16, AC-23, AC-24 → `ci_ingest_it`
- [ ] T11 Extend `CiService` with `refresh(workspaceId)`, `listRuns(workspaceId)` and `listRunsForAgent(workspaceId, agentId)`; `refresh` follows the 6-step sequence in the Frozen surface verbatim, including skipping terminal runs **before** any artifact fetch — `server/src/modules/ci/service.ts` — owner: `implementer` — skill: `onion-architecture` — → AC-14, AC-15, AC-16, AC-23, AC-24 → `ci_ingest_it`
- [ ] T12 Add the three routes in the Frozen surface to the existing CI plugin, each with a zod schema via `fastify-type-provider-zod`, `rateLimit` on `POST /ci/refresh` only. **No route accepts a result body** — that absence is AC-14 — `server/src/modules/ci/routes.ts` — owner: `implementer` — skill: `fastify-best-practices` — → AC-14, AC-16, AC-23 → `ci_ingest_it`
- [ ] T13 Runner: add `headSha` to `PrContext`; add the fork short-circuit to `runCi` **before** the `GITHUB_TOKEN` check at `run.ts:99-102`; resolve the publication mode as `manifest.post_as ?? deps.postAs`; extend `buildResultArtifact` with the identity/provenance fields and emit `runner_build`; pass `env.GITHUB_SHA` from `index.ts`. Preserve every invariant in `agent-runner/CLAUDE.md`: the grounding gate stays mandatory, `assemblePrompt` is not hand-rolled, and the verdict comes from `payload.event`/`gateTriggered`, never `outcome.review.verdict` — `agent-runner/src/context.ts`, `agent-runner/src/artifact.ts`, `agent-runner/src/run.ts`, `agent-runner/src/index.ts` — owner: `implementer` — skill: `typescript-expert` — → AC-11, AC-12, AC-13 → `agent_runner_ci_unit`
- [ ] T14 `agent_runner_ci_unit` — extend the runner's hermetic tests: a fork pull request (event payload with `head.repo.fork: true`) returns `exitCode: 0`, a non-null artifact with `verdict: 'skipped'` and a `skip_reason` stating fork pull requests are not reviewed, `posted.kind === 'none'`, **no diff fetch and no LLM call** (assert the injected `fetchDiff` and LLM stub were never invoked), and this holds with **no `GITHUB_TOKEN` and no `OPENROUTER_API_KEY` in the env** (**AC-12**); a manifest with `post_as: 'pr_comment'` posts a comment even when `DEVDIGEST_POST_AS` says `github_review`, and a manifest with `post_as: 'none'` posts nothing (**AC-11**); the artifact carries `repo`, `head_sha`, `workflow_sha`, `pr_number`, `manifest_version`, `model`, `runner_build` and a `verdict` matching `payload.event` for each of the three gate outcomes; **AC-13**: run with `OPENROUTER_API_KEY` and `GITHUB_TOKEN` set to recognisable fake values and assert neither appears anywhere in the artifact JSON or in the posted body — `agent-runner/src/run.test.ts` — owner: `test-writer` — skill: `typescript-expert` — → AC-11, AC-12, AC-13 → `agent_runner_ci_unit`
- [ ] T15 `ci_verify_unit` — hermetic unit tests over `ingest.ts`: a well-formed artifact matching the run's repo, head sha and pull request is accepted; each of these is rejected with a distinct non-empty reason and never accepted — non-JSON text, JSON failing `CiResultArtifact`, a different repository, a different commit on **both** `head_sha` and `workflow_sha`, a pull-request number absent from a non-empty `prNumbers`; a result whose `workflow_sha` (but not `head_sha`) matches is accepted; a run reporting **no** pull requests accepts any `pr_number`; repository comparison is case-insensitive. `verdictFromEvent` maps all three events (**AC-15**) — `server/test/ci-ingest.test.ts` — owner: `test-writer` — skill: `typescript-expert` — → AC-15 → `ci_verify_unit`
- [ ] T16 `ci_ingest_it` — Postgres-backed integration test with `MockSecretsProvider` and a fixture-driven `MockGitHubClient` (`server/insights.md`, Recurring Errors 2026-08-17). Seed one installation. Covers: a finished run with a valid artifact records exactly one `ci_runs` row in `recorded` with the verdict, counts, cost, duration, commit and job url (**AC-14, AC-16**); a second refresh over the same fixtures records nothing more, leaves the row unchanged and **never calls `downloadRunArtifactEntry` for that run id** (asserted on `downloadCalls`); an unfinished run records `in_progress` with null verdict and null counts, and the next refresh — with the same run now finished — upgrades that same row rather than adding one; a finished run whose artifact is missing records `unavailable` with a reason and null counts, never `findings_count: 0`; a result naming a different commit records **no** row and appears in `rejected` with the job url (**AC-15**); a recorded run also inserts exactly one `agent_runs` row with `source: 'ci'`, `pr_id` null, the agent id, the cost and the duration (**AC-24**; the effect of that row on `GET /agents/stats` is T20's, not this task's); `GET /agents/:id/ci-runs` returns only that agent's runs (**AC-23**); every route 404s or returns empty for another workspace; and a static guard asserting `server/src/modules/ci/routes.ts` never references `CiResultArtifact` — the studio accepts no result it did not retrieve (**AC-14**) — `server/test/ci-ingest.it.test.ts` — owner: `test-writer` — skill: `drizzle-orm-patterns` — → AC-14, AC-15, AC-16, AC-23, AC-24 → `ci_ingest_it`
- [ ] T17 `ci_contracts_parse` — extend Phase A's contract test: parse a valid `CiResultArtifact`, `CiRun` and `CiRefreshResult`; assert `CiResultArtifact` rejects a missing `repo`, a missing `head_sha` and a `pr_number` of `0`; assert a `verdict: 'skipped'` artifact with a non-null `skip_reason` parses; assert `CiRunStatus` no longer accepts `'succeeded'` or `'no_findings'` — `server/test/ci-contracts.test.ts` — owner: `test-writer` — skill: `zod` — → AC-15, AC-16 → `ci_contracts_parse`
- [ ] T18 `diff server/src/vendor/shared/contracts/eval-ci.ts client/src/vendor/shared/contracts/eval-ci.ts` — no **new** divergence in the CI block; then `cd client && pnpm typecheck`, and confirm `git diff --stat client/src/vendor/shared/adapters.ts` is empty (constraint 10) — `server/src/vendor/shared/contracts/eval-ci.ts`, `client/src/vendor/shared/contracts/eval-ci.ts`, `client/src/vendor/shared/adapters.ts` (all inspected, not edited) — owner: `implementer` — skill: `zod` — → AC-16 → `ci_contracts_parse`

### Agent statistics — added 2026-08-28 on the user's decision

The scoped exception to "no `modules/reviews/**` change" recorded in Out of
scope. **T19 is an implementation task and runs with T1–T13 in execution
order**; it carries a high number only so that no existing task id moves.

- [ ] T19 Add `eq(t.agentRuns.source, 'local')` to the `and(...)` in `runStatsByAgent`'s `where` (`server/src/modules/reviews/repository/run.repo.ts:36`), so the agent cards keep counting only runs the user started. **In the same edit**, rewrite the now-false sentence in the doc comment at `:18` ("`runCount` counts every run (that is what 'N runs' means on the card)") to say that CI-originated runs are excluded and why, leaving `:19-21` on `avg()` and NULL costs untouched. Change **nothing else** in this file and nothing else under `modules/reviews/**` — `server/src/modules/reviews/repository/run.repo.ts` — owner: `implementer` — skill: `drizzle-orm-patterns` — → AC-24 → `ci_agent_stats_it`
- [ ] T20 `ci_agent_stats_it` — Postgres-backed, sharing `ci-ingest.it.test.ts`'s fixture: snapshot `GET /agents/stats` for the seeded agent, run a refresh that records one CI run, and assert that agent's `run_count` and `avg_cost_usd` are **identical** before and after, while the `ci_runs` row and its `agent_runs` row both exist (proving the run really was written and really is excluded). Then insert one `agent_runs` row with `source: 'local'` directly and assert `run_count` **does** increase by one, so the test fails if the predicate is over-broad rather than only if it is missing. Assert the **delta**, never an absolute count — the file's `describe` block shares one workspace across every `it()` (`server/insights.md`, What Works 2026-08-22) — `server/test/ci-ingest.it.test.ts` — owner: `test-writer` — skill: `drizzle-orm-patterns` — → AC-24 → `ci_agent_stats_it`

## Traceability

| AC | Tasks | Verified by |
|----|-------|-------------|
| AC-11 | T13, T14 | `agent_runner_ci_unit` |
| AC-12 | T13, T14 | `agent_runner_ci_unit` |
| AC-13 | T13, T14 | `agent_runner_ci_unit` |
| AC-14 | T5, T6, T7, T9, T11, T12, T16 | `ci_ingest_it` |
| AC-15 | T1, T8, T11, T15, T16, T17 | `ci_verify_unit`, `ci_ingest_it` |
| AC-16 | T2, T3, T4, T10, T11, T12, T16, T17, T18 | `ci_ingest_it`, `ci_contracts_parse` |
| AC-23 | T10, T11, T12, T16 | `ci_ingest_it` |
| AC-24 | T10, T11, T16, T19, T20 | `ci_ingest_it`, `ci_agent_stats_it` |

AC-16 and AC-23 appear here for their **data** half only; their presentation is
bound in Phase C. AC-13 appears here for the runner's output and the stored
record; the generated files were bound in Phase A.

## Verification

### Fast loop (implementer / test-writer, after every step)

- `cd server && pnpm typecheck`
- `cd server && pnpm test:unit --reporter=dot`
- `cd agent-runner && pnpm typecheck` (after `cd reviewer-core && pnpm install`
  once — constraint 18)
- `cd agent-runner && pnpm test --reporter=dot` — that package declares no
  `test:unit` script (`agent-runner/package.json:10` is
  `vitest run --passWithNoTests`) and every one of its tests is hermetic with
  the LLM stubbed (`agent-runner/CLAUDE.md`, Module Layout), so its bare
  `pnpm test` is fast-loop safe. It touches no database and no network.
- `cd client && pnpm typecheck` (the reshaped contracts compile there too)

### Full (plan-verifier, once at the end)

- `cd server && pnpm typecheck`
- `cd client && pnpm typecheck`
- `cd agent-runner && pnpm typecheck`
- `cd server && pnpm test:unit --reporter=dot`
- `cd client && pnpm test:unit --reporter=dot`
- `cd agent-runner && pnpm test --reporter=dot`
- `cd agent-runner && pnpm build` — the ncc bundle must still build, because it
  is the artefact Phase A's export ships and AC-5 refuses without it. Then
  `grep -c "^import\|require(" agent-runner/dist/index.js` returns `0`
  (`agent-runner/insights/INSIGHTS.md`, What Works 2026-07-08).
- `cd server && pnpm db:migrate` (Docker Postgres running)
- `cd server && pnpm test:integration --reporter=dot` — `ci-ingest.it.test.ts`
  is DB-backed. If the full `.it.test` suite is flaky, re-run the single file
  before concluding a regression (`server/insights.md`, Open Questions
  2026-08-05).
- `git diff server/src/db/migrations/*.sql | grep -i "drop\|rename"` returns
  nothing.
- `git diff --stat server/src/modules/reviews/` shows **exactly one file**,
  `repository/run.repo.ts`, and its diff touches only `runStatsByAgent`'s
  `where` clause and the doc comment above it (T19's scoped exception). Any
  other file or function appearing there is out of scope and must be reverted.
  The existing agent-stats coverage must stay green in the same run — T19
  changes what an already-shipped endpoint returns, so a regression there shows
  up in the existing suite, not in the new tests.
- No e2e in this phase: it adds **no** UI entry point. Phase C adds them.

## Explicit note

Architecture and security review are out of scope for `implementer` and are
handled by separate review agents/skills after implementation. This plan is
intended to run under `/impl-sec`.

## Open questions / assumptions

- **Which sha the platform reports for a `pull_request` run — assumption, not a
  question.** AC-15's commit check compares the artifact against
  `CiWorkflowRunRef.headSha`, and this plan does **not** depend on knowing
  which commit that is: the runner writes **both** `head_sha` (the pull
  request's head, from the event payload) and `workflow_sha` (`GITHUB_SHA`,
  which for a `pull_request` event is the merge commit), and `verifyResult`
  accepts a match on either. **The looser rule ships**, at the cost of one
  extra field and one weaker check. What would let a later change tighten it:
  an observation, from a real recorded run, of which of the two the platform
  actually reports — at which point the other field can be dropped from
  `CiResultArtifact` and the corresponding branch removed from `verifyResult`.
  T15 pins both branches explicitly, so removing one is a visible test change
  rather than a silent loosening.
- **Whether the platform associates a fork pull request with its workflow run —
  assumption, not a question.** `CiWorkflowRunRef.prNumbers` may be empty, and
  `verifyResult` treats an empty list as "no claim to contradict" rather than
  as a rejection, so a result is rejected only when it *names* a pull request
  the run says is not its own. **That looser rule ships.** What would let a
  later change tighten it to "the list must contain the artifact's
  `pr_number`": evidence from real recorded runs that the list is populated for
  every `pull_request` run, fork ones included. T15's "a run reporting **no**
  pull requests accepts any `pr_number`" case is where that tightening would
  show up as a deliberate test change.
- **`runStatsByAgent` is narrowed to `source = 'local'` — decided by the user
  on 2026-08-28, not assumed.** `modules/reviews/repository/run.repo.ts:23-38`
  counts every `agent_runs` row for an agent, so without the predicate the
  agent cards' "N runs / $avg" would absorb CI runs the moment AC-24 writes its
  first row, against the spec's "nor a CI review presented as something the
  user ran". The user chose the filter so the cards keep meaning exactly what
  they meant before; T19 implements it, T20 proves it in both directions (a CI
  run does not move the count, a local run still does), and Out of scope
  records it as the single, named exception to leaving `modules/reviews/**`
  alone. The consequence accepted with it: CI runs are then visible **only** on
  CI Runs and the agent's CI view, which is what the spec's non-goals ask for
  anyway.
- **`unzipSync` is synchronous and runs on the event loop.** The artefact is
  capped at 2 MB and a refresh is user-initiated and rate-limited, so the block
  is bounded and rare. `modules/skills/import.ts` already makes the same
  trade-off. Revisit only if a measurement says otherwise.
