# Development Plan: Multi-Agent Review

Spec: docs/specs/cross/SPEC-04-multi-agent-review.md
Date: 2026-08-27
Execution mode: single-agent

## Goal

Let a reviewer pick an arbitrary subset of the workspace's agents, start them as
one identifiable group on one pull request, and read the group's results side by
side — per-agent panels with their own findings, score, duration, cost and trace,
the group's own totals, and a deterministically derived block showing the
locations where the participating agents disagreed. Estimates before the run come
from each agent's most recent successful run. No new model call anywhere.

## Out of scope

- The `Learn` and `Reply to author` finding actions in design ref 05
  (`actOnFinding` throws 400 for both today — `server/src/modules/reviews/findings.ts:32`).
- Multi-run history / a run selector / comparing two multi-agent reviews.
- A consensus verdict, a combined score, or any ranking of agents.
- Any change to how a finding is produced, grounded, accepted or dismissed.
- Presenting pre-existing (ungrouped) agent runs on the results surface.
- `POST /pulls/:id/review` and the `RunRequest` contract
  (`server/src/vendor/shared/contracts/platform.ts:278-282`) — left untouched;
  it stays the MCP path (`mcp/src/tools/run-agent-on-pr.ts`) and the `agentId` /
  `all:true` semantics do not change.
- Denormalising the agent name onto `agent_runs` (see Open questions).
- Any new `dependency-cruiser` / lint rule for the client layering.
- Architecture and security review (handled by separate review agents after
  implementation).

## Constraints

- **Handoff-sized task bullets** — `/impl` copies task lines verbatim into spawn
  prompts. Prefer `file:line` references over pasted schema or code blocks; if a
  single task bullet would exceed ~2 KB, point at the source file instead of
  embedding it.
- **Vendored contracts are copied, not linked.** There is no root `shared/`
  package — `Glob shared/**/*.ts` returns nothing. The only two copies are
  `server/src/vendor/shared/` and `client/src/vendor/shared/`
  (`mcp/` has its own `src/devdigest/wire.ts` and imports neither). Every
  contract edit must be applied to **both** files, identically.
- **The client may only `import type` from `@devdigest/shared`.** A value import
  makes Next's webpack resolve the barrel's `.js` specifiers and `pnpm build`
  fails outright while `typecheck` and `test:unit` stay green
  (`client/insights.md:57`). No `.parse()`/`.safeParse()` on a vendored contract
  client-side.
- **Migrations are not run on boot** — `cd server && pnpm db:migrate`
  (root `CLAUDE.md`). `server/src/db/migrations/` is do-not-touch by hand
  (`server/CLAUDE.md` Do-not-touch): generate with `pnpm db:generate`.
- **`drizzle-kit generate` hangs on a same-table add+remove diff**
  (`server/insights.md:46`). T3's schema change is **ADD COLUMN + CREATE INDEX
  only**, no removals, so it generates non-interactively. Do not combine it with
  any column removal.
- **Routes declare zod `body`/`params` via `fastify-type-provider-zod`** —
  never hand-roll `Schema.parse(req.body)` (`server/CLAUDE.md` Non-default
  conventions). Note the existing `POST /pulls/:id/review` violates this at
  `server/src/modules/reviews/routes.ts:32`; do not copy that shape into the new
  routes.
- **A static route segment must be registered before the `:id` route**
  (`server/insights.md:37`): `GET /agents/estimates` goes next to
  `GET /agents/stats` (`server/src/modules/agents/routes.ts:86`), above
  `GET /agents/:id` (`:91`).
- **Grep `contracts/` for a name before adding one** — a collision only surfaces
  at the barrel (`server/insights.md:38`). `MultiAgentRun`, `AgentColumn`,
  `Conflict`, `ConflictTake`, `AgentColumnFinding` already exist in
  `contracts/observability.ts:23-86` and have **zero consumers** outside the two
  contract files (verified by grep) — they are reshaped, not re-added.
- **`.it.test.ts` files must inject `secrets: new MockSecretsProvider()`** or a
  developer's real keys make paid network calls through
  `IntentService.ensure()` (`server/insights.md:53`; pattern at
  `server/test/reviews.it.test.ts:118-138`). DB-backed tests use the
  `*.it.test.ts` suffix; everything else stays hermetic (`server/CLAUDE.md`).
- **`waitForPrRuns` (`server/test/helpers/runs.ts:14`) throws on timeout** and is
  the only correct way to await the fire-and-forget review path
  (`server/src/modules/reviews/service.ts:133`).
- **`@testing-library/user-event` is not installed in `client/`** — use
  `fireEvent` (`client/insights.md:59`).
- **A `useMutation().mutate()` call does not invoke its `mutationFn`
  synchronously** — assert after an `await findBy*`/`waitFor`, never in the same
  tick as `fireEvent.click` (`client/insights.md:72`).
- **`Modal` applies zero padding to children; `Drawer` bakes in 24**
  (`client/insights.md:77`).
- **Append `id` as the final `orderBy` column whenever the sort key is not
  unique** (`server/insights.md:55`).
- Client tests are colocated `*.test.tsx` next to the component, Vitest + jsdom +
  RTL, `fetch` mocked (`client/CLAUDE.md`). Server tests live in `server/test/`
  and drive `app.inject()` against `buildApp()`
  (`server/test/routes-smoke.test.ts:13-20`).
- e2e flows are auto-discovered by `readdirSync(specs)` (`e2e/run.ts:93-94`) —
  no registry to update. Flows must stay read-only against the seeded
  `acme/payments-api` PR #482 and must never trigger a model call
  (`e2e/CLAUDE.md`).
- **`executeRuns` is a shared path — T15 changes behaviour for callers outside
  this feature.** `ReviewService.runReview` (`service.ts:133`) is the single
  entry to `executeRuns`, and it is reached today by the PR page's `all:true`
  trigger and by MCP's `run_agent_on_pr` (`mcp/src/tools/run-agent-on-pr.ts`)
  as well as by this feature's new group endpoint. After T15, a multi-agent
  `all:true` review runs its agents **concurrently instead of sequentially** on
  every one of those paths. Accepted deliberately (see Decision 7): the
  per-agent semantics `executeRuns` already guarantees — one shared diff and
  intent preparation, an isolated context and an isolated failure per agent, one
  `agent_runs` row and one trace per agent — are unchanged; only the interleaving
  is. Single-agent triggers (`{agentId}`) are unaffected, since they queue one
  job. This is the reason the Full block re-runs the whole server integration
  suite rather than only the new file.
- **Fan-out concurrency is bounded at 8** (`MULTI_AGENT_CONCURRENCY` in
  `modules/reviews/constants.ts` — `onion-architecture` quick decision table:
  *a literal: job kind, secret key, limit → ring 2, `constants.ts`*). This is
  cheap insurance against a provider 429, which would otherwise surface as a
  `failed` column carrying a rate-limit error — the exact "one agent's failure
  costs one column" outcome AC-11 exists to contain, but caused by us rather
  than by the provider. `p-queue@8` is already a direct dependency
  (`server/package.json:39`) and already the established bounded-fan-out tool in
  this codebase (`modules/context/service.ts:77`, `platform/jobs.ts:40`), so the
  bound costs three lines. It does **not** violate the NFR "this feature SHALL
  NOT define a time budget or a rate limit of its own": it is neither a deadline
  nor a request-rate cap, every selected agent still runs, and no call is
  refused. The trade-off it does carry: a selection of more than 8 agents runs in
  waves, so its wall-clock exceeds the slowest agent and AC-9's max-based
  estimate under-states it. Accepted — no workspace in this starter has 8 agents,
  and design ref 03 draws 5.

## Entry points & duplicate registries

Every list that enumerates the same keys as something this plan adds, and where
it is covered:

