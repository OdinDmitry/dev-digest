# Development Plan: Export to CI — Phase A (contracts, generation, installation)

Spec: docs/specs/cross/SPEC-05-export-to-ci.md
Date: 2026-08-28
Execution mode: single-agent (one ordered `/impl` pass)

Phase 1 of 3. Siblings:
`docs/plans/2026-08-28-export-to-ci-b-runner-and-ingest.md` (Phase B),
`docs/plans/2026-08-28-export-to-ci-c-client-surfaces.md` (Phase C).
**Neither B nor C may start before this file's Verification is green** — B codes
against the manifest and result contracts frozen here, C against the HTTP
surface frozen here.

Run this plan with **`/impl-sec`**, not `/impl`. It creates new API surface, it
writes to a third-party repository with a credential the studio holds, and it
generates code that executes in someone else's CI. `security-reviewer` in Phase
2 is the point of the variant.

Design refs:
`docs/specs/cross/_design/SPEC-05-export-to-ci/3.png` (preview step — the file
list this phase produces), `4.png` (configure step — the trigger set and the
expected-secret readout this phase derives), `5.png` (install step).

## Why three files instead of one

`/impl` runs one plan end to end. 24 acceptance criteria across shared
contracts, the server, the CI runner and three client surfaces is more than one
invocation should carry, and the three phases are **sequential**: B needs A's
manifest/result contracts and the generated workflow, C needs B's read
endpoints. Three files give three independently verifiable `/impl` runs. The
whole-spec map below keeps the set honest.

## Whole-spec AC → phase map (all 24, no orphans)

| Phase | ACs |
|---|---|
| **A** (this file) | AC-2, AC-3, AC-4 (derivation), AC-5, AC-6, AC-7, AC-8, AC-9 (computation), AC-13 (generated files), AC-21, AC-22 (server half) |
| **B** | AC-11, AC-12, AC-13 (runner output + stored record), AC-14, AC-15, AC-16 (data), AC-23 (data), AC-24 |
| **C** | AC-1, AC-4 (presentation), AC-7 (presentation), AC-9 (presentation), AC-10, AC-16 (presentation), AC-17, AC-18, AC-19, AC-20, AC-22 (client half), AC-23 (presentation) |

Several criteria are deliberately split across two phases — a server-side rule
and its presentation, or a generated artefact and the behaviour it produces at
run time. **Each half is bound to its own named test in its own phase file**, so
no half ships unproven, and the union of the three Traceability tables covers
AC-1…AC-24 with no gap and no orphan.

## Goal

Give Export to CI its foundation: close the contract gaps the spec's Contracts
section lists (in **both** vendored copies), extend the empty `ci_installations`
table so an installation can record its workspace and the workflow version it
installed, and build a new `server/src/modules/ci/` that turns an agent plus a
chosen workspace repository into the four kinds of file the bundle contains —
the agent manifest, one file per attached skill, the pre-built runner and the
workflow — previews them without touching GitHub, refuses when the runner
bundle is not built, and installs by committing to a dedicated branch and
opening (or reusing) a pull request.

## Out of scope

- Everything the runner does at run time — the fork branch (AC-12), the
  publication mode being honoured (AC-11), the extra identity fields on the
  written artefact. **Phase B.** This phase only *declares* the contracts and
  *generates* the workflow that carries them.
- Retrieval of results, the GitHub port's workflow-run and artifact methods, the
  `ci_runs` table, `agent_runs` writes. **Phase B.**
- Every client surface — the CI tab, the wizard, CI Runs, the nav entry.
  **Phase C.**
- The three non-GitHub-Actions targets (`circle`, `jenkins`, `cli`). `CiTarget`
  keeps all four members; this phase generates, validates and installs for
  `gha` only and rejects the other three with a "not available" error.
- "Copy files as a zip". No archive is produced anywhere.
- `.devdigest/memory.jsonl`. The bundle is manifest + skills + runner +
  workflow, and nothing else.
- A published marketplace action. The workflow executes
  `node .devdigest/runner/index.js`, never `devdigest/review-action@v1`.
- A separate "update CI config" endpoint. Re-export goes through the same two
  routes and reuses the branch and pull request.
- Any change to `reviewer-core/`. This feature consumes it unchanged.
- Any change to `server/src/modules/reviews/**`. Read as a reference pattern,
  never modified.
- Building the runner bundle from the server, or adding a build step to
  `scripts/dev.sh`. The bundle is a pre-existing artefact of the local checkout;
  AC-5 is what happens when it is absent.

## Constraints

Every claim below was read in this session at the line given.

1. **The two vendored contract copies are the source; there is no package to
   generate them from.** `Glob **/vendor/shared/contracts/eval-ci.ts` returns
   `server/src/vendor/shared/contracts/eval-ci.ts` and
   `client/src/vendor/shared/contracts/eval-ci.ts` (plus unrelated checkouts
   under `server/clones/`). Root `CLAUDE.md`: "A change to the source package
   must be manually re-synced into each vendor copy." **Every contract task
   below names both files.**
2. **Both barrels already `export *` from `./contracts/eval-ci.js`** —
   `server/src/vendor/shared/index.ts:26`, `client/src/vendor/shared/index.ts:26`
   (identical files). Reshaping in place needs **no barrel edit**.
3. **A new contract name can collide only at the barrel.** `server/insights.md`,
   Codebase Patterns 2026-08-04 (`AgentStats` already taken in
   `contracts/observability.ts`, broke the barrel with TS2308). T1 greps the
   whole `contracts/` folder for every new name before adding it.