- **Sidebar nav.** `NAV` in `client/src/vendor/ui/nav.ts:21-47` has **no
  `multi-agent` item** — the current groups are `WORKSPACE` (pulls, context) and
  `SKILLS LAB` (skills, agents, conventions, eval). It is the single source for
  the sidebar (`vendor/ui/shell/Sidebar.tsx:45`), the command palette
  (`components/app-shell/hooks/useShellCommands.ts:21-27`) and the `g`-chord
  shortcuts (`useGlobalShortcuts.ts:45`, `SHORTCUTS` derived at `nav.ts:73-75`),
  so **one entry covers all three**. Covered by **T18**.
  - `activeKeyFor` already maps `/multi-agent` → `multi-agent`
    (`client/src/components/app-shell/helpers.ts:28`) — **checked, no change**.
  - `client/messages/en/shell.json:26` already has `nav["multi-agent"]`, which is
    what `useShellCommands.ts:24` resolves via `t('nav.${it.key}')` — **checked,
    no change**. (`Sidebar.tsx` renders the hardcoded `item.label` from `NAV`
    while the palette renders the i18n value: a pre-existing label duplication.
    T18 must set both to `"Multi-Agent Review"`.)
- **PR-detail `?tab=` whitelist.** `client/src/app/repos/[repoId]/pulls/[number]/page.tsx:62`
  reads `search.get("tab") ?? "overview"` with **no whitelist array**, and the
  tab list is inline at `_components/PrDetailHeader/PrDetailHeader.tsx:115-120`.
  This plan adds no PR tab — **checked, not affected**. (Recorded because
  `client/insights.md:73` documents exactly this pair silently swallowing a new
  key.)
- **New `?view=` mode whitelist (results surface).** This plan introduces the
  same failure mode `client/insights.md:42,73` describes. **T30 must derive the
  whitelist from the mode list in one file** (`VIEW_MODES` in
  `multi-agent/[prId]/_components/constants.ts`, with
  `isViewMode = (v) => VIEW_MODES.some(m => m.key === v)` exported from the same
  file and used by `page.tsx`) so the two lists cannot diverge. Structural fix,
  not an extra file in a task's list.
- **Hook barrel.** `client/src/lib/hooks/index.ts:4-16` is a hand-kept list of
  hook files. The new `multi-agent.ts` must be added — covered by **T19**.
- **i18n namespaces.** Auto-discovered by `readdirSync` in
  `client/src/i18n/request.ts:19-23` — **checked, no registry**.
- **e2e flow list.** Auto-discovered (`e2e/run.ts:93-94`) — **checked, no
  registry**.
- **Server route registration.** Fastify plugins are autoloaded per module
  (`server/CLAUDE.md`); the new routes are added inside the existing
  `reviews`/`agents` plugins — **checked, no module registry to touch**.
- **`SEV_COLOR`.** Three consumers today: `FindingCard.tsx:22`,
  `SmartDiffViewer.tsx:13`, `RunTraceDrawer/_components/FindingsSection.tsx:11`,
  all importing the route-local `_components/constants.ts:7`. T22 moves the
  values to `client/src/lib/severity.ts` and makes `_components/constants.ts`
  re-export them, so no consumer import path changes except the two that move.
- **`zonesOverlap` / `normalizeZonePath`.** Only consumers today are inside
  `server/src/modules/evals/scoring.ts` itself (`:37`, `:54`) and
  `server/test/eval-scoring.test.ts`. T4 moves them and T5 re-exports from
  `scoring.ts`, so the existing test file needs no edit.

## Affected modules & files

**server**

- `src/vendor/shared/contracts/observability.ts` — reshape `AgentColumn`,
  `Conflict`, `ConflictTake`; delete `AgentColumnFinding`; add
  `MultiAgentRunRequest`, `AgentEstimate`.
- `src/db/schema/runs.ts` — `agent_runs.multi_agent_run_id`,
  `agent_runs.finished_at`, index on the FK.
- `src/db/migrations/` — generated only.
- `src/modules/_shared/zones.ts` — new; the location heuristic, shared by
  `evals` and `reviews`.
- `src/modules/evals/scoring.ts` — re-export the moved helpers.
- `src/modules/reviews/multi-agent.ts` — new; pure conflict derivation.
- `src/modules/reviews/helpers.ts` — `agentColumnFromRun` mapper.
- `src/modules/reviews/repository/run.repo.ts`, `repository/review.repo.ts`,
  `repository.ts` — group + estimate queries.
- `src/modules/reviews/service.ts` — `resolveTargets` widened,
  `startMultiAgentReview`, `multiAgentForPull`.
- `src/modules/reviews/run-executor.ts` — concurrent agent execution.
- `src/modules/reviews/routes.ts` — `POST /pulls/:id/multi-agent-run`,
  `GET /pulls/:id/multi-agent`.
- `src/modules/agents/routes.ts`, `src/modules/agents/service.ts` —
  `GET /agents/estimates`.

**client**

- `src/vendor/shared/contracts/observability.ts` — byte-identical re-sync.
- `src/vendor/ui/nav.ts` — the `multi-agent` nav item.
- `src/lib/severity.ts` — new; promoted `SEV_COLOR`.
- `src/lib/agent-estimates.ts` — new; pure aggregate estimate.
- `src/lib/hooks/multi-agent.ts`, `src/lib/hooks/index.ts` — new hooks + barrel.
- `src/components/finding-card/**`, `src/components/run-trace-drawer/**` —
  promoted from the PR route.
- `src/app/repos/[repoId]/pulls/[number]/page.tsx`,
  `_components/FindingsPanel/FindingsPanel.tsx`,
  `_components/DiffTab/_components/SmartDiffViewer/SmartDiffViewer.tsx`,
  `_components/constants.ts` — import updates.
- `src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/**` —
  the agent picker.
- `src/app/multi-agent/**` — new configure-run and results routes.
- `messages/en/runs.json`, `messages/en/prReview.json` — copy.

**e2e**

- `specs/15-multi-agent-configure-run.flow.json`,
  `specs/16-pr-agent-picker.flow.json` — new flows.

## Placement decisions

Each traces to a preloaded skill's rule, not preference.

1. **The disagreement block is computed server-side**, in
   `server/src/modules/reviews/multi-agent.ts` (ring 2, pure), and shipped on
   `MultiAgentRun.conflicts`. Reasons, in order of weight:
   - The client cannot do it. Location grouping needs `end_line`; the client may
     only `import type` from the vendored barrel and cannot run a schema
     (`client/insights.md:57`), and the heuristic
     (`normalizeZonePath`/`zonesOverlap`, `server/src/modules/evals/scoring.ts:28,36`)
     exists only server-side. Duplicating it into the client would create a
     second, drifting copy of the rule the NFR requires to be deterministic.
   - `onion-architecture` "Quick decision table": *turning a row into an API
     shape → ring 2, `helpers.ts` (pure)*. The derivation is a pure transform
     over contract types with no HTTP and no SQL, so it is ring 2 — a sibling
     file of `helpers.ts`, kept separate only for size.
   - The drafted contract already places `conflicts` on `MultiAgentRun`
     (`contracts/observability.ts:84`).
   - The workspace-scoping NFR is satisfied by construction: the rows are derived
     from findings already fetched through a workspace-scoped read.
2. **The location heuristic moves to `server/src/modules/_shared/zones.ts`.**
   `onion-architecture` forbids nothing about a ring-2 → ring-2 cross-module
   import, but `server/insights.md:36` records the cost of leaving a shared
   accessor inside one module (two independent paths against the same concept).
   `modules/_shared/` already exists (`context.ts`, `schemas.ts`) and is the
   established home for cross-module module-layer code. `scoring.ts` re-exports
   so `server/test/eval-scoring.test.ts` is untouched.
3. **`GET /agents/estimates` lives in the `agents` module, its query in
   `reviews/repository/run.repo.ts`.** Exact precedent: `AgentsService.stats`
   already reaches `this.container.reviewRepo.runStatsByAgent(workspaceId)`
   (`server/src/modules/agents/service.ts:77`) for the same class of per-agent
   run rollup. `onion-architecture`: *a SQL query, in any form → ring 3,
   `repository.ts`*; the use case ("what should each agent be expected to cost")
   is an agents-list concern and both selection surfaces need it.
   `AgentsService` is one of the four grandfathered `Container`-taking services,
   so it keeps that constructor — do not "fix" it here.
4. **`RunTraceDrawer` and `FindingCard` move to `client/src/components/`.**
   `frontend-ui-architecture` rule 2: *a feature may not import from a sibling
   feature*; the placement ladder says move outward *when a second, unrelated
   consumer actually appears* — `/multi-agent/[prId]` is that consumer (AC-12,
   AC-17). They are not `vendor/ui` material: both speak domain vocabulary
   (`FindingRecord`, `useRunTrace`, `useRunEvents`), and the skill's rung-4 test
   is *"must not know your domain"*. `client/src/components/` is the repo's own
   home for exactly this (`eval-case-dialog/`, `diff-viewer/`, `run-cost/`,
   `context-attach/`), and `client/insights.md:52` states the rule the promotion
   satisfies. `SEV_COLOR` must move with them (`client/src/lib/severity.ts`),
   because a shared component importing from `src/app/**` would invert the
   dependency direction.
5. **`aggregateEstimate` is a pure client module at
   `client/src/lib/agent-estimates.ts`.** Two consumers on two different routes
   (the PR picker and the configure-run surface), no React, no domain state —
   `frontend-ui-architecture` "Where business logic goes": *rules → plain
   TypeScript modules with no React import*. Matches the repo's own precedent
   (`client/src/lib/diff-lines.ts` + `diff-lines.test.ts`,
   `client/src/lib/drag-list.ts`).
6. **A new `POST /pulls/:id/multi-agent-run`, not a widened `RunRequest`.**
   The spec's Contracts section binds *"a run started outside a multi-agent
   review belongs to no group and is never part of one"*. A dedicated endpoint
   makes that structural: it is the only writer of `multi_agent_runs`, so a
   grouped run cannot be started by accident and an ungrouped subset run cannot
   be started at all. It also leaves `RunRequest`
   (`contracts/platform.ts:278-282`) and its MCP consumer untouched. The
   `agentIds` widening happens where it is actually needed —
   `ReviewService.resolveTargets` (`service.ts:46-57`), ring 2, shared by both
   entry points. See Recommendations in the report for the trade-off against the
   pre-spec hypothesis.
7. **Concurrent agent execution is in scope (T15/T16) — settled, do not
   reopen.** `run-executor.ts:143` is a sequential `for … await` loop today, and
   strictly speaking no `AC-N` fails against it. It is in scope anyway because
   three separate parts of the approved spec presuppose it and read as defects
   without it:
   - the Goals list: *"Run the selected agents as one group, **in parallel**,
     isolated from each other"*;
   - design ref 03, whose aggregate estimate reads `≈ 8.2s · $0.20 · parallel
     fan-out` for four agents whose individual durations are 8.2 / 7.4 / 6.9 /
     7.1 — a number only reachable concurrently, and design ref 04, which prints
     `8.2s total` for that same group;
   - **AC-9**, which requires the aggregate duration to be the **greatest** of
     the per-agent estimates, not their sum. Under sequential execution that
     estimate is wrong by construction on every multi-agent selection, and
     AC-16 — which forbids adjusting the presented figures "toward any expected
     relationship between them" — guarantees the resulting discrepancy is shown
     to the user rather than smoothed away. Delivering AC-9 and AC-16 honestly
     therefore requires the execution model they describe.
   The shared-path and provider-rate-limit consequences are recorded in
   Constraints above; the bound is 8.

## Contract shape (frozen before implementation)

Applied identically to `server/src/vendor/shared/contracts/observability.ts` and
`client/src/vendor/shared/contracts/observability.ts`. Deltas against the file as
it stands at `observability.ts:22-86`:

- **Delete `AgentColumnFinding`** (`:23-32`). It is a lossy subset (no
  `rationale`, `suggestion`, `confidence`, `end_line`, `accepted_at`,
  `dismissed_at`) that cannot feed `FindingCard`'s accept / dismiss /
  turn-into-eval-case actions (AC-17) or the verbatim rendering AC-15 requires.
  Zero consumers — verified by grep.
- **`AgentColumn`**: `findings: z.array(FindingRecord)` (imported from
  `./review-api.js`); add `agent_description: z.string().nullable()` (the panel's
  one-line description, Contracts) and `error: z.string().nullable()` (AC-11's
  reason). `status` stays `z.enum(['done','failed','running'])`; a DB
  `cancelled` row maps to `failed` carrying its recorded reason (see Open
  questions).
- **`ConflictTake`**: `{ agent_id, agent_name: z.string().nullable(), verdict:
  z.union([Severity, z.literal('ignored')]), note: z.string().nullable() }`.
  `persona` is dropped (it duplicated the agent name). `note` becomes
  **nullable** and carries the agent's own finding title **verbatim**, or `null`
  when `verdict === 'ignored'` — the "did not flag" marker is client copy
  (`runs.json` `conflicts.didNotFlag`), so the server never ships English prose
  and never generates a rationale (AC-19, Non-goals).
- **`Conflict`**: **remove `title`** (`:69`) — the spec resolves that a row has
  *no synthesized label* and is identified by its location alone. Replace
  `line: z.number().int()` with `start_line` / `end_line` (a location is a file
  plus a line **range**). Add `is_conflict: z.boolean()` so AC-20's rule is
  evaluated once, server-side, and AC-22's filter cannot re-derive it
  differently.
- **`MultiAgentRun`**: unchanged fields keep their names. `total_duration_ms`
  is the group's wall-clock (NFR), not a sum.
- **New `MultiAgentRunRequest`** = `z.object({ agent_ids:
  z.array(z.string().uuid()).min(1) })`. The `.min(1)` is AC-2's server half.
- **New `AgentEstimate`** = `z.object({ agent_id: z.string(), duration_ms:
  z.number().int().nullable(), cost_usd: z.number().nullable() })`. Duration and
  cost are independently nullable: an agent whose last successful run recorded no
  cost has an unavailable **cost** estimate, never zero (AC-8, Edge cases).

## Tasks

### Contracts & schema

- [ ] T1 Reshape `contracts/observability.ts` exactly as **Contract shape** above
      (delete `AgentColumnFinding`; reshape `AgentColumn`/`Conflict`/`ConflictTake`;
      add `MultiAgentRunRequest`, `AgentEstimate`); `import { FindingRecord } from './review-api.js'`
      — `server/src/vendor/shared/contracts/observability.ts` — owner: `implementer`
      — skill: `zod` — → AC-18 → `multi_agent_conflicts`
- [ ] T2 Copy T1's file byte-for-byte into the client vendor copy; verify with a
      diff that the two files are identical — `client/src/vendor/shared/contracts/observability.ts`
      — owner: `implementer` — skill: `zod` — → AC-18 → `multi_agent_conflicts`
- [ ] T3 Add `multiAgentRunId: uuid('multi_agent_run_id').references(() => multiAgentRuns.id, { onDelete: 'set null' })`
      and `finishedAt: timestamp('finished_at', { withTimezone: true })` to
      `agentRuns` (`runs.ts:8-35`), plus an explicit index on
      `multi_agent_run_id` (Postgres does not auto-index FK columns). Both
      nullable — every row already on disk has neither. `set null`, not
      `cascade`: deleting a group must not delete its runs. Then run
      `cd server && pnpm db:generate` (ADD-only diff, no interactive prompt) and
      `pnpm db:migrate`; commit the generated SQL unedited —
      `server/src/db/schema/runs.ts`, `server/src/db/migrations/` — owner: `implementer`
      — skill: `drizzle-orm-patterns` + `postgresql-table-design` — → AC-13 → `multi_agent_it`