4. **The starter CI contracts carry exactly the gaps the spec lists.**
   `contracts/eval-ci.ts:213-229` — `AgentManifest` has no publication mode and
   no version of its own shape. `:235-243` — `CiExportInput.repo` is a free
   string and `triggers` is `z.array(z.string())`. `:249-255` —
   `CiInstallation` has no workflow version. `:266` — `CiRunStatus` is
   `['succeeded','failed','no_findings','running']`, conflating "the job
   finished" with "found nothing". `:270-282` — `CiRun` has no verdict.
   `:289-299` — `CiResultArtifact` has no repository, no commit, no verdict, no
   model, and `pr_number` is `nullish`.
5. **`ci_installations` and `ci_runs` are empty and unreferenced.**
   `server/src/db/schema/ci.ts:4-26` defines both. `grep -rn
   "ciInstallations|ciRuns|ci_installations|ci_runs"` over the repo (excluding
   `server/clones/**`) returns only `schema/ci.ts`, `schema.ts:44,86-87`,
   `migrations/0000_init.sql:49,57,367,368`, the migration snapshots, and doc
   comments in `eval-ci.ts:11,248,269,287` — **no repository, no route, no
   seed row**. Adding a `NOT NULL` column is therefore safe without a backfill.
6. **`server/src/db/schema.ts` already enumerates both tables** — import at
   line 44, `schema` object at lines 86-87. Adding *columns* changes neither
   list; **no edit to `schema.ts` is needed in this phase.**
7. **`drizzle-kit generate` hangs on a same-table diff that both removes and
   adds columns.** `server/insights.md`, Tool & Library Notes 2026-08-04 — the
   interactive "created or renamed from X?" prompt never resolves on this
   sandbox's stdin. **This phase's migration is ADD-only: no column is renamed
   and none is dropped**, which is why `ci_runs.github_url` and
   `ci_runs.status` keep their names even where a better one exists.
8. **`server/src/db/migrations/` is do-not-touch by hand** (`server/CLAUDE.md`,
   Do-not-touch) and migrations are **not** applied on boot (`server/CLAUDE.md`,
   Gotchas) — `pnpm db:migrate` is manual. The latest migration on disk is
   `0019` (`server/insights.md`, What Works 2026-08-22).
9. **`GitHubClient` already covers the whole install path.**
   `server/src/vendor/shared/adapters.ts:161` `commitFiles` (documented as
   "Creates the branch from `base` if missing, else fast-forwards it"), `:163`
   `findOpenPr`, `:155` `openPullRequest`. `octokit.ts:264-330` implements
   `commitFiles` via blobs→tree→commit→ref, layering onto the parent tree so
   unrelated files survive; `:332-349` implements `findOpenPr` against
   `head: owner:branch`. **No port change is needed in this phase.**
10. **`MockGitHubClient` records everything the tests need.**
    `server/src/adapters/mocks.ts:132-136` exposes `openedPrs` and `committed`;
    `:225-233` push into them and `findOpenPr` returns a URL once a PR with that
    head exists. AC-6/AC-7's integration assertions read those arrays.
11. **`container.github()` throws `ConfigError('GITHUB_TOKEN is not
    configured')` when no token is stored** — `platform/container.ts:172-179`,
    importing `ConfigError` from `platform/errors.js` at `:26`. That is the
    "no credential for the repository" edge case's first half; the second half
    (a token that cannot write) surfaces as an Octokit failure inside
    `commitFiles`.
12. **The server has no YAML parser.** `server/package.json:19-43` lists no
    `yaml`. `agent-runner/package.json:13` pins `yaml: ^2.6.1` and uses it at
    `agent-runner/src/manifest.ts:3,62`. This phase adds `yaml: ^2.6.1` to
    `server/package.json` — same version, already vetted in this repo — for
    manifest serialization and AC-3's validation.
13. **The runner bundle is git-ignored and is not built right now.**
    `agent-runner/.gitignore:2` ignores `dist/`; `Glob agent-runner/dist/*`
    returns nothing. `agent-runner/package.json:9` builds it with
    `ncc build src/index.ts -o dist`. AC-5 is therefore the *default* state of a
    fresh checkout, not an edge case.
14. **The runner's file layout is already fixed by shipped code.**
    `agent-runner/src/manifest.ts:27` reads `<devdigestDir>/agents/*.yaml` and
    `:40-44` rejects anything other than exactly one manifest file;
    `agent-runner/src/skills.ts:18` reads
    `<devdigestDir>/skills/<slug>.md`; `agent-runner/README.md:7-9` fixes the
    bundle at `.devdigest/runner/index.js`; `agent-runner/src/diff.ts:21`
    strips `.devdigest/` and `.github/workflows/` from any diff it reviews.
    **These four paths are not this plan's to choose.**
15. **`AgentManifest` is `safeParse`d on read** —
    `agent-runner/src/manifest.ts:69`. A `.default(...)` added to it is
    therefore *effective*, unlike the trap recorded in `server/insights.md`,
    Recurring Errors 2026-08-17 (`getRunTrace` cast instead of parsing, so every
    `.default()` on `RunTrace` was decorative). This is why `post_as` and
    `manifest_version` may be added as defaulted fields.
16. **Routes declare zod schemas via `fastify-type-provider-zod`** —
    `server/CLAUDE.md`, Non-default conventions; the pattern to copy is
    `modules/agents/routes.ts:34-58`. Never `Schema.parse(req.body)` in a
    handler.
17. **A new service takes explicit deps, never `container: Container`** —
    `onion-architecture`, "Dependencies of a service". `Pick<Container, …>` is
    the permitted shorthand. `ContextService` is the in-repo precedent.
18. **`repos` carries the identity the export needs.**
    `server/src/db/schema/repos.ts:14` `fullName`, `:15` `defaultBranch`
    (default `'main'`), `:22` unique on `(workspaceId, fullName)`. The chooser
    picks one of these rows, so the export takes a **repo id**, never an
    `owner/name` string from the client.