### Server — grouping heuristic and conflict derivation

- [ ] T4 Move `Zone`, `normalizeZonePath`, `zonesOverlap` verbatim out of
      `evals/scoring.ts:17-43` into a new pure module; no behaviour change —
      `server/src/modules/_shared/zones.ts` — owner: `implementer`
      — skill: `typescript-expert` — → AC-18 → `multi_agent_conflicts`
- [ ] T5 Re-export the three moved symbols from `evals/scoring.ts` so
      `server/test/eval-scoring.test.ts` (imports them at `:6-10`) keeps passing
      unchanged — `server/src/modules/evals/scoring.ts` — owner: `implementer`
      — skill: `onion-architecture` — → AC-18 → `eval-scoring.test.ts` (exists;
      no new test — this task is proven by the existing file staying green)
- [ ] T6 New pure ring-2 module deriving the disagreement block from the group's
      columns. `buildConflicts(columns: AgentColumn[]): Conflict[]`:
      (a) participants = columns with `status === 'done'`; every other column is
      excluded from every row and from conflict determination (AC-21);
      (b) cluster every participant finding by greedy interval merge — sort by
      `(normalizeZonePath(file), start_line, end_line, id)`, then extend the open
      cluster while the next finding `zonesOverlap`s its current range (so
      1-5 / 5-10 / 10-15 in one file form one location; non-overlapping ranges
      form separate rows);
      (c) one take per participant: none in the cluster → `verdict: 'ignored'`,
      `note: null`; otherwise the **most severe** finding's severity **and that
      same finding's title verbatim** (CRITICAL > WARNING > SUGGESTION, ties
      broken by the agent's own produced order) — no truncation, no markdown
      stripping, no sentence extraction (AC-19);
      (d) `is_conflict` = at least one participant flagged while another
      participant produced none, OR two participants flagged with different
      severities (AC-20);
      (e) rows ordered by `(file, start_line)`, takes ordered by the column order
      they were given in.
      Zero runtime imports beyond `_shared/zones.js` and contract types —
      `server/src/modules/reviews/multi-agent.ts` — owner: `implementer`
      — skill: `onion-architecture` — → AC-18, AC-19, AC-20, AC-21 → `multi_agent_conflicts`
- [ ] T7 `test_writer`: pure unit tests for T6 covering — one row per location
      including a location only one agent flagged; one take per **successful**
      participant and for no other agent (AC-18); a take carries the agent's own
      title verbatim, including a title containing `**`, `<b>` and a newline, and
      an `ignored` take carries `note: null` (AC-19); the AC-20 truth table
      (flagged-vs-silent → conflict, differing severities → conflict, same
      severity from every participant → **not** a conflict); a `failed` column
      contributes no take anywhere and does not make a row a conflict (AC-21);
      an agent with two findings at one location takes severity **and** title
      from the single most severe one; two runs over the same input produce
      identical row order and take order (the determinism NFR) —
      `server/test/multi-agent-conflicts.test.ts` — owner: `test-writer`
      — skill: `typescript-expert` — → AC-18, AC-19, AC-20, AC-21 → `multi_agent_conflicts`

### Server — persistence and reads

- [ ] T8 Repository functions (ring 3): `createMultiAgentRun(db, {workspaceId, prId})`;
      `latestMultiAgentRunForPull(db, workspaceId, prId)` (order
      `ranAt DESC, id DESC` — AC-13); `runsForMultiAgentRun(db, groupId)` joined
      to `agents.name`/`agents.description`; `lastSuccessfulRunByAgent(db, workspaceId)`
      using `DISTINCT ON (agent_id) … WHERE status='done' ORDER BY agent_id, ran_at DESC, id DESC`
      returning `{agentId, durationMs, costUsd}` — **not** `runStatsByAgent`
      (`run.repo.ts:23-46`), which is a run count plus a mean cost and carries no
      duration at all. Extend `createAgentRun` (`:161-184`) with an optional
      `multiAgentRunId`, and `completeAgentRun` (`:186-225`) to set
      `finishedAt: new Date()` — `server/src/modules/reviews/repository/run.repo.ts`
      — owner: `implementer` — skill: `drizzle-orm-patterns` — → AC-7 → `multi_agent_it`
- [ ] T9 `reviewsByRunIds(db, runIds)` returning each review with its findings,
      so a group's columns are read in one round trip —
      `server/src/modules/reviews/repository/review.repo.ts` — owner: `implementer`
      — skill: `drizzle-orm-patterns` — → AC-13 → `multi_agent_it`
- [ ] T10 Expose T8/T9's functions as methods on the composing facade, matching
      the existing delegation style at `repository.ts:94-127` —
      `server/src/modules/reviews/repository.ts` — owner: `implementer`
      — skill: `onion-architecture` — → AC-13 → `multi_agent_it`
- [ ] T11 Pure mapper `agentColumnFromRun(run, agentName, agentDescription, review, findings): AgentColumn`
      — reuse `findingRowToDto` (`helpers.ts:34-53`) for `findings`; map DB
      status `cancelled` → `'failed'` carrying its recorded `error`; `score`,
      `duration_ms`, `cost_usd` copied **as recorded**, no rounding and no
      derivation from each other (AC-16) —
      `server/src/modules/reviews/helpers.ts` — owner: `implementer`
      — skill: `typescript-expert` — → AC-16 → `multi_agent_it`
- [ ] T12 Widen `resolveTargets` (`service.ts:46-57`) with `agentIds?: string[]`:
      resolve each id workspace-scoped via `this.agents.getById`, 404 on any
      miss, and return them **in the order given** (panel order, Contracts);
      `all` and `agentId` behaviour unchanged. Add
      `startMultiAgentReview(workspaceId, prId, agentIds, logger)` — creates one
      `multi_agent_runs` row, then delegates to the existing `runReview`
      (`:103-138`) so every agent run carries that group id — and
      `multiAgentForPull(workspaceId, prId): MultiAgentRun | null` — latest group,
      its runs → columns via T11, `conflicts` via T6, `agent_count` = column
      count, `total_cost_usd` = summed recorded costs (null costs skipped),
      `total_duration_ms` = `max(finished_at) − group.ran_at` once every run is
      terminal, else `now − group.ran_at`; **never** a sum of run durations (NFR)
      — `server/src/modules/reviews/service.ts` — owner: `implementer`
      — skill: `onion-architecture` — → AC-6, AC-13, AC-16 → `multi_agent_it`
- [ ] T13 Two routes on the existing reviews plugin, both calling
      `getContext(container, req)` first and both guarded by
      `service`'s workspace-scoped `getPull`: `POST /pulls/:id/multi-agent-run`
      with `schema: { params: IdParams, body: MultiAgentRunRequest }` and
      `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }` (mirroring
      `routes.ts:29`, since one call fans out to N LLM runs), returning
      `{ multi_agent_run_id, runs }`; and `GET /pulls/:id/multi-agent` with
      `schema: { params: IdParams }`, returning the `MultiAgentRun` or `null`.
      Use the zod `schema:` option — do **not** copy the hand-rolled
      `RunRequest.parse(req.body ?? {})` at `routes.ts:32` —
      `server/src/modules/reviews/routes.ts` — owner: `implementer`
      — skill: `fastify-best-practices` — → AC-2, AC-6, AC-13 → `multi_agent_it`
- [ ] T14 `GET /agents/estimates` → `AgentEstimate[]`, one entry per workspace
      agent, from T8's `lastSuccessfulRunByAgent` via
      `this.container.reviewRepo` (same shape as `service.ts:74-81`). Agents with
      no successful run get `{duration_ms: null, cost_usd: null}`; a successful
      run with a null `cost_usd` yields a null cost with a non-null duration.
      Register it immediately after `GET /agents/stats` (`routes.ts:86`) and
      before `GET /agents/:id` (`:91`) —
      `server/src/modules/agents/routes.ts`, `server/src/modules/agents/service.ts`
      — owner: `implementer` — skill: `fastify-best-practices` — → AC-7, AC-8 → `multi_agent_it`
- [ ] T15 Run the group's agents **concurrently**. Replace the sequential
      `for (const { agent, runId } of jobs)` loop at `run-executor.ts:143-170`
      with a bounded fan-out: `const queue = new PQueue({ concurrency:
      MULTI_AGENT_CONCURRENCY });` then
      `await queue.addAll(jobs.map(({agent, runId}) => async () => { … }))`,
      moving the existing body in unchanged — the per-agent try/catch, the per-run
      `parentLog.forRun(runId)` narrowing (`:188`), the `agentStart` timing and
      the per-agent success/failure logging all stay exactly as they are, so a
      per-agent failure is still isolated and still never aborts a sibling.
      Shared diff (`:116`) and intent (`:132`) preparation stays once, before the
      fan-out. Add `export const MULTI_AGENT_CONCURRENCY = 8;` to
      `constants.ts` with a comment pointing at the Constraints entry explaining
      the bound. `p-queue` is already imported this way at
      `modules/context/service.ts:77` — copy that shape. Read the two Constraints
      entries on the shared path and the bound before starting; both consequences
      are accepted and neither is to be re-litigated here —
      `server/src/modules/reviews/run-executor.ts`,
      `server/src/modules/reviews/constants.ts` — owner: `implementer`
      — skill: `typescript-expert` — → AC-16 → `run_executor_parallel`
- [ ] T16 `test_writer`: hermetic unit test that **distinguishes concurrent from
      sequential execution**, so a future refactor back to a `for … await` loop
      fails here rather than passing silently. Two mock agents whose
      `MockLLMProvider.completeStructured` blocks on a shared barrier that
      releases only once **both** agents have entered it; drive `executeRuns`
      with both jobs and assert it settles. Against the sequential loop the
      second agent never enters, the barrier never releases and the test times
      out; against T15 both enter and it passes. Add a second assertion that the
      two agents' recorded `agent_runs` intervals overlap
      (`start₂ < finish₁`), so the test states the property in the output rather
      than only as a deadlock. Keep the fixture at 2 agents — well under
      `MULTI_AGENT_CONCURRENCY` (8), so the bound cannot mask the assertion.
      Also assert both runs reach a terminal status, i.e. bounding the fan-out
      did not drop a job — `server/test/run-executor-parallel.test.ts`
      — owner: `test-writer` — skill: `typescript-expert` — → AC-16 → `run_executor_parallel`
- [ ] T17 `test_writer`: DB-backed integration tests via `app.inject()` against
      `buildApp()`, following `server/test/reviews.it.test.ts:104-138` including
      `secrets: new MockSecretsProvider()`, and awaiting background runs with
      `waitForPrRuns`. Cover — starting with a 2-of-3 selection creates exactly
      two `agent_runs` rows, both carrying the new group id, and the third agent
      has none (AC-6); a `POST` with `agent_ids: []` is rejected 400 without
      creating any run (AC-2); one agent resolving to an unconfigured provider
      comes back `status: 'failed'` with a non-empty `error` while the other
      column is `done` with its findings intact (AC-11); `GET /pulls/:id/multi-agent`
      returns the **most recently started** of two groups for the same PR
      (AC-13); **a regression fixture in the OLD shape** — insert `agent_runs`
      rows with `multi_agent_run_id` and `finished_at` left NULL, exactly as
      every row already on disk looks, and assert `GET /pulls/:id/multi-agent`
      returns the empty result rather than adopting them into a group (AC-14,
      Edge cases "Runs that predate this feature"); `GET /agents/estimates`
      returns the **most recent successful** run's duration and cost for an agent
      with an older cheap success and a newer expensive success, ignores a later
      **failed** run (persisted with `durationMs: 0`, `costUsd: null`), returns
      nulls for an agent whose only run failed (AC-7, AC-8), and returns a
      non-null duration with a null cost for a successful run that recorded none
      — `server/test/multi-agent.it.test.ts` — owner: `test-writer`
      — skill: `fastify-best-practices` — → AC-2, AC-6, AC-7, AC-8, AC-11, AC-13, AC-14 → `multi_agent_it`

### Client — shared plumbing

- [ ] T18 Add the nav item to `NAV` (`nav.ts:21-47`) in a new `GLOBAL` group
      after `SKILLS LAB`: `{ key: "multi-agent", label: "Multi-Agent Review",
      icon: "Users", href: "/multi-agent" }`. No `gKey` (avoid colliding with the
      existing chords at `:25-44`). `activeKeyFor` (`helpers.ts:28`) and
      `shell.json:26` already carry this key — do not touch either —
      `client/src/vendor/ui/nav.ts` — owner: `implementer`
      — skill: `frontend-ui-architecture` — → AC-4 → `e2e_multi_agent_configure_run`
- [ ] T19 New TanStack Query hooks, and add `export * from "./multi-agent";` to
      the barrel (`index.ts:4-16`): `useAgentEstimates()` → `GET /agents/estimates`;
      `useMultiAgentRun(prId)` → `GET /pulls/:id/multi-agent`, polling every 4s
      while any column is `running` (mirroring `usePrRuns`, `reviews.ts:46-48`);
      `useStartMultiAgentReview()` → `POST /pulls/:id/multi-agent-run`,
      invalidating `["multi-agent", prId]` and `["pr-active-runs", prId]` on
      success. `import type` only from `@devdigest/shared` —
      `client/src/lib/hooks/multi-agent.ts`, `client/src/lib/hooks/index.ts`
      — owner: `implementer` — skill: `next-best-practices` — → AC-13 → `multi_agent_results`
- [ ] T20 Pure `aggregateEstimate(selectedAgentIds, estimates): { duration_ms:
      number | null; cost_usd: number | null; complete: boolean }` — duration is
      the **greatest** available per-agent duration, cost the **sum** of the
      available per-agent costs, `complete` false when any selected agent is
      missing either figure (AC-8, AC-9). No React import —
      `client/src/lib/agent-estimates.ts` — owner: `implementer`
      — skill: `typescript-expert` — → AC-9 → `agent_estimates`
- [ ] T21 `test_writer`: unit tests for T20 — max/sum over three agents;
      `complete: false` and the remaining figures still computed when one agent
      has no estimate; `complete: false` when an agent has a duration but a null
      cost; a single-agent selection whose aggregate equals that agent's own; an
      empty selection —
      `client/src/lib/agent-estimates.test.ts` — owner: `test-writer`
      — skill: `react-testing-library` — → AC-8, AC-9 → `agent_estimates`
- [ ] T22 Move `SEV_COLOR`/`SEV_COLOR_FALLBACK` (`_components/constants.ts:7-15`)
      into a new shared module and make `_components/constants.ts` re-export them
      so `SmartDiffViewer.tsx:13` needs no edit —
      `client/src/lib/severity.ts`,
      `client/src/app/repos/[repoId]/pulls/[number]/_components/constants.ts`
      — owner: `implementer` — skill: `frontend-ui-architecture` — → AC-17 → `finding_card_actions`
- [ ] T23 Move the `RunTraceDrawer` folder (component, `constants.ts`,
      `helpers.ts`, `styles.ts`, `index.ts` and the whole `_components/` subtree)
      to `client/src/components/run-trace-drawer/RunTraceDrawer/`, and the
      `FindingCard` folder to `client/src/components/finding-card/FindingCard/`.
      Repoint `FindingsSection.tsx:11` and `FindingCard.tsx:22` at
      `@/lib/severity`; repoint `page.tsx:18` and `FindingsPanel.tsx:10` at the
      new paths; convert `FindingCard.tsx:24`'s
      `../../../../../../../lib/github-urls` to `@/lib/github-urls`. Public props
      unchanged — `RunTraceDrawer` keeps `runId`/`agentName`/`prNumber`/
      `findings`/`running`/`onClose` (`RunTraceDrawer.tsx:19-29`) —
      `client/src/components/run-trace-drawer/**`, `client/src/components/finding-card/**`,
      `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`,
      `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx`
      — owner: `implementer` — skill: `frontend-ui-architecture` — → AC-12, AC-17 → `run_trace_drawer_moved`