19. **`skills` has no slug column** — `server/src/db/schema/skills.ts:10` is
    `name`, `:16` is `body`. The manifest's `skills: string[]` are slugs, so the
    export must derive one per attached skill and guarantee uniqueness within
    one bundle.
20. **Linked skills come back ordered** —
    `modules/agents/repository.ts:192-200` `linkedSkills` joins `agent_skills`
    and orders by `agent_skills.order` ascending. The manifest's `skills` array
    uses that order.
21. **Every read and write is workspace-scoped.** Spec NFR: "Installations and
    CI runs SHALL be readable and writable only within the requesting user's
    workspace, on every path"; `security` A01 deny-by-default;
    `server/insights.md`, Codebase Patterns 2026-08-05 (a cache-hit early return
    that skipped the workspace check leaked another workspace's data).
    `modules/_shared/context.ts:14-23` `getContext` is how every route gets the
    workspace id.
22. **Handoff-sized task bullets** — `/impl` copies task lines verbatim into
    spawn prompts. Prefer `file:line` references over pasted schema or code
    blocks; if a single task bullet would exceed ~2 KB, point at the frozen
    surface below instead of embedding it.

## Placement decisions

Each traces to a preloaded skill's rule, not to preference.

- **New module `server/src/modules/ci/`** with `routes.ts` (ring 4),
  `service.ts` (ring 2), `repository.ts` (ring 3), `helpers.ts` (ring 2, pure),
  `manifest.ts` / `workflow.ts` (ring 2, pure generators), `bundle.ts` (ring 3,
  filesystem) and `constants.ts` (ring 2) — `onion-architecture`, "Module
  anatomy". A module consisting only of `routes.ts` is not a module, so the
  service and repository exist even though the slice is small.
- **`manifest.ts` and `workflow.ts` are pure and take no I/O.**
  `onion-architecture`'s decision table puts "turning a row into an API shape"
  and pure transforms in ring 2 `helpers.ts`-style files. Purity is what makes
  AC-21, AC-13 and AC-3 unit-testable without a server, and the spec's
  Traceability marks exactly those criteria "unit".
- **`bundle.ts` is the only file that reads the filesystem** and is ring 3: it
  reads `config.runnerBundlePath` and returns the contents or `null`. AC-5's
  refusal is then a service-level decision over a repository-level fact, not a
  filesystem check inside a route.
- **The runner bundle path lives in `AppConfig`, not in a module constant.**
  `platform/config.ts` already owns every path the app resolves at startup
  (`cloneDir`, `secretsPath`, lines 45-48). Putting it there gives tests an
  override with no filesystem mocking and keeps the module free of
  `process.cwd()` reasoning.
- **`CiExportInput` takes `repo_id: uuid`, not `repo: "owner/name"`.**
  `security` A08 (mass assignment — "destructure only expected fields", never
  trust an identity from the body) and A01. A free-string repository is a
  request to commit files into *any* repository the stored token can write to;
  a workspace-scoped id makes the blast radius structural rather than tested.
  This changes `contracts/eval-ci.ts:236`.
- **The publication mode goes in the manifest, the trigger set goes in the
  workflow, and neither goes in both.** `zod`'s `compose-shared-schemas`: one
  definition, one owner. The triggers are `on.pull_request.types` — the only
  thing GitHub reads, and AC-21 is stated about the generated workflow.
  The publication mode is read at run time by the runner, which already loads
  and validates the manifest (constraint 15) and does *not* read the workflow;
  carrying it in the manifest is what makes the spec's "an identical manifest
  guarantees an identical configuration" true. See Open questions for the
  alternative that was rejected.
- **The workflow version is a constant string stamped as a comment line**
  (`# devdigest-workflow-version: <v>`) and parsed back with a regex, not
  derived from a hash of the contents. The spec: "It changes when the studio's
  generator changes what the workflow does. It is compared for equality only."
  A content hash would change on every user edit (AC-22) and report a
  hand-edited workflow as out of date, which is not what AC-9 asks.
- **`ci_installations` gets `workspace_id NOT NULL`** rather than being scoped
  through `agents.workspace_id` at query time. `postgresql-table-design`, "Add
  NOT NULL everywhere it is semantically required"; `server/src/db/schema.ts:4-7`
  states the repo-wide tenancy rule ("every domain table carries
  `workspace_id`"). Constraint 5 makes the non-null add free.
- **`unique (agent_id, repo)` on `ci_installations`.**
  `postgresql-table-design`, "UNIQUE"; the spec's edge case "one agent has at
  most one installation per repository". A database invariant instead of a
  check-then-insert race between two wizard tabs — the same shape as
  `eval_suite_runs_one_active_per_agent` (`server/insights.md`, What Works
  2026-08-22).
- **`workflow_version` is nullable.** The spec's edge case: "an installation
  whose version is unknown is presented as not current rather than as current".
  `null` is the only value that can say "unknown"; a `.default('1')` would say
  "current" about a workflow nobody stamped (`client/insights.md`, What Doesn't
  Work 2026-07-30, on `?? 0` hiding "missing").
- **`expectedSecrets()` derives from the generated workflow text and from what
  the platform provides, never from any secret store.** Spec non-goal:
  "Reading, storing or displaying a secret's value, including checking whether
  a stored secret is correct"; `security` A04. The studio never calls GitHub's
  secrets API, so AC-4 is answered with `provided_by_platform`, which is a
  property of the *platform*, not of the repository.
- **Install and refresh carry a route-level rate limit**, preview and validate
  do not. `security` A06 — install performs an authenticated write to a third
  party. The in-repo precedent is `modules/reviews/routes.ts:29`. This spec,
  unlike SPEC-03, has no NFR forbidding a feature-specific limit.

## Entry points & duplicate registries

- **`server/src/modules/index.ts:32-49`** — the module registry, one import plus
  one entry. `ci` must be added. Covered by **T15**.
- **`server/src/db/schema.ts`** — checked: `ciInstallations`/`ciRuns` are
  already imported (line 44) and already in the `schema` object (lines 86-87).
  This phase adds columns only, so **neither list changes**. Recorded so a later
  reader does not go looking.
- **`server/src/vendor/shared/contracts/eval-ci.ts` ↔
  `client/src/vendor/shared/contracts/eval-ci.ts`** — the same file twice, not
  generated from each other (root `CLAUDE.md`; `client/insights.md`, Codebase
  Patterns 2026-08-05 records that the two `vendor/shared` trees are not even
  byte-identical today). **T1, T2 and T3 each name both paths**, and T18 diffs
  the CI block.
- **Both `vendor/shared/index.ts` barrels** — checked
  (`server/src/vendor/shared/index.ts:26`, `client/src/vendor/shared/index.ts:26`):
  `eval-ci.js` is already `export *`-ed in both. **No barrel edit needed.**
- **`server/src/vendor/shared/adapters.ts`** — checked: `GitHubClient`
  (`:143-167`) already has `commitFiles`, `findOpenPr` and `openPullRequest`.
  **No port change in this phase**; Phase B adds the two retrieval methods.
- `grep -rn "CiExportInput|CiExport|CiInstallation|CiFile|CiTarget|CiRun|
  CiResultArtifact|AgentManifest" client/src server/src reviewer-core/src
  mcp/src agent-runner/src` (excluding `server/clones/**`) — **checked**: the
  only hits outside the two contract copies and their doc comments are
  `agent-runner/src/{manifest,artifact,run}.ts` and their tests (Phase B's
  files), plus `CiFailOn` in `modules/agents/*` and
  `client/.../ConfigTab/*`, which this phase does not touch. **Nothing else
  consumes these shapes**, so reshaping them breaks no consumer in this phase.
- `grep -rn "ci" mcp/src` — **checked, nothing**: the MCP server exposes no CI
  surface and is untouched by all three phases.
- `grep -rn "yaml" server/src` — **checked, nothing**: no existing YAML handling
  to reuse or collide with; T3 introduces the dependency.

## Affected modules & files

- **shared contracts (× 2 copies)**:
  `server/src/vendor/shared/contracts/eval-ci.ts`,
  `client/src/vendor/shared/contracts/eval-ci.ts`
- **server config**: `server/src/platform/config.ts`
- **server schema**: `server/src/db/schema/ci.ts`,
  `server/src/db/migrations/**` (generated only)
- **server module (new)**: `server/src/modules/ci/constants.ts`,
  `manifest.ts`, `workflow.ts`, `bundle.ts`, `helpers.ts`, `repository.ts`,
  `service.ts`, `routes.ts`
- **server registry**: `server/src/modules/index.ts`
- **server deps**: `server/package.json` (add `yaml`)
- **server tests (new)**: `server/test/ci-contracts.test.ts`,
  `server/test/ci-generation.test.ts`, `server/test/ci-export.it.test.ts`

## Frozen surface

Both later phases code against exactly this. Nothing here changes after T15.

### Contracts — `contracts/eval-ci.ts` (both copies)

```ts
/** Shape version of AgentManifest. Bump when the manifest's SHAPE changes. */
export const MANIFEST_VERSION = 1;
/** Stamped into the generated workflow and recorded on the installation. */
export const WORKFLOW_VERSION = '1';

export const CiPostAs = z.enum(['github_review', 'pr_comment', 'none']);
export const CiTriggerEvent = z.enum(['opened', 'synchronize', 'reopened']);
export const CiVerdict = z.enum(['approved', 'changes_requested', 'commented', 'skipped']);

// RESHAPED in place (eval-ci.ts:213-229) — two fields added, nothing removed.
export const AgentManifest = z.object({
  manifest_version: z.number().int().positive().default(MANIFEST_VERSION),
  name: z.string().min(1),
  provider: Provider.default('openrouter'),
  model: z.string().min(1),
  system_prompt: z.string(),
  skills: z.array(z.string()).nullish().transform((v) => v ?? []),
  strategy: z.enum(['auto', 'single-pass', 'map-reduce']).default('auto'),
  ci_fail_on: CiFailOn.default('critical'),
  post_as: CiPostAs.default('github_review'),   // AC-11
});

// RESHAPED (eval-ci.ts:198-202) — `editable` is explicit, never defaulted:
// exactly one generated file is editable and the generator always says which.
export const CiFile = z.object({
  path: z.string(),
  contents: z.string(),
  editable: z.boolean(),
});

// RESHAPED (eval-ci.ts:235-243) — `repo` → `repo_id`; `action` removed
// (preview and install are separate routes); `workflow_contents` added.
export const CiExportInput = z.object({
  repo_id: z.string().uuid(),
  target: CiTarget.default('gha'),
  post_as: CiPostAs.default('github_review'),
  triggers: z.array(CiTriggerEvent).min(1).default(['opened', 'synchronize']),
  base: z.string().min(1).nullish(),          // null → the repo's default branch
  workflow_contents: z.string().nullish(),    // AC-22; null → generate it
});
export type CiExportInputBody = z.input<typeof CiExportInput>;

/** AC-4. `provided_by_platform` is a property of the PLATFORM, never a lookup
 *  against any secret store — the studio never reads a secret's value. */
export const CiSecretExpectation = z.object({
  key: z.string(),
  provided_by_platform: z.boolean(),
});

/** Response of the preview route. No GitHub side effect. */
export const CiExportPreview = z.object({
  files: z.array(CiFile),                     // AC-2
  workflow_version: z.string(),
  expected_secrets: z.array(CiSecretExpectation),
  repo: z.string(),                           // "owner/name", resolved server-side
  base: z.string(),
  ci_fail_on: CiFailOn,                       // the threshold that would be exported
  skill_count: z.number().int(),              // 0 → "no skills attached"
});

// RESHAPED (eval-ci.ts:249-255).
export const CiInstallation = z.object({
  id: z.string(),
  agent_id: z.string(),
  agent_name: z.string().nullable(),
  repo: z.string(),
  target_type: CiTarget,
  installed_at: z.string(),
  updated_at: z.string(),
  workflow_version: z.string().nullable(),    // null = unknown ⇒ NOT current
  pr_url: z.string().nullable(),
  ci_fail_on: CiFailOn,
  current: z.boolean(),                       // AC-9, computed by installationToDto
});

// RESHAPED (eval-ci.ts:259-264).
export const CiExport = z.object({
  installation: CiInstallation,
  files: z.array(CiFile),
  pr_url: z.string(),
});

/** AC-3 — the answer the wizard blocks on. */
export const CiWorkflowValidation = z.object({
  valid: z.boolean(),
  error: z.string().nullable(),
});
```

`CiRunStatus`, `CiRun` and `CiResultArtifact` are **Phase B's** to reshape; they
stay exactly as they are on disk in this phase.

### Module surface — `server/src/modules/ci/constants.ts`

```ts
export const CI_BRANCH = 'devdigest/ci';
export const CI_PR_TITLE = 'Add DevDigest CI review';
export const WORKFLOW_PATH = '.github/workflows/devdigest-review.yml';
export const WORKFLOW_FILE = 'devdigest-review.yml';   // Phase B looks runs up by this
export const MANIFEST_DIR = '.devdigest/agents';
export const SKILLS_DIR = '.devdigest/skills';
export const RUNNER_PATH = '.devdigest/runner/index.js';
export const RESULT_ARTIFACT_NAME = 'devdigest-result';
export const RESULT_FILE = 'devdigest-result.json';
export const WORKFLOW_VERSION_MARKER = '# devdigest-workflow-version:';
/** Pinned to an exact immutable revision (spec NFR); tags resolved 2026-08-28. */
export const ACTION_CHECKOUT = 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683';        // v4.2.2
export const ACTION_UPLOAD_ARTIFACT = 'actions/upload-artifact@b4b15b8c7c6ac21ea08fcf65892d2ee8f75cf882'; // v4.4.3
export const SECRET_MODEL_KEY = 'OPENROUTER_API_KEY';
export const SECRET_GITHUB_TOKEN = 'GITHUB_TOKEN';
```

### Module surface — pure generators (ring 2)

```ts
// manifest.ts
export function buildManifest(args: {
  agent: AgentRow; skillSlugs: string[]; postAs: CiPostAs;
}): AgentManifest;
export function serializeManifest(m: AgentManifest): string;   // yaml.stringify
export function manifestPath(agentSlug: string): string;       // `${MANIFEST_DIR}/${slug}.yaml`

// workflow.ts
export function buildWorkflow(triggers: CiTriggerEvent[]): string;      // AC-21
export function readWorkflowVersion(contents: string): string | null;   // AC-8/AC-9
export function validateWorkflow(contents: string): CiWorkflowValidation; // AC-3
export function expectedSecrets(contents: string): CiSecretExpectation[]; // AC-4

// helpers.ts
export function slugify(name: string): string;
export function uniqueSlugs(names: string[]): string[];   // deterministic "-2" suffixes
export function installationToDto(
  row: CiInstallationRow, agentName: string | null, currentVersion: string,
): CiInstallation;                                        // sets `current` (AC-9)
```

`buildWorkflow` emits, in this order: the version marker comment, `name`,
`on.pull_request.types` built from `triggers` **and nothing else** (AC-21),
`permissions: { contents: read, pull-requests: write }` and no other permission
(NFR), one job with `actions/checkout` pinned by sha, a `run: node
.devdigest/runner/index.js` step whose `env` passes `OPENROUTER_API_KEY` and
`GITHUB_TOKEN` as `${{ secrets.* }}` interpolations plus `GITHUB_REPOSITORY` and
`PR_NUMBER`, and a final `if: always()` upload of `devdigest-result.json` with
`if-no-files-found: ignore`. It uses `pull_request`, never
`pull_request_target` (NFR: no trigger that hands a fork's code a writable
credential). There is no `setup-node` step — one less pinned dependency; the
hosted runner's own Node provides `fetch`.

`validateWorkflow` is `yaml.parse` inside a try/catch, then three structural
checks: the document is an object, it has an `on` key, and it has a non-empty
`jobs` object. It returns a reason string, never throws. It deliberately does
**not** check that the runner step survived — the spec says the export cannot
detect that and does not try.

`expectedSecrets` returns one entry per distinct `secrets.<KEY>` interpolation
found in the workflow text, with `provided_by_platform === (key ===
'GITHUB_TOKEN')`.

### HTTP surface (this phase)

```
POST /agents/:id/ci-export/preview   → CiExportPreview      (AC-2, AC-4, AC-5)
POST /ci/workflow/validate           → CiWorkflowValidation (AC-3)
POST /agents/:id/ci-export/install   → CiExport             (AC-6, AC-7, AC-8, AC-21, AC-22)
GET  /agents/:id/ci-installations    → CiInstallation[]     (AC-9)
```

Only `install` declares `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }`.
Every route resolves `workspaceId` through `getContext`
(`modules/_shared/context.ts:14-23`) and 404s an agent or repo from another
workspace.

### Install sequence (service, ring 2)

1. `agentsRepo.getById(workspaceId, agentId)` → `NotFoundError` if absent.
2. `repos` row by `(workspaceId, repo_id)` → `NotFoundError` if absent. `base`
   defaults to that row's `defaultBranch`.
3. `target !== 'gha'` → `ValidationError` naming the target as unavailable.
4. Build the files. `bundle.read()` returning `null` → refuse the whole export
   with a message naming the unavailable runner and the command that builds it
   (**AC-5**). Nothing is written.
5. If `workflow_contents` is present, `validateWorkflow` it; invalid →
   `ValidationError` carrying the reason (**AC-3**). Use the given contents
   verbatim (**AC-22**).
6. `github.commitFiles(repo, { branch: CI_BRANCH, base, message, files })`
   (**AC-6** — the branch is never `base`).
7. `github.findOpenPr(repo, CI_BRANCH)`; if null,
   `github.openPullRequest(repo, { title: CI_PR_TITLE, head: CI_BRANCH, base, body })`
   (**AC-7**, and the "branch/PR already exists" edge case: never a second PR).
8. Only now, `repo.upsertInstallation(...)` with
   `workflow_version = readWorkflowVersion(installedWorkflowContents)`
   (**AC-8**). A failure at step 6 or 7 records nothing and names the step.

## Tasks

- [ ] T1 Add `MANIFEST_VERSION`, `WORKFLOW_VERSION`, `CiPostAs`, `CiTriggerEvent`, `CiVerdict`, `CiSecretExpectation`, `CiWorkflowValidation` exactly as in the Frozen surface; **first** `grep -rn "<name>" server/src/vendor/shared/contracts/` for each new name and stop if any already exists (constraint 3) — `server/src/vendor/shared/contracts/eval-ci.ts`, `client/src/vendor/shared/contracts/eval-ci.ts` — owner: `implementer` — skill: `zod` — → AC-21 → `ci_contracts_parse`
- [ ] T2 Reshape `AgentManifest` (add `manifest_version`, `post_as`) and `CiFile` (`editable` no longer defaulted) in place per the Frozen surface; leave every other field untouched — same two `eval-ci.ts` files — owner: `implementer` — skill: `zod` — → AC-11 → `ci_contracts_parse`
- [ ] T3 Reshape `CiExportInput` (`repo_id`, typed `triggers`, `post_as`, `base` nullish, `workflow_contents`; drop `action`), `CiInstallation` and `CiExport`; add `CiExportPreview` — same two `eval-ci.ts` files — owner: `implementer` — skill: `zod` — → AC-22 → `ci_contracts_parse`
- [ ] T4 Add `yaml: ^2.6.1` to `server/package.json` dependencies (same version `agent-runner/package.json:13` already pins) and run `pnpm install` in `server/` — `server/package.json` — owner: `implementer` — skill: `typescript-expert` — → AC-3 → `ci_generation_unit`
- [ ] T5 Add `runnerBundlePath: string` to `AppConfig` and `loadConfig`: an optional `DEVDIGEST_RUNNER_BUNDLE` env var, defaulting to `resolve(dirname(fileURLToPath(import.meta.url)), '../../../agent-runner/dist/index.js')` — three levels up resolves to the repo root from both `src/platform/` and the built `dist/platform/` — `server/src/platform/config.ts` — owner: `implementer` — skill: `typescript-expert` — → AC-5 → `ci_export_it`
- [ ] T6 Extend `ciInstallations`: `workspaceId uuid NOT NULL` → `workspaces.id` `ON DELETE cascade`, `workflowVersion text` (nullable), `prUrl text`, `ciFailOn text` enum `['never','critical','warning','any']` NOT NULL default `'critical'`, `updatedAt timestamptz NOT NULL DEFAULT now()`; add `uniqueIndex('ci_installations_agent_repo_uq').on(agentId, repo)` and `index('ci_installations_workspace_idx').on(workspaceId)`. **Add only — rename nothing, drop nothing** (constraint 7) — `server/src/db/schema/ci.ts` — owner: `implementer` — skill: `postgresql-table-design` — → AC-8 → `ci_export_it`
- [ ] T7 Run `cd server && pnpm db:generate` once and commit the generated migration unmodified; confirm the SQL is `ALTER TABLE … ADD COLUMN` plus two `CREATE … INDEX` and contains no `DROP` and no rename — `server/src/db/migrations/**` (generated) — owner: `implementer` — skill: `drizzle-orm-patterns` — → AC-8 → `ci_export_it`
- [ ] T8 `constants.ts` exactly as in the Frozen surface, with the two pinned action references as named constants — `server/src/modules/ci/constants.ts` — owner: `implementer` — skill: `typescript-expert` — → AC-6 → `ci_generation_unit`
- [ ] T9 `helpers.ts`: `slugify`, `uniqueSlugs` (deterministic `-2`, `-3` suffixes on collision, input order preserved) and `installationToDto` (sets `current = row.workflowVersion === currentVersion`, so a `null` version is never current) — `server/src/modules/ci/helpers.ts` — owner: `implementer` — skill: `typescript-expert` — → AC-9 → `ci_generation_unit`
- [ ] T10 `manifest.ts`: `buildManifest` (name/provider/model/system prompt from the agent row, `skills` = the slugs in `agent_skills.order` per `modules/agents/repository.ts:192-200`, `ci_fail_on` from the agent, `post_as` from the request, `manifest_version = MANIFEST_VERSION`), `serializeManifest` via `yaml.stringify`, `manifestPath` — `server/src/modules/ci/manifest.ts` — owner: `implementer` — skill: `zod` — → AC-2 → `ci_generation_unit`
- [ ] T11 `workflow.ts`: `buildWorkflow`, `readWorkflowVersion`, `validateWorkflow`, `expectedSecrets` exactly per the Frozen surface's "pure generators" notes — `server/src/modules/ci/workflow.ts` — owner: `implementer` — skill: `typescript-expert` — → AC-3, AC-4, AC-13, AC-21 → `ci_generation_unit`
- [ ] T12 `bundle.ts`: `readRunnerBundle(path: string): string | null` — `readFileSync` in a try/catch returning `null` on any error, so AC-5's decision belongs to the service — `server/src/modules/ci/bundle.ts` — owner: `implementer` — skill: `onion-architecture` — → AC-5 → `ci_export_it`
- [ ] T13 `CiRepository`: `getInstallation(workspaceId, agentId, repo)`, `listForAgent(workspaceId, agentId)`, `upsertInstallation(...)` using `onConflictDoUpdate` on `(agentId, repo)`, all workspace-scoped, ordering by `installed_at DESC, id DESC` (a unique final tiebreaker — `server/insights.md`, Recurring Errors 2026-08-04) — `server/src/modules/ci/repository.ts` — owner: `implementer` — skill: `drizzle-orm-patterns` — → AC-8 → `ci_export_it`
- [ ] T14 `CiService` with explicit deps (`{ repo: CiRepository; agents: AgentsRepository; skills: SkillsRepository; db: Db; github: () => Promise<GitHubClient>; config: Pick<AppConfig,'runnerBundlePath'> }` — never `container: Container`, per constraint 17): `preview`, `validateWorkflow`, `install`, `listInstallations`, each taking `workspaceId` first and enforcing it on **every** branch including early returns. Install follows the 8-step sequence in the Frozen surface verbatim — `server/src/modules/ci/service.ts` — owner: `implementer` — skill: `onion-architecture` — → AC-2, AC-5, AC-6, AC-7, AC-8, AC-9, AC-22 → `ci_export_it`
- [ ] T15 `routes.ts` — the four routes in the Frozen surface, each with a zod `params`/`body` schema via `fastify-type-provider-zod` (pattern: `modules/agents/routes.ts:34-58`), `rateLimit` on install only; register `ci` in the module registry (one import + one entry) — `server/src/modules/ci/routes.ts`, `server/src/modules/index.ts` — owner: `implementer` — skill: `fastify-best-practices` — → AC-2, AC-3 → `ci_export_it`
- [ ] T16 `ci_contracts_parse` — parse a valid `AgentManifest`, `CiExportInput`, `CiExportPreview`, `CiInstallation`, `CiExport`, `CiFile`, `CiSecretExpectation`; assert `CiExportInput` rejects `triggers: []` and an unknown trigger name; assert `CiExportInput` rejects a non-uuid `repo_id`. **Regression fixture in the OLD shape**: parse a manifest object carrying *neither* `manifest_version` *nor* `post_as` (the shape a studio predating this phase would have written) and assert it validates with `manifest_version === 1` and `post_as === 'github_review'` — this is effective only because `agent-runner/src/manifest.ts:69` calls `safeParse` on read (constraint 15), and the assertion is what keeps that true — `server/test/ci-contracts.test.ts` — owner: `test-writer` — skill: `zod` — → AC-11, AC-21, AC-22 → `ci_contracts_parse`
- [ ] T17 `ci_generation_unit` — hermetic unit tests over `workflow.ts`, `manifest.ts` and `helpers.ts`: `buildWorkflow(['opened'])` yields `types: [opened]` and no other `on:` key, and `buildWorkflow(['opened','synchronize','reopened'])` yields exactly those three (**AC-21**); the generated workflow's `permissions` block has exactly `contents: read` and `pull-requests: write`; it names `pull_request` and never `pull_request_target`; both action references are pinned to a 40-character sha (**NFR**); `readWorkflowVersion` round-trips the marker and returns `null` for a workflow with no marker; `validateWorkflow` accepts the generated workflow, and rejects unparsable YAML, a scalar document and a document with no `jobs`, each with a non-empty reason (**AC-3**); `expectedSecrets` returns `OPENROUTER_API_KEY` with `provided_by_platform: false` and `GITHUB_TOKEN` with `true` (**AC-4**); **AC-13**: build the manifest, the skill files and the workflow with a fake secret value present in the agent's system prompt *and* in the environment, and assert no generated file contains that value and that every secret appears only as a `${{ secrets.NAME }}` interpolation; `uniqueSlugs(['Secret Leak Gate','secret leak gate'])` returns two distinct slugs in input order — `server/test/ci-generation.test.ts` — owner: `test-writer` — skill: `typescript-expert` — → AC-3, AC-4, AC-13, AC-21 → `ci_generation_unit`
- [ ] T18 `ci_export_it` — Postgres-backed integration test. Inject `secrets: new MockSecretsProvider()` and a `MockGitHubClient` in `appWith` overrides so no adapter can reach the network (`server/insights.md`, Recurring Errors 2026-08-17), and point `runnerBundlePath` at a temp file. Covers: preview returns one manifest file, one file per attached skill, the runner file and the workflow, with only the workflow `editable: true` (**AC-2**); preview for an agent with no skills returns no skill file and `skill_count: 0`; preview with `runnerBundlePath` pointing at a missing file is refused with a message naming the runner (**AC-5**) and `MockGitHubClient.committed` stays empty; install commits to `devdigest/ci` and **never** to the repo's default branch, asserted on `committed[0].branch` and `.base` (**AC-6**); install returns the PR url and `openedPrs` has length 1, and a **second** install for the same agent+repo opens no second PR while returning the same url (**AC-7**); install records exactly one installation carrying agent, repo and `workflow_version` (**AC-8**), and the second install leaves one row with a bumped `updated_at`; `GET /agents/:id/ci-installations` reports `current: true` for that row and `current: false` after the row's `workflow_version` is set to `null` in the DB (**AC-9**); install with edited `workflow_contents` commits exactly those bytes (**AC-22**) and install with unparsable `workflow_contents` is rejected with the reason and commits nothing (**AC-3**); an agent or a `repo_id` from another workspace 404s on every route — `server/test/ci-export.it.test.ts` — owner: `test-writer` — skill: `drizzle-orm-patterns` — → AC-2, AC-3, AC-5, AC-6, AC-7, AC-8, AC-9, AC-22 → `ci_export_it`
- [ ] T19 `diff server/src/vendor/shared/contracts/eval-ci.ts client/src/vendor/shared/contracts/eval-ci.ts` — every difference must be one that already existed before this phase; no **new** divergence in the CI block. Then `cd client && pnpm typecheck` (the client compiles the reshaped contracts too) — `server/src/vendor/shared/contracts/eval-ci.ts`, `client/src/vendor/shared/contracts/eval-ci.ts` (inspected, not edited) — owner: `implementer` — skill: `zod` — → AC-22 → `ci_contracts_parse`

## Traceability

| AC | Tasks | Verified by |
|----|-------|-------------|
| AC-2 | T10, T14, T18 | `ci_export_it` |
| AC-3 | T4, T11, T15, T17, T18 | `ci_generation_unit`, `ci_export_it` |
| AC-4 | T11, T17 | `ci_generation_unit` |
| AC-5 | T5, T12, T14, T18 | `ci_export_it` |
| AC-6 | T8, T14, T18 | `ci_export_it` |
| AC-7 | T14, T18 | `ci_export_it` |
| AC-8 | T6, T7, T13, T14, T18 | `ci_export_it` |
| AC-9 | T9, T14, T18 | `ci_export_it` |
| AC-11 | T2, T16 | `ci_contracts_parse` |
| AC-13 | T11, T17 | `ci_generation_unit` |
| AC-21 | T1, T11, T16, T17 | `ci_generation_unit`, `ci_contracts_parse` |
| AC-22 | T3, T14, T16, T18, T19 | `ci_export_it`, `ci_contracts_parse` |

AC-11 and AC-13 appear here for their *declared* half only (the manifest field
that carries the publication mode; the generated files that carry no secret).
Their run-time halves are bound in Phase B.

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
- `cd server && pnpm test:integration --reporter=dot` — `ci-export.it.test.ts`
  is DB-backed. If the full `.it.test` suite is flaky, re-run the single file
  before concluding a regression (`server/insights.md`, Open Questions
  2026-08-05).
- `git diff --name-only server/src/db/migrations` shows exactly one new `.sql`
  file plus its snapshot, and nothing under `migrations/` was hand-edited.
- `git diff server/src/db/migrations/*.sql | grep -i "drop\|rename"` returns
  nothing (constraint 7).
- No e2e in this phase: it adds **no** UI entry point. Phase C adds them and
  owns `./scripts/e2e.sh`.

## Explicit note

Architecture and security review are out of scope for `implementer` and are
handled by separate review agents/skills after implementation. This plan is
intended to run under `/impl-sec`.

## Open questions / assumptions

- **Pinned action revisions.** The spec's NFR requires every external component
  to be pinned to an exact immutable revision, and this repo contains no
  workflow that already pins `actions/checkout` or `actions/upload-artifact`, so
  the SHAs could not be read out of the codebase. **Resolved 2026-08-28** by
  reading each tag through the GitHub API: `actions/checkout` v4.2.2 =
  `11bd71901bbe5b1630ceea73d27597364c9af683`, `actions/upload-artifact` v4.4.3 =
  `b4b15b8c7c6ac21ea08fcf65892d2ee8f75cf882`. Both are written into
  `constants.ts` in T8, which is no longer blocked. `ci_generation_unit` still
  asserts a 40-character sha, so a regression to a placeholder fails the suite
  rather than reaching a user's repository.
- **The runner bundle is not built by `./scripts/dev.sh`. Decided by the user
  on 2026-08-28**, not defaulted to by this plan. The consequence is explicit
  and accepted: on a fresh clone the export refuses until someone runs `cd
  agent-runner && pnpm install && pnpm build`, and AC-5's message naming that
  command is the entire mitigation. Recorded as a decision so that a later
  reader who finds the refusal annoying knows it was weighed — the rejected
  alternative was a build step on every boot, which needs `pnpm install` in a
  package most sessions never touch and adds an ncc build to `dev.sh`.
- **No `setup-node` step.** Assumed: the GitHub-hosted `ubuntu-latest` image
  provides a Node with a global `fetch` (Node ≥18), which is all
  `agent-runner/src/github.ts:33` needs. This trades one pinned third-party
  action for a dependency on the hosted image's default Node. Revisit if the
  manual end-to-end run fails on the node version rather than on anything else.
- **`post_as` in the manifest rather than in the workflow's `env`.** The
  rejected alternative was `env: DEVDIGEST_POST_AS`, which
  `agent-runner/src/index.ts:25-33` already reads and which would need **zero**
  runner change. It was rejected because the workflow is user-editable and the
  manifest is what the spec calls the full configuration; the cost is a small
  change in Phase B (`runCi` prefers `manifest.post_as`). `DEVDIGEST_POST_AS`
  stays supported as the fallback, so the decision is reversible.
- **Trigger events are not carried in the manifest.** They are
  `on.pull_request.types` — the only place GitHub reads them — and AC-21 is
  stated about the generated workflow. Putting them in the manifest as well
  would create a second copy that nothing reads.
- **The bundle is committed as inline tree content.**
  `octokit.ts:289-299` passes each file's `contents` as a `content` string to
  `createTree`. The ncc bundle is a single large minified file; if GitHub
  rejects the request for size, the fallback is to create a blob per file
  (`git.createBlob`) and reference it by sha in the tree — a change contained
  entirely in `commitFiles`. Not planned for, because nothing in this repo shows
  it is needed; noted so the failure is recognisable.