- [ ] T24 `test_writer`: move `RunTraceDrawer.test.tsx` and `FindingCard.test.tsx`
      alongside their components, fixing the deep relative `messages/en/*.json`
      imports (currently 8 levels up, `RunTraceDrawer.test.tsx:5`). Keep every
      existing assertion — including the hand-built `RunTrace` fixture, which
      must continue to carry `specs_excluded` (`client/insights.md:38`). Add one
      assertion to `FindingCard.test.tsx` that the expanded card renders exactly
      three action buttons — Accept, Dismiss, Turn into eval case — and no
      `Learn` or `Reply to author` control (AC-17) —
      `client/src/components/run-trace-drawer/RunTraceDrawer/RunTraceDrawer.test.tsx`,
      `client/src/components/finding-card/FindingCard/FindingCard.test.tsx`
      — owner: `test-writer` — skill: `react-testing-library` — → AC-12, AC-17 → `run_trace_drawer_moved`, `finding_card_actions`

### Client — copy

- [ ] T25 Rewrite the stale `page.*` block in `runs.json:115-139`, which predates
      this spec: delete `runAll`, `noAgents` and `noRun.cta` (nothing runs "every
      enabled agent" any more); rewrite `subtitle` and `noRun.bodyReady` to the
      chosen-subset wording; rewrite `meta` — it names an internal
      implementation detail (p-queue) that has no place in user copy — as
      `"{count} agents · {duration} total · {cost}"`. Add
      `page.configure.*` (design ref 02/03 copy: `"Run a Multi-Agent Review"`,
      `"Pick a pull request first"`, `"Agents to run"`, `"Select all"`,
      `"Run multi-agent review ({count})"`), `page.results.*`
      (`"No multi-agent review yet"` + a body offering to configure one, for
      AC-14), `page.estimate.unavailable` (`"—"` per agent) and
      `page.estimate.incomplete`. Extend `conflicts.*` (`:10-15`) with
      `emptyAll` for a group whose participants produced no findings at all;
      `conflicts.didNotFlag` (`:14`) is the AC-19 marker and keeps its value.
      Extend `column.*` (`:6-9`) with `state.running`/`state.done`/`state.failed`
      text labels (the NFR requiring every state to be conveyed by text, not only
      icon or colour) and `announce` for AC-23's live region.
      Add `runReview.pickAgents` (`"Pick agents to run"`), `runReview.clear`
      (`"Clear"`) and `runReview.runMultiAgent` (`"Run multi-agent review ({count})"`)
      to `prReview.json`'s `runReview` block (`:35-42`); leave `runAll`,
      `runReview`, `configureAgents`, `mergedWarning`, `mergedTooltip` in place —
      `client/messages/en/runs.json`, `client/messages/en/prReview.json`
      — owner: `implementer` — skill: `next-best-practices` — → AC-14 → `multi_agent_results`

### Client — the PR picker (AC-1, AC-2, AC-3)

- [ ] T26 Replace `RunReviewDropdown`'s `Dropdown` menu (`RunReviewDropdown.tsx:84-99`)
      with the multi-select picker of design ref 01. Build it in this folder
      rather than extending `vendor/ui/kit/Dropdown.tsx`, which accepts only
      `DropdownItemDef[]` (`Dropdown.tsx:62-72`) and whose trigger is a
      `<div onClick>` with no keyboard handling. Shape: a `<button
      aria-expanded aria-haspopup="true">` trigger keeping the `Run Review`
      label; a popover headed `runReview.pickAgents` with a `Clear` link; one
      `Checkbox` per agent from `useAgents()` (every agent, matching the current
      `:51-61` behaviour) whose accessible name is the agent's own name (NFR);
      each row showing that agent's estimate from `useAgentEstimates()` as text,
      or `page.estimate.unavailable` (AC-7, AC-8); a primary
      `runReview.runMultiAgent` button **disabled while zero agents are
      selected** (AC-2); and the existing `configureAgents` footer link. Escape
      and outside-click close it; Tab reaches every control (NFR). On submit call
      `useStartMultiAgentReview`, then `onRunsStarted(res.runs.map(r => r.run_id))`
      — the PR page already turns that into live `RunStatus` without navigating
      (`page.tsx:170`, `PrDetailHeader.tsx:35-37`), which is AC-3. When
      `useAgents()` returns none, render the "no agent available" statement in
      place of the list with the run control still disabled (Edge cases) —
      `client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/RunReviewDropdown.tsx`,
      `.../RunReviewDropdown/styles.ts`, `.../RunReviewDropdown/constants.ts`
      — owner: `implementer` — skill: `react-best-practices` + `accessibility-requirements`
      — → AC-1, AC-2, AC-3 → `pr_agent_picker`
- [ ] T27 `test_writer`: extend the existing smoke test (`RunReviewDropdown.test.tsx`,
      which mocks `next/navigation`, `hooks/agents` and `hooks/reviews` at
      `:6-14`). Assert — opening the trigger renders one checkbox per agent, each
      named for its agent (AC-1); the run control is disabled with zero selected
      and enabled after one is checked (AC-2); `Clear` returns it to disabled;
      each agent row renders its estimate, and `—` for an agent with none (AC-7,
      AC-8); submitting calls the mocked mutation with exactly the checked ids
      and then `onRunsStarted` with the returned run ids, while `router.push` is
      never called (AC-3); with `useAgents()` empty, the no-agents statement
      renders and the control stays disabled. Use `fireEvent`, and assert on the
      mutation only after an `await waitFor` —
      `client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/RunReviewDropdown.test.tsx`
      — owner: `test-writer` — skill: `react-testing-library` — → AC-1, AC-2, AC-3, AC-7, AC-8 → `pr_agent_picker`

### Client — the configure-run surface (AC-4, AC-5)

- [ ] T28 New route rendering design ref 02/03 inside `AppShell` with crumb
      `[{label: "Multi-Agent Review"}, {label: "Configure run"}]`, following the
      thin-page precedent at `client/src/app/evals/page.tsx:15-66`. Step 1 is a
      PR selector over `usePulls(activeRepoId)` writing `?pr=<prId>`; step 2 is
      the agent list with a `Select all` link, per-agent estimates and, until a
      PR is chosen, the inert "Pick a pull request first" empty state — present
      but not hidden (Edge cases). The start control is disabled unless a PR and
      at least one agent are chosen (AC-2), and shows the aggregate from
      `aggregateEstimate` with an explicit incompleteness marker (AC-9, AC-8).
      On success `router.push('/multi-agent/' + prId)` (AC-5) —
      `client/src/app/multi-agent/page.tsx`,
      `client/src/app/multi-agent/_components/ConfigureRun/ConfigureRun.tsx`,
      `.../ConfigureRun/index.ts`, `.../ConfigureRun/styles.ts`
      — owner: `implementer` — skill: `frontend-ui-architecture` + `next-best-practices`
      — → AC-4, AC-5, AC-9 → `configure_run`
- [ ] T29 `test_writer`: colocated test — with no `?pr=`, step 2 renders the
      "Pick a pull request first" empty state and the start control is disabled
      (AC-2, AC-4); after choosing a PR and checking two agents the aggregate
      shows the greatest duration and the summed cost (AC-9) and becomes
      startable; with one selected agent lacking an estimate the aggregate is
      marked incomplete (AC-8); submitting pushes `/multi-agent/<prId>` (AC-5) —
      `client/src/app/multi-agent/_components/ConfigureRun/ConfigureRun.test.tsx`
      — owner: `test-writer` — skill: `react-testing-library` — → AC-4, AC-5, AC-8, AC-9 → `configure_run`

### Client — the results surface (AC-10 … AC-23)

- [ ] T30 Results route `/multi-agent/[prId]`, crumb
      `[{label: "Multi-Agent Review"}, {label: "#<number>", mono: true}]`. All
      four pieces of view state live in the URL so a mid-run reload restores them
      (Edge cases): `?view=columns|tabs`, `?conflicts=1`, `?agent=<agentId>`
      (tabs mode) and `?trace=<runId>`. `VIEW_MODES` and the `?view=` guard are
      **derived from one array in `constants.ts`** — export `VIEW_MODES` and
      `isViewMode(v)` from that file and use both from `page.tsx`; a second
      literal list is the exact bug `client/insights.md:73` records. Data comes
      from `useMultiAgentRun(prId)`; when it resolves to null render the AC-14
      empty state offering `/multi-agent`. Mount `RunTraceDrawer` from the page
      (mirroring `pulls/[number]/page.tsx:230-238`) with
      `running={column.status === 'running'}` so AC-12's live-log requirement
      holds while the run is unfinished —
      `client/src/app/multi-agent/[prId]/page.tsx`,
      `client/src/app/multi-agent/[prId]/_components/constants.ts`
      — owner: `implementer` — skill: `next-best-practices` — → AC-12, AC-13, AC-14 → `multi_agent_results`
- [ ] T31 `AgentPanel` — one per column, in the order the server returned
      (Contracts). Header: agent name, one-line description, `CircularScore` with
      its numeric value as text (NFR), and the run's own duration and cost
      rendered from `column.duration_ms`/`cost_usd` **exactly as received**, with
      no derivation from the group total (AC-16). A `running` column shows a
      textual state label alongside any indicator, and honours
      `prefers-reduced-motion` by conveying progress without continuous
      animation (NFR). A `failed` column renders the state label plus
      `column.error` (AC-11). The findings list uses the promoted `FindingCard`
      so accept / dismiss / turn-into-eval-case are exactly the three actions
      offered (AC-17, AC-15 — nothing merges, re-titles or re-scores); the list
      scrolls and states the agent's total finding count (Edge cases). A
      `View trace` control per panel with an accessible name naming its agent
      (NFR) sets `?trace=<run_id>` —
      `client/src/app/multi-agent/[prId]/_components/AgentPanel/AgentPanel.tsx`,
      `.../AgentPanel/index.ts`, `.../AgentPanel/styles.ts`
      — owner: `implementer` — skill: `react-best-practices` + `accessibility-requirements`
      — → AC-10, AC-11, AC-15, AC-16, AC-17 → `multi_agent_results`
- [ ] T32 `ResultsHeader` — title, `{count} agents`, the group's
      `total_duration_ms` and `total_cost_usd` rendered verbatim (AC-16), and the
      Columns/Tabs mode control from T30's `VIEW_MODES`, conveying the selected
      mode to assistive technology (`aria-pressed` or a radiogroup) and operable
      by keyboard (NFR). Tabs mode renders one tab per column with the agent's
      score as text, and the selected agent's panel below (design ref 05) —
      `client/src/app/multi-agent/[prId]/_components/ResultsHeader/ResultsHeader.tsx`,
      `.../ResultsHeader/index.ts`, `.../ResultsHeader/styles.ts`
      — owner: `implementer` — skill: `react-best-practices` + `accessibility-requirements`
      — → AC-16 → `multi_agent_results`
- [ ] T33 `DisagreementBlock` — heading `conflicts.title`, a two-state
      `Show only conflicts` toggle bound to `?conflicts=`, **off by default**
      (Contracts), conveying its on/off state to assistive technology (NFR). Each
      row is headed by its location only — `file:start_line[-end_line]` — with
      **no synthesized label**, contrary to design refs 04/05 (Edge cases). One
      cell per take: the agent's name, its severity as text as well as colour
      (NFR) and its `note` rendered verbatim; when `verdict === 'ignored'` render
      `conflicts.didNotFlag` and nothing else — never a generated explanation
      (AC-19, Non-goals). While the toggle is on, render only rows with
      `is_conflict` (AC-22); never recompute `is_conflict` client-side.
      Interactive targets at least 24×24 CSS px (NFR) —
      `client/src/app/multi-agent/[prId]/_components/DisagreementBlock/DisagreementBlock.tsx`,
      `.../DisagreementBlock/index.ts`, `.../DisagreementBlock/styles.ts`
      — owner: `implementer` — skill: `react-best-practices` + `accessibility-requirements`
      — → AC-19, AC-22 → `disagreement_block`
- [ ] T34 An `aria-live="polite"` region on the results surface announcing each
      column's new state as it changes (`column.announce`), updated by an effect
      keyed on the columns' statuses. It must not call `focus()` and must not
      render a focusable node, so keyboard focus never moves (AC-23) —
      `client/src/app/multi-agent/[prId]/_components/LiveStateAnnouncer/LiveStateAnnouncer.tsx`,
      `.../LiveStateAnnouncer/index.ts`
      — owner: `implementer` — skill: `accessibility-requirements` — → AC-23 → `results_announce`
- [ ] T35 `test_writer`: colocated tests for T30–T32 with `fetch` mocked. Assert
      — a fixture whose three columns are `running`, `done` and `failed`
      simultaneously renders all three states, each as text (AC-10); the failed
      column renders its `error` while the done column still renders its findings
      and score unchanged (AC-11); **AC-15's no-merging test** — two columns each
      carrying a finding with the *same title at the same `file:start_line`*
      renders that title **twice**, once inside each agent's own panel, with each
      panel naming its own agent (an implementation that merged or deduplicated
      renders it once, so the test genuinely fails); **AC-16's no-normalisation
      test** — a fixture whose `total_duration_ms` is 25000 while the columns'
      durations are 8200/7400/6900 renders `25.0s` for the total and each
      column's own figure unchanged, so nothing that substituted the max (8.2s)
      or the sum (22.5s) can pass; clicking a panel's `View trace` sets
      `?trace=<run_id>` and mounts the drawer with `running` true for a
      `running` column (AC-12); a null response renders the AC-14 empty state
      offering to configure one; `?view=tabs` on load renders tabs mode and an
      unknown `?view=` value falls back to columns —
      `client/src/app/multi-agent/[prId]/_components/AgentPanel/AgentPanel.test.tsx`,
      `client/src/app/multi-agent/[prId]/page.test.tsx`
      — owner: `test-writer` — skill: `react-testing-library` — → AC-10, AC-11, AC-12, AC-13, AC-14, AC-15, AC-16, AC-17 → `multi_agent_results`
- [ ] T36 `test_writer`: colocated tests for T33 — a take with a severity renders
      that severity as text plus the note verbatim, including a note containing
      `**`, `<b>` and a `#`, asserted with an exact-string query so any
      truncation, markdown stripping or reformatting fails it; an `ignored` take
      renders only `did not flag`; the filter is off on first render and every
      row is present; turning it on hides the rows whose `is_conflict` is false
      and keeps the rest (AC-22); the toggle exposes its on/off state and every
      row control is reachable by keyboard —
      `client/src/app/multi-agent/[prId]/_components/DisagreementBlock/DisagreementBlock.test.tsx`
      — owner: `test-writer` — skill: `react-testing-library` + `accessibility-requirements`
      — → AC-19, AC-22 → `disagreement_block`
- [ ] T37 `test_writer`: colocated test for T34 — render with a column
      `running`, focus a control, rerender with that column `done`, then assert
      the live region's text names the agent and its new state **and**
      `document.activeElement` is the same node as before the rerender (AC-23) —
      `client/src/app/multi-agent/[prId]/_components/LiveStateAnnouncer/LiveStateAnnouncer.test.tsx`
      — owner: `test-writer` — skill: `accessibility-requirements` — → AC-23 → `results_announce`

### e2e (UI entry points)

- [ ] T38 `test_writer`: flow that loads `{BASE}/`, clicks the sidebar's
      `Multi-Agent Review` item, waits for `--url /multi-agent`, and then asserts
      on **rendered copy that only the configure-run surface produces** —
      `Pick a pull request first` — because a URL assertion alone passes against
      a build where the route falls back
      (`client/insights.md:73`, and the same reasoning as
      `e2e/specs/13-eval-dashboard.flow.json:3`). Read-only: no control that
      starts a run is clicked —
      `e2e/specs/15-multi-agent-configure-run.flow.json` — owner: `test-writer`
      — skill: `frontend-ui-architecture` — → AC-4 → `e2e_multi_agent_configure_run`
- [ ] T39 `test_writer`: flow that opens the seeded PR #482 (steps 5-10 of
      `e2e/specs/04-pr-findings.flow.json`), clicks `Run Review`, and asserts on
      `Pick agents to run` — copy that exists only inside the picker. The run
      control is never clicked, so no model call is made
      (`e2e/CLAUDE.md`) — `e2e/specs/16-pr-agent-picker.flow.json`
      — owner: `test-writer` — skill: `frontend-ui-architecture` — → AC-1 → `e2e_pr_agent_picker`

## Traceability

| AC | Tasks | Verified by |
|----|-------|-------------|
| AC-1 | T26, T27, T39 | `pr_agent_picker`, `e2e_pr_agent_picker` |
| AC-2 | T13, T17, T26, T27, T28, T29 | `pr_agent_picker`, `configure_run`, `multi_agent_it` |
| AC-3 | T26, T27 | `pr_agent_picker` |
| AC-4 | T18, T28, T29, T38 | `configure_run`, `e2e_multi_agent_configure_run` |
| AC-5 | T28, T29 | `configure_run` |
| AC-6 | T12, T13, T17 | `multi_agent_it` |
| AC-7 | T8, T14, T17, T26, T27 | `multi_agent_it`, `pr_agent_picker` |
| AC-8 | T14, T17, T20, T21, T27, T29 | `multi_agent_it`, `agent_estimates`, `pr_agent_picker`, `configure_run` |
| AC-9 | T20, T21, T28, T29 | `agent_estimates`, `configure_run` |
| AC-10 | T31, T35 | `multi_agent_results` |
| AC-11 | T17, T31, T35 | `multi_agent_it`, `multi_agent_results` |
| AC-12 | T23, T24, T30, T35 | `run_trace_drawer_moved`, `multi_agent_results` |
| AC-13 | T3, T8, T9, T10, T12, T13, T17, T19, T30, T35 | `multi_agent_it`, `multi_agent_results` |
| AC-14 | T17, T25, T30, T35 | `multi_agent_it`, `multi_agent_results` |
| AC-15 | T31, T35 | `multi_agent_results` |
| AC-16 | T11, T12, T15, T16, T31, T32, T35 | `multi_agent_results`, `run_executor_parallel` |
| AC-17 | T22, T23, T24, T31, T35 | `finding_card_actions`, `multi_agent_results` |
| AC-18 | T1, T2, T4, T5, T6, T7 | `multi_agent_conflicts` (+ existing `eval-scoring.test.ts` guards T4/T5) |
| AC-19 | T6, T7, T33, T36 | `multi_agent_conflicts`, `disagreement_block` |
| AC-20 | T6, T7 | `multi_agent_conflicts` |
| AC-21 | T6, T7 | `multi_agent_conflicts` |
| AC-22 | T33, T36 | `disagreement_block` |
| AC-23 | T34, T37 | `results_announce` |

## Verification

### Fast loop (implementer / test-writer, after every step)

- `cd server && pnpm typecheck`
- `cd server && pnpm test:unit --reporter=dot`
- `cd client && pnpm typecheck`
- `cd client && pnpm test:unit --reporter=dot`

### Full (plan-verifier, once at the end)

- `cd server && pnpm typecheck`
- `cd server && pnpm test:unit --reporter=dot`
- `cd server && pnpm test:integration --reporter=dot` (Docker; `multi-agent.it.test.ts`
  is new. If an unrelated `.it.test.ts` file fails, re-run that one file alone
  before concluding a regression — the full parallel run is not a reliable signal
  on Windows, `server/insights.md:69`.) **The whole suite matters here, not just
  the new file:** T15 changes `executeRuns` for every caller, so
  `reviews.it.test.ts` and `severity-counts.it.test.ts` — which drive the
  pre-existing `all:true` path — are the regression signal for the shared-path
  consequence recorded in Constraints. Both must stay green.
- `cd client && pnpm typecheck`
- `cd client && pnpm test:unit --reporter=dot`
- `cd client && pnpm build` — **mandatory**, not optional: it is the only command
  that catches a value import of the vendored contract barrel, which leaves
  `typecheck` and `test:unit` green (`client/insights.md:57`).
- `./scripts/e2e.sh` — this plan adds two UI entry points (a nav item and a PR
  picker), so both new flows must run in the hermetic stack.
- `diff server/src/vendor/shared/contracts/observability.ts client/src/vendor/shared/contracts/observability.ts`
  — must print nothing (the vendored copies are hand-synced).
- `cd server && pnpm db:migrate` applied against a fresh database, then confirm
  `agent_runs` carries `multi_agent_run_id` and `finished_at`
  (`\d agent_runs`). Note that reverting the schema file does not undo an applied
  migration (`server/insights.md:57`).
- Walk the results surface with the keyboard alone — reach and operate the mode
  control, the conflict filter, every agent selection control and every trace
  affordance; confirm contrast and 24×24 targets against the NFRs. — owner:
  `human`. This is a supplement: every AC above is already bound to an automated
  test, and none depends on this step.

## Explicit note

Architecture and security review are out of scope for `implementer` and are
handled by separate review agents/skills after implementation. Because this
feature adds new API surface and new input handling
(`POST /pulls/:id/multi-agent-run`), run it via `/impl-sec`, not `/impl`.

## Blocking questions

**None remain.** The one question this plan was held on — whether concurrent
execution of `ReviewRunExecutor.executeRuns` belongs in this feature — was put to
the user and answered **yes**. It is now a settled decision (Placement decisions
7), with its two accepted consequences recorded in Constraints: the shared
`all:true` / MCP path becomes concurrent, and the fan-out is bounded at 8 against
a provider 429. Do not reopen it; T15/T16 are unconditional.

## Open questions / assumptions

- **Transitive clustering.** The spec defines *two* findings sharing a location
  but not how a chain of overlaps resolves. T6 assumes greedy interval merge, so
  1-5 / 5-10 / 10-15 in one file is one row rather than two or three. Chosen
  because it is deterministic, order-independent and the only reading under which
  "same location" is an equivalence relation.
- **Cancelled runs.** The spec's state diagram has only Running / Done / Failed,
  but `completeAgentRun` persists `cancelled` (`run.repo.ts:190`). T11 maps
  `cancelled` → `failed` carrying its recorded reason ("Cancelled by user"),
  which satisfies AC-11's "the reason it failed" and AC-21's exclusion, since a
  cancelled run contributes no findings and its silence is not a position.
- **A deleted agent loses its recorded identity.** The spec's edge case says a
  group's runs "are still presented with the agent identity they were recorded
  under", but `agent_runs.agent_id` is `onDelete: 'set null'`
  (`server/src/db/schema/runs.ts:13`), so the name/description join returns null
  once the agent is deleted. Satisfying the edge case fully would mean
  denormalising the name onto `agent_runs` — out of scope here. The panel
  degrades to a null name rather than erroring; flagged for a follow-up.
- **`GET /pulls/:id/multi-agent` returns `null`, not 404,** for a PR with no
  group (AC-14 is an empty state, not an error). A 404 would route through the
  client's global error toast.
