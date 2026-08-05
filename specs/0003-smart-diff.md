# Development Plan: Smart Diff (course lesson L03, second half)

> **Location/numbering note.** Root [`specs/`](README.md) holds cross-module
> Development Plans produced by `planner` and consumed by `implementer`;
> module-level `specs/` folders hold single-module *design* specs. This
> feature spans `server` + `client` (+ a seed/e2e touch), so it lives here and
> takes the next number in root `specs/`'s own sequence
> (`0001-four-claude-code-subagents.md`, `0002-intent-layer.md` → `0003`).
> `0002` explicitly deferred Smart Diff ("the other half of L03") to this plan.
>
> **Revision 2** (after user review of revision 1). Five requirements were added:
> a Smart Diff ↔ Original mode toggle; the affected-files count staying visible;
> zero token spend (already covered, unchanged); large-file highlighting; and —
> the important one — clicking a finding marker must navigate through the app's
> own routing to that finding's card on the **Agent runs** tab. The last one
> replaces revision 1's in-panel scroll-to-line design and, with the user's
> explicit approval, puts one narrow `SmartDiff` contract change **in** scope.
> Sections that revision 1 got right (classification taxonomy, split suggestion,
> findings semantics, seed, no-LLM constraint) are carried over unchanged.

## Goal

Sort a PR's changed files by risk so the reviewer reads business logic first
instead of lockfiles and generated output. The server exposes one new read-only
endpoint, `GET /pulls/:id/smart-diff`, that **deterministically** classifies the
PR's already-imported `pr_files` rows into `core` / `wiring` / `boilerplate` by
path/pattern, attaches a `{ line, finding_id }` reference for every finding of
the PR's most recent review(s), computes a split suggestion for oversized PRs,
and returns the `SmartDiff` contract. The client's "Files changed" tab gains a
**Smart order / Original order** toggle: Original renders today's flat diff with
no finding markers at all; Smart renders the groups core-first with
`boilerplate` collapsed, a **persistent severity marker on each finding's exact
line**, and a highlight on unusually large files. Clicking a line marker
navigates — via the app's normal tab routing — to that finding's card on the
Agent runs tab, opening the right run accordion and scrolling to the right card.
**No LLM/model call is made anywhere in this feature**; before any review has
run, Smart Diff still works, just with no markers.

## Out of scope

- **Any LLM call.** In particular `SmartDiffFile.pseudocode_summary` is *not*
  generated here — the server always returns `null` for it and every consumer
  must be null-safe. LLM-authored summaries are a later lesson.
- **Any DB migration.** `pr_files`, `reviews` and `findings` already carry
  everything this feature reads.
- **Any contract change beyond the one in §6.** Exactly one field of
  `SmartDiffFile` changes shape (`finding_lines: number[]` → `findings:
  SmartDiffFindingRef[]`). `Finding`, `FindingRecord`, `ReviewRecord`,
  `SmartDiffGroup`, `SmartDiff.split_suggestion` and every other contract stay
  untouched. Severity/title are **not** duplicated into the smart-diff payload —
  the client already has them (§10).
- **URL-persisted deep links to a finding.** The existing run-level targeting
  (`FindingsTab.tsx:86-89` → `ReviewRunAccordion.tsx:51-57`) is in-memory React
  state and does not survive a reload; the finding-level target deliberately
  mirrors that limitation. Only the **tab** change goes through the URL
  (`?tab=findings`), as it already does today.
- **PR Brief / Blast radius / Risks / PR History** (`pr_brief` table,
  `BlastRadius`, `Risks`, `PrHistory` contracts) — L04/L05 material.
- **Refactoring `modules/pulls/routes.ts`.** It is a documented, grandfathered
  onion violation (queries inside a route). Do not extract its
  latest-review-per-agent aggregation, do not move it into a repository.
- **Persisting the smart diff.** Computed per request from `pr_files` +
  `findings`; nothing is cached in Postgres (`pr_brief` stays empty).
- **A GitHub round-trip.** The route reads only already-imported rows; it must
  not call `container.github()`. No finding click may open github.com, a popup,
  or a modal — see §10.
- **New e2e flows.** Existing flows must keep passing; writing
  `e2e/specs/08-*.flow.json` is not part of this plan.
- **The demo video / PR write-up recording** — the author's manual step.
- **Architecture and security review of the result** — see "Explicit note".

## Constraints

Verified against HEAD (branch `SMART-DIFF`):

1. **Routes declare zod `params` via `fastify-type-provider-zod`**; no
   hand-rolled `Schema.parse(req.params)` in a handler (`server/CLAUDE.md`).
   No route in `server/src` declares a `response:` schema — do not introduce the
   first one; return a typed value (`Promise<SmartDiff>`) as every other route does.
2. **New services take explicit deps, not `Container`** (onion-architecture).
   `SmartDiffService` needs neither `container.llm` nor `container.github`, so
   it must not receive the container at all — that is the structural proof of
   the "no LLM call" requirement.
3. **Ring 4 must not skip ring 2/3.** The new module gets `routes.ts` +
   `service.ts` + pure `classify.ts`/`split.ts`/`helpers.ts`/`constants.ts`; the
   `pulls`/`polling`/`settings`/`workspace` "queries in the route" shape is a
   grandfathered violation new modules must not copy.
4. **One table, one read path.** `findings`/`reviews` are owned by
   `modules/reviews/repository/`. Per `server/insights.md` (2026-08-05,
   duplicate `pr_intent` accessors), do **not** create a second Drizzle read
   path for `findings` inside `modules/smart-diff/`; add one method to
   `ReviewRepository` and consume it through a `Pick<>` type, exactly as
   `IntentService` already does (`modules/intent/service.ts:32`).
5. **Workspace scoping is per-branch, not inherited.** Per `server/insights.md`
   (2026-08-05), every read path must independently call the workspace-scoped
   pull lookup and throw `NotFoundError` — a PR id from another workspace must
   never return data.
6. **`ORDER BY` on a non-unique column needs a tiebreaker** (`server/insights.md`,
   2026-08-04): the "latest review" ordering must be
   `ORDER BY created_at DESC, id DESC`, and every list this feature returns must
   have a total, stable ordering.
7. **Contracts are vendored, not linked.** `@devdigest/shared` is *copied* into
   `server/src/vendor/shared` and `client/src/vendor/shared` (root `CLAUDE.md`,
   `client/CLAUDE.md` gotcha). The §6 contract edit must be applied to **both**
   `*/src/vendor/shared/contracts/brief.ts` files identically, in the same
   commit, and the existing fixture in `server/test/contracts.test.ts:107-116`
   (which still uses `finding_lines: [28, 52]`) must be updated with them.
8. **DB-backed tests use the `*.it.test.ts` suffix**; everything else stays
   hermetic (drives the CI unit/integration split).
9. **Migrations are not run on boot**, and `server/src/db/migrations/` is
   do-not-touch. This plan requires no migration.
10. **Client data fetching goes through a hook in `src/lib/hooks/*`** — never a
    raw `fetch`/`api` call inside a component (`client/CLAUDE.md`).
11. **The Agent runs tab's query value is `findings`, not `runs`.**
    `page.tsx:60` reads `search.get("tab") ?? "overview"`; the branches are
    `overview` / `findings` / `diff` (`page.tsx:137-171`). Navigating to the
    Agent runs tab means `?tab=findings`, through the existing `setTab` helper
    (`page.tsx:62-68`) — never a `router.push` built by hand elsewhere.
12. **e2e flows must stay model-free and must keep passing.** Flows `02`, `04`,
    `05` (`e2e/specs/*.flow.json`) drive PR #482; flow `05` opens the **Files
    changed** tab and asserts the text `src/config.ts` is visible. Smart mode is
    the default, `src/config.ts` classifies as `wiring` (expanded by default), so
    the assertion still holds — but re-running `./scripts/e2e.sh` is a required
    verification step, not optional.
13. **Client insights, applicable here:** `?? 0` must not hide "missing" as
    "zero" when rendering; a component shared by two routes stays colocated
    rather than moving into `@devdigest/ui` (which must stay domain-free).
14. **One derivation of "which findings count".** `client/insights.md`
    (2026-07-30) logs a real user-visible bug caused by two independent
    re-derivations of "the findings for this PR". Smart Diff must use the same
    semantics the PR list and `FindingsTab` already use — see §2.

## Affected modules & files

### `shared contracts` (both vendored copies — constraint 7)
- `server/src/vendor/shared/contracts/brief.ts:84-91` and
  `client/src/vendor/shared/contracts/brief.ts:84-91` — the §6 change:
  new `SmartDiffFindingRef`, `SmartDiffFile.findings` replacing `finding_lines`.
- `server/test/contracts.test.ts:107-116` — fixture updated to the new shape.

### `server/`
- `src/modules/smart-diff/` — **new module**: `routes.ts`, `service.ts`,
  `classify.ts`, `split.ts`, `helpers.ts`, `constants.ts`.
- `src/modules/index.ts` — one import + one registry entry (`smartDiff`).
- `src/modules/reviews/repository/review.repo.ts` — **one new query function**
  `latestFindingLocations(db, prId)`.
- `src/modules/reviews/repository.ts` — expose it on the `ReviewRepository` facade.
- `src/modules/reviews/helpers.ts` — **one new pure helper**
  `pickLatestReviewIdPerAgent(rows)` (server-side twin of the client's
  `latestReviewPerAgent`).
- `src/db/seed.ts` — add two boilerplate `pr_files` rows to seeded PR #482.
- `test/smart-diff.test.ts` (hermetic), `test/smart-diff.it.test.ts` (Postgres).

### `client/` — new files
- `src/lib/hooks/smart-diff.ts` — `usePrSmartDiff`.
- `src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/_components/SmartDiffViewer/`
  — `SmartDiffViewer.tsx`, `constants.ts`, `helpers.ts`, `styles.ts`,
  `index.ts`, `SmartDiffViewer.test.tsx`.

### `client/` — edited files
- `src/lib/hooks/index.ts` — one export line.
- `src/lib/hooks/reviews.ts` — `useDeleteRun` / `useDeleteReview` also
  invalidate the smart-diff key.
- `src/components/diff-viewer/CodeLine/CodeLine.tsx`, `FileCard/FileCard.tsx`,
  `DiffViewer/DiffViewer.tsx`, `styles.ts`, `index.ts` — the domain-free
  `renderLineMarker` slot (§8) and a `FileCard` re-export (§11).
- `src/app/…/_components/DiffTab/DiffTab.tsx` — mode toggle, smart-diff fetch,
  split banner, marker→navigation handoff.
- `src/app/…/_components/FindingCard/FindingCard.tsx` (+ `styles.ts`) — real DOM
  `id` + `scrollMarginTop` (§10 step 1).
- `src/app/…/_components/FindingsPanel/FindingsPanel.tsx` — target props, filter
  escape, focus sync, scroll (§10 step 2).
- `src/app/…/_components/ReviewRunAccordion/ReviewRunAccordion.tsx` — target
  props, force-open when it owns the target finding (§10 step 2).
- `src/app/…/_components/FindingsTab/FindingsTab.tsx` — target props passthrough,
  severity-filter escape (§10 step 2).
- `src/app/repos/[repoId]/pulls/[number]/page.tsx` — owns the finding-target
  state, passes `findings` + `onOpenFinding` into `DiffTab`, invalidates the
  smart-diff query on run completion.
- `messages/en/prReview.json` — the `smartDiff.*` block already exists
  (lines 53-62); one value changes, three keys are added.

### `e2e/`
- No file changes. `./scripts/e2e.sh` is a verification gate.

---

## Design decisions

The implementer must not re-derive these.

### 1. Classification is pure, table-driven, and lives in constants

`modules/smart-diff/constants.ts` owns **every** pattern and threshold; the
logic in `classify.ts` must contain no literal path fragments and no magic
numbers. Required exports (names fixed so tests and review can reference them):

```ts
export const BOILERPLATE_PATTERNS: RegExp[]   // checked FIRST
export const WIRING_PATTERNS: RegExp[]        // checked SECOND
export const ROLE_ORDER: SmartDiffRole[] = ['core', 'wiring', 'boilerplate'];
export const SPLIT_TOO_BIG_LINES = 400;       // = client SIZE_MEDIUM_MAX ("L" bucket)
export const SPLIT_MAX_PROPOSALS = 4;
export const SPLIT_REMAINDER_NAME = 'Everything else';
export const ROOT_BUCKET_NAME = '(root)';
```

Rules:

- **Precedence is boilerplate → wiring → core**, first match wins, `core` is the
  default. `dist/index.ts` must classify as `boilerplate`, not `wiring`.
- Matching is on the **POSIX path as stored in `pr_files.path`**, lower-cased,
  never on the patch text.
- `BOILERPLATE_PATTERNS` must cover, at minimum: every common lockfile
  (`package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`,
  `bun.lockb`, `Cargo.lock`, `poetry.lock`, `uv.lock`, `Gemfile.lock`,
  `composer.lock`, `go.sum`), build output directories (`dist/`, `build/`,
  `out/`, `.next/`, `coverage/`, `vendor/`, `node_modules/` at any depth),
  minified/compiled assets (`*.min.js`, `*.min.css`, `*.map`), and generated
  code / snapshots (`__snapshots__/`, `*.snap`, `*.generated.*`, `*.gen.*`,
  `*_pb.*`, `*.pb.go`, any path segment `generated/`).
  **Acceptance criterion: lockfiles are `boilerplate`, always.**
- `WIRING_PATTERNS`: `package.json`, `tsconfig*.json`, `*.config.{ts,js,mjs,cjs,json}`,
  `config.{ts,js,json}` and any `config/` segment, `.github/workflows/**`,
  `Dockerfile*`, `docker-compose*`, `.env*`, dotfile RC files
  (`.eslintrc*`, `.prettierrc*`, `.gitignore`, `.npmrc`), bare barrels
  (`**/index.ts|js|tsx`), `*.d.ts`, i18n message bundles (`messages/**/*.json`),
  and documentation (`*.md`, `*.mdx`, `docs/`).
- **Test files stay `core`** — deliberate: a test change is often the change
  under review. Their *snapshots* remain `boilerplate` (covered above). Write
  this rationale as a comment next to the patterns.
- `classify.ts` exports pure `classifyPath(path): SmartDiffRole` and
  `groupFiles(files): SmartDiffGroup[]`. No I/O, no Drizzle, no `Container`.

**Ordering (total and stable — constraint 6):** inside a group, files sort by
finding count DESC, then changed lines (`additions + deletions`) DESC, then
`path` ASC. Groups are emitted in `ROLE_ORDER`, and **empty groups are omitted**.

### 2. Which findings the response carries

Semantics: **each agent's own most recent `kind: 'review'` row for the PR, union
of their undismissed findings** — not the single newest review row overall.

This is a deliberate deviation from the original task brief's phrase "the most
recent completed review run", required by constraint 14: the PR-list FINDINGS
column (`modules/pulls/routes.ts:114-209`), the client's `latestReviewPerAgent`
(`client/src/app/repos/[repoId]/pulls/helpers.ts:11`) and `FindingsTab`'s
aggregate counter (`FindingsTab.tsx:100-103`) already use exactly these
semantics, and `server/insights.md` (2026-07-30) records the real bug that
"latest review overall" caused on multi-agent PRs. For a single-agent PR the two
readings are identical.

Mechanics:

- `reviews` rows exist only for completed runs (`insertReview` runs at
  completion), so "completed" needs no extra `agent_runs.status` filter. Do not
  join `agent_runs`.
- Findings with `dismissedAt IS NOT NULL` are **excluded**.
- Bucket key per review row is `agentId ?? \`review:${id}\`` — a null `agent_id`
  never merges with another review (same rule as `pulls/routes.ts:159`).
- "Latest" ordering: `ORDER BY created_at DESC, id DESC`.
- Each entry in a file's `findings` array is
  `{ line: <finding.start_line>, finding_id: <finding.id> }` — findings carry
  **new-side** line numbers (`reviewer-core/src/grounding.ts:23`), matched to the
  file by **exact `path` equality**, sorted by `line` ASC then `finding_id` ASC
  (total order), **not deduplicated**: two findings on the same line produce two
  entries, so `findings.length` is exactly that file's finding count. Findings
  whose `file` matches no changed file are ignored.

### 3. Split suggestion (deterministic)

- `total_lines` = Σ(`additions` + `deletions`) over **all** changed files.
- `too_big` = `total_lines > SPLIT_TOO_BIG_LINES`.
- `proposed_splits` = `[]` when `!too_big`. Otherwise bucket **all** changed
  files by their first path segment (root-level files use `ROOT_BUCKET_NAME`),
  sort buckets by total changed lines DESC then name ASC, keep the first
  `SPLIT_MAX_PROPOSALS`, and merge any remainder into a final bucket named
  `SPLIT_REMAINDER_NAME`. Every changed file appears in exactly one split —
  nothing is silently dropped. Files inside a bucket sort by path ASC.
- The `name` is a server-produced string (a directory name or one of the two
  constants) and is intentionally **not** translated; the surrounding copy is.

### 4. API surface

```
GET /pulls/:id/smart-diff  →  SmartDiff   (pure read, no LLM, no GitHub)
```

- `schema: { params: IdParams }` (`modules/_shared/schemas.ts:11`), no body, no
  query params, therefore no new request contract.
- Workspace scoping: `getContext(container, req)` → the service's own
  workspace-scoped pull lookup → `NotFoundError('Pull request not found')` for a
  PR in another workspace (constraint 5).
- **No rate-limit config** — this call cannot spend money; the default global
  limiter applies.
- Empty PR (no `pr_files` rows) →
  `{ groups: [], split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] } }`.
- `pseudocode_summary` is always explicit `null`.

Onion placement: `routes.ts` parses + delegates only; `service.ts` orchestrates
(no `drizzle-orm`, no `fastify`, no `Container`); `classify.ts`/`split.ts`/
`helpers.ts` are pure and unit-testable without a database.

```ts
export interface SmartDiffServiceDeps {
  reviews: Pick<ReviewRepository, 'getPull' | 'getPrFiles' | 'latestFindingLocations'>;
}
export class SmartDiffService {
  constructor(private deps: SmartDiffServiceDeps) {}
  async get(workspaceId: string, prId: string): Promise<SmartDiff> { … }
}
```

`routes.ts` constructs it with `new ReviewRepository(container.db)`, mirroring
`modules/intent/routes.ts:23-28`.

### 5. The one new repository read

`modules/reviews/repository/review.repo.ts`:

```ts
export interface FindingLocation {
  findingId: string;   // added in revision 2 — the navigation target (§10)
  file: string;
  line: number;        // finding.start_line
  severity: string;
}
export async function latestFindingLocations(db: Db, prId: string): Promise<FindingLocation[]>
```

Implementation: select `{ id, agentId, createdAt }` from `reviews` where
`prId = :prId AND kind = 'review'`, `ORDER BY createdAt DESC, id DESC`; reduce
with the new pure helper `pickLatestReviewIdPerAgent(rows)` in
`modules/reviews/helpers.ts`; then select `{ id, file, startLine, severity }`
from `findings` where `reviewId IN (…) AND dismissedAt IS NULL`. Return
domain-shaped `FindingLocation[]` — **row types must not cross this boundary**.
Expose the method on the `ReviewRepository` facade.

`severity` is not forwarded into the response (§6) but is kept on
`FindingLocation` because it costs nothing, keeps the repository method
generally useful, and lets a future ordering rule sort by severity without
another query. `pickLatestReviewIdPerAgent` is a ring-2 pure function (ring 3 may
import ring 2) and is the *server's single* definition of these semantics — the
twin of the client's `latestReviewPerAgent`. Cross-reference the two in comments
so a future semantics change is findable from either end (the constraint-14
lesson).

### 6. The one contract change (user-approved, narrowly scoped)

`SmartDiffFile.finding_lines: z.array(z.number().int())` cannot express *which*
finding a line belongs to, and §10 needs a finding id to navigate to. Bare line
numbers are also ambiguous when two findings share a line. Therefore, in **both**
`server/src/vendor/shared/contracts/brief.ts` and
`client/src/vendor/shared/contracts/brief.ts` (constraint 7), identically:

```ts
export const SmartDiffFindingRef = z.object({
  line: z.number().int(),      // new-side line number (finding.start_line)
  finding_id: z.string(),      // findings.id — the navigation target
});
export type SmartDiffFindingRef = z.infer<typeof SmartDiffFindingRef>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  findings: z.array(SmartDiffFindingRef),   // was: finding_lines: z.array(z.number().int())
});
```

Decisions inside this change, so they are not re-litigated:

- **Rename, don't keep the old name.** The field no longer holds line numbers,
  and a lying field name is worse than a rename. The rename is free: the
  contract has **no** production consumer today — the only reader anywhere in the
  repo is the fixture at `server/test/contracts.test.ts:107-116`, updated in the
  same step.
- **No severity, no title, no run id in this payload.** They would duplicate
  data the client already holds: `page.tsx:72-75` already computes `allFindings`
  from `usePrReviews(prId)`, which carries `FindingRecord` (id, severity, title,
  file, start_line, …) for every run. The smart-diff payload supplies the
  *authoritative link* (which finding sits on which line); the loaded review data
  supplies presentation and the owning run. Keeping the contract minimal is an
  explicit user instruction.
- **`SmartDiffResponse = SmartDiff`** (`review-api.ts:63-65`) needs no edit — it
  is an alias.
- No other contract, no DB column, no migration changes.

### 7. Mode toggle — Smart order / Original order

`DiffTab` owns a local `mode` state, `'smart' | 'original'`, **defaulting to
`'smart'`** (matches the product mockup). It is client state, not server state,
and is not persisted to the URL or localStorage.

- Rendered as two segmented buttons in the existing `SectionLabel`'s `right`
  slot, next to today's "Show/Hide comments" button (`DiffTab.tsx:45-59`),
  labelled from new i18n keys `prReview.smartDiff.orderSmart` /
  `orderOriginal`. The active one is visually selected and carries
  `aria-pressed`.
- **`'original'` renders exactly today's code path** —
  `<DiffViewer files={files} commenting={commenting} />` with **no**
  `renderLineMarker` prop, therefore **zero** finding markers, zero grouping,
  original file order. This is the untouched-behaviour escape hatch and is what
  "normal mode shows no findings inline" means concretely: the marker slot is
  simply not supplied, so the absence is structural rather than a conditional
  inside the shared component.
- **`'smart'` renders `<SmartDiffViewer …/>`** (§11).
- The same fallback applies as before: while `usePrSmartDiff` is loading, has
  errored, or `prId` is null, the tab renders the Original-mode view regardless
  of the toggle, so a smart-diff failure can never break the Files changed tab.
  The toggle itself stays visible and usable.

**Affected-files count (requirement 2).** The existing header
`Files changed · {filesCount} files` (`DiffTab.tsx:60`) stays exactly where it
is, above/beside the toggle, in **both** modes, and keeps reading
`pr.files_count` from `PrDetail` — not a smart-diff-derived number, so
grouping/collapsing can never desync it. A test asserts it renders identically in
both modes.

### 8. Per-line finding markers — a domain-free slot in the shared diff viewer

The marker must be **persistently visible on the exact line of the exact file**,
not a per-file badge you scroll from. Revision 1's `focus`/`diffLineId`
scroll-into-view mechanism is **dropped entirely** — no `focus` prop, no
`diffLineId`, no in-panel scrolling.

`src/components/diff-viewer/` is the cross-route primitive layer and must not
learn the words "finding" or "severity" (frontend-ui-architecture: shared may not
import feature vocabulary). It already has the right precedent —
`DiffCommentApi` is an injected capability, not a hard-coded feature. So:

- **`CodeLine.tsx`** accepts an optional
  `renderLineMarker?: (args: { path: string; line: number }) => React.ReactNode`.
  When `ln.newNo != null`, it calls it and renders the returned node inside the
  line row (in the gutter area, before the line number, so it is visible without
  horizontal scrolling and never shifts the code text). Returning
  `null`/`undefined` renders nothing. The component knows nothing about what the
  node is.
- **`FileCard.tsx`** and **`DiffViewer.tsx`** accept the same optional prop and
  pass it straight through.
- Existing callers pass nothing → rendering is byte-identical to today.
- `styles.ts` gains only a neutral positioning style for the marker slot; all
  colour/iconography lives in the caller (`SmartDiffViewer`).

`SmartDiffViewer` supplies the implementation: for `(path, line)` it looks up
that file's `findings` refs from the smart-diff response, resolves each
`finding_id` against the loaded `FindingRecord[]` for severity/title, and renders
one small severity-coloured **`<button>`** per finding (stacked when several share
a line) with an `aria-label` naming the severity and title. If the review data
has not loaded yet, it renders a neutral (uncoloured) marker with a generic label
rather than nothing, so markers never flicker in and out. Clicking is §10.

### 9. Large-file highlighting

In Smart mode only, a file whose `additions + deletions` exceeds a threshold gets
a visually distinct card — a warning-toned left border/outline plus a small
"large file" chip in its header — signalling "review this carefully".

- Purely client-side and purely derived: computed from `SmartDiffFile.additions`
  / `deletions`, which the contract already carries. **No contract change, no
  server change** for this requirement.
- The threshold is `LARGE_FILE_LINES = 150` in the **SmartDiffViewer folder's own
  `constants.ts`** (frontend-ui-architecture rung 2: one consumer → keep it
  local), together with the chip's colour token.
- **Do not reuse `SIZE_SMALL_MAX` / `SIZE_MEDIUM_MAX`** from
  `client/src/app/repos/[repoId]/pulls/constants.ts:30-31`. They exist, but they
  bucket a **whole PR** into S/M/L — a different unit of measure. A 400-line
  *file* is enormous, while a 400-line PR is merely "L". Reusing them would make
  the highlight almost never fire and would couple two unrelated thresholds. This
  is a deliberate rejection, recorded so it is not "fixed" during review.
- Distinct from `split_suggestion.too_big`, which is a **per-PR** signal rendered
  as a banner above the groups (§3). Both may appear at once; they are different
  statements.
- Label from a new i18n key `prReview.smartDiff.largeFile`.

### 10. Clicking a marker navigates to that finding's card on the Agent runs tab

The single most error-prone part of this feature. Hard requirements: the click
uses the app's own client-side routing; it lands on the **specific finding's
card** inside the **Agent runs** tab; it is **not** a popup, **not** a modal,
**not** a github.com link, and **not** merely the top of the file or the top of
the tab.

The mechanism extends the pattern that already works one level up, at *run*
granularity (Timeline → run accordion), down to *finding* granularity. That
existing wiring is: `RunHistory.tsx:166-184` → `FindingsTab.tsx:86-89`
(`setTarget({ runId, n: n + 1 })`) → `ReviewRunAccordion.tsx:33-34, 51-57`
(effect on `targetRunId`/`targetNonce` → `setOpen(true)` +
`rootRef.current?.scrollIntoView(...)`; the root already carries
`id={`review-run-${run_id}`}` and `scrollMarginTop: 16`). Mirror its shape,
including the **nonce** — without it, clicking the same finding twice would not
re-fire the effect.

**Step 1 — make a finding card addressable.** `FindingCard.tsx:55` currently has
only `data-finding-id={f.id}`. Add a real `id={\`finding-${f.id}\`}` (keep the
existing data attribute — tests/e2e selectors may rely on it) and
`scrollMarginTop` in `styles.ts`'s `card()` so the scrolled-to card is not hidden
under sticky chrome.

**Step 2 — thread a finding target down, mirroring `targetRunId`.** New props
`targetFindingId?: string | null` and `targetFindingNonce?: number`, passed
`page.tsx` → `FindingsTab` → `ReviewRunAccordion` → `FindingsPanel` (consumed
there; `FindingCard` needs no new prop beyond its `id`):

- **`page.tsx` owns the state**:
  `const [findingTarget, setFindingTarget] = React.useState<{ id: string; n: number } | null>(null)`.
  It must live here, **not** in `FindingsTab`, because `FindingsTab` is unmounted
  while the Files changed tab is active — state set from `DiffTab` would be lost
  the moment the tab switches. `page.tsx` stays mounted across tab changes (the
  tab is a query param on the same route), so the target survives the switch.
- **`DiffTab`** receives one new callback prop
  `onOpenFinding: (findingId: string) => void`. `page.tsx` implements it as:
  `setFindingTarget((p) => ({ id: findingId, n: (p?.n ?? 0) + 1 })); setTab("findings");`
  — `setTab` is the existing helper (`page.tsx:62-68`, `router.replace` with the
  `tab` param), so the tab change goes through the URL and stays back-button
  safe. Set the target **before** switching, so `FindingsTab` mounts with it
  already in place.
- **`ReviewRunAccordion`** gains, next to its existing `targetRunId` effect, a
  second condition: if `review.findings.some((f) => f.id === targetFindingId)`,
  `setOpen(true)`. It does **not** scroll for the finding case — the card's own
  scroll (below) is the more precise target and would otherwise fight it.
  Deps: `[targetFindingId, targetFindingNonce, review.findings]`.
- **`FindingsPanel`** does the scroll, in an effect keyed on
  `[targetFindingId, targetFindingNonce, shown]`: if `targetFindingId` matches a
  finding in `shown`, set `focusIdx` to its index (reusing the existing
  `focused={i === focusIdx}` highlight — no new highlight styling needed) and
  `document.getElementById(\`finding-${id}\`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })`.
  Because the panel only renders once its accordion is open, the accordion's
  `setOpen(true)` naturally sequences before this effect — **no
  `requestAnimationFrame` or `setTimeout` hack is needed or permitted.**
- **Filter escapes (the subtle failure mode).** The target finding can be hidden
  by either existing filter, in which case the scroll silently does nothing. Both
  must be handled:
  - `FindingsPanel.tsx:32` `hideLow` — if `targetFindingId` is present in
    `findings` but absent from `shown`, set `hideLow` to `false` in the same
    effect and let the next render perform the scroll.
  - `FindingsTab.tsx:96` `selectedSeverity` — when a **new** finding target
    arrives (nonce changed), clear it to `null` so no severity filter can hide
    the target.
- **Cold-tab data readiness.** `runs` come from `usePrReviews(prId)` called in
  `page.tsx:40` — page-level, so the data is already loaded (or in flight)
  regardless of which tab is active; `DiffTab` needs no fetch of its own. If the
  runs array is still empty when the tab switches, no accordion is mounted and no
  effect fires; when the data arrives, the accordions mount **with the target
  props already set**, and their mount-time effects evaluate the target then.
  Therefore: **do not clear the target after use**, and **do not** gate the
  handoff on data being loaded — but **do** make every target effect a no-op when
  the id matches nothing, so an empty/stale array can never scroll to the wrong
  place or throw.
- The existing run-level `target` state stays exactly where it is
  (`FindingsTab.tsx:86`) and is not merged with the finding target.

**Step 3 — the click handler.** In `SmartDiffViewer`, the marker `<button>`'s
`onClick` calls `onOpenFinding(finding_id)` and nothing else: no `router` import
inside `SmartDiffViewer`, no `window.open`, no `href`. Routing stays in
`page.tsx`, which already owns `setTab` — this also keeps `SmartDiffViewer`
render-pure and trivially testable with a spy prop.

**Data-flow summary:** `finding_id` comes from the server (§6, authoritative);
severity/title for the marker and the owning run come from the already-loaded
`usePrReviews` data. `page.tsx` passes its existing `allFindings`
(`page.tsx:72-75`) into `DiffTab` as a new `findings` prop, so `SmartDiffViewer`
can resolve ids without a second fetch or an ambiguous client-side (file, line)
join.

### 11. `SmartDiffViewer` composition and placement

Placement: `…/[number]/_components/DiffTab/_components/SmartDiffViewer/` — one
consumer (`DiffTab`), colocated next to it, matching the existing
`RunTraceDrawer/_components/…` precedent. It must **not** go into
`@devdigest/ui` (domain-free) nor into `src/components/diff-viewer/` (the
cross-route primitive layer, which knows nothing about findings).

Props:
`{ files: PrFile[]; smartDiff: SmartDiff; findings: FindingRecord[]; commenting?: DiffCommentApi; onOpenFinding: (findingId: string) => void }`.

Rendering:

- One collapsible section per group, in the order received (the server guarantees
  `core` → `wiring` → `boilerplate`; do not re-sort). Header: role label from
  `prReview.smartDiff.{coreLabel,wiringLabel,boilerplateLabel}`, file count via
  `smartDiff.filesCount`, aggregate `+/-`, and the group's total finding count
  when > 0 — so findings inside a collapsed group are never invisible.
- `core` and `wiring` default **open**; `boilerplate` defaults **closed**
  (acceptance criterion). Group open state is local component state.
- Inside a group, render **one `FileCard` per file**, each inside its own wrapper
  `<div>` carrying the large-file highlight (§9) and the file's finding-count
  chip. This requires re-exporting `FileCard` from
  `src/components/diff-viewer/index.ts` (update that file's header comment, which
  currently explains why `CodeLine` is deliberately *not* exported — `FileCard` is
  the natural per-file unit and needs none of the comment machinery). Rendering N
  single-file `<DiffViewer>`s instead would nest N list containers and fight the
  shared layer's spacing — do not do that.
- `renderLineMarker` (§8) is built once per render in `helpers.ts` from
  `smartDiff` + `findings` and passed to every `FileCard`.
- **Joining the two data sources**: build `Map<path, PrFile>` from `files`. Each
  `SmartDiffFile` renders with its matching `PrFile` (for `patch`), or, if absent,
  with a synthesized `PrFile` carrying `patch: null` and the smart-diff file's own
  `additions`/`deletions`. Any `PrFile` present in `files` but in no group is
  appended to the **end of the first group**, so **no changed file is ever hidden
  from the reviewer**. Both cases are defensive (both sides read `pr_files`) and
  must be covered by a test.
- **The per-file finding chip is display-only** (a count, not a button). The
  clickable target is the per-line marker (§8/§10) — this is what "not just a
  per-file badge you scroll to" means in practice. Label from
  `prReview.smartDiff.findingLines`, whose English value changes to
  `"{count} findings"` (the key currently has no consumer, so nothing else moves).
- `pseudocode_summary` is `null` for now: render nothing when it is
  `null`/`undefined`/blank — never an empty element, never the string "null".
- Presentational only: no `api`/`fetch`/`router` import, no business logic in the
  component body. The path→file map, group aggregates, marker factory and
  large-file predicate are pure functions in the folder's `helpers.ts`, memoized
  at the call site with `React.useMemo`.

### 12. Cache invalidation

- `client/src/lib/hooks/smart-diff.ts` — `usePrSmartDiff(prId)`, query key
  `["pr-smart-diff", prId]`, `enabled: !!prId`. Exported from `hooks/index.ts`.
  The only place that talks to the endpoint.
- `page.tsx`'s `onRunDone` handler (next to `refetchReviews()`) and the
  `onSuccess` of `useDeleteRun` / `useDeleteReview` also invalidate
  `["pr-smart-diff", prId]` — markers must appear/disappear with the findings
  that back them.
- No polling, no `refetchInterval`: the classification is static for a given head
  SHA, and the review-completion path already invalidates.

### 13. Seed

Seeded PR #482 has four `pr_files` rows, none boilerplate, so "lockfiles start
collapsed" and the large-file highlight cannot be demonstrated without a live
GitHub token. In `src/db/seed.ts`, next to the existing four rows, add
`pnpm-lock.yaml` (+412/−87 — also over `LARGE_FILE_LINES`, so it exercises both
signals) and `dist/bundle.min.js` (+1/−1), both with `patch: null` like their
siblings. Keep the insert idempotent in the same way the surrounding block is.
This does not affect flows 02/04/05, which assert only `src/config.ts`.

### 14. Risks

| # | Risk | Mitigation (required, not advisory) |
|---|---|---|
| 1 | **The finding target lands nowhere** — wrong tab value, state lost on tab switch, a filter hiding the card, or the scroll firing before the accordion opened. The user flagged this as where people most often trip up. | Four named mitigations in §10: `?tab=findings` through the existing `setTab`; target state owned by `page.tsx` (survives the switch); explicit `hideLow`/`selectedSeverity` escapes; the scroll performed by `FindingsPanel`, which only mounts after the accordion opened (no timer hacks). Each gets its own test in step 13. |
| 2 | **Clicking the same marker twice does nothing.** | The `nonce` counter, copied from the existing run-level pattern. |
| 3 | **Target fires against an empty/stale runs array.** | Every target effect is a no-op when the id matches nothing; accordions mount with the target already in props, so late-arriving data resolves naturally (§10). |
| 4 | **A finding hides inside the collapsed `boilerplate` group.** | The group header always shows its aggregate finding count while collapsed; expanding is one click. Covered by a component test. |
| 5 | **Original mode leaks finding markers** (the requirement is zero). | Structural, not conditional: Original mode simply does not pass `renderLineMarker`. Asserted by a test that renders Original mode and queries for zero marker buttons. |
| 6 | **e2e flow 05 breaks** because the tab now groups files. | Smart is the default, `src/config.ts` is `wiring` (expanded); the loading/error path renders the flat viewer verbatim. `./scripts/e2e.sh` is a required verification step. |
| 7 | **The two vendored `brief.ts` copies drift.** | Constraint 7: both edited in one step, with a `diff` check in that step's "done when", and the contracts fixture updated alongside. |
| 8 | **Marker/chip counts disagree with the PR-list FINDINGS column or FindingsTab.** | One shared semantics definition (§2) + `pickLatestReviewIdPerAgent` as the server's single implementation; the `.it.test.ts` asserts the multi-agent case. |
| 9 | **Cross-workspace leak** on the new read (the exact bug logged in `server/insights.md` 2026-08-05). | The service's *first* action is the workspace-scoped pull lookup; the integration test asserts a 404 for another workspace's PR id. |
| 10 | **`scrollIntoView` does not exist in jsdom** → client tests crash. | Stub `Element.prototype.scrollIntoView` in the affected tests and assert it was called for the right element. |
| 11 | **Files with `patch: null`** (all seeded rows) render no lines, so they show no line markers. | Expected and acceptable: the file-level count chip still shows, and real imported PRs carry patches. Do not fabricate a line to compensate. |
| 12 | **Pattern overreach** — a business-logic file misclassified as `boilerplate`. | Precedence is documented and table-tested; nothing is removed from the response, only grouped; ungrouped files are still rendered (§11); Original mode is always one click away. |
| 13 | **An accidental model call sneaks in** via a copied service shape. | `SmartDiffService` takes no `Container`, so `container.llm`/`resolveFeatureModel` are unreachable; verification includes a grep over the module and an `agent_runs` count check. |

---

## Steps

Each step is independently reviewable. Run the owning package's `typecheck`
before moving on.

1. **[shared contracts] The `SmartDiffFile.findings` change (§6)** — edit
   `server/src/vendor/shared/contracts/brief.ts` and
   `client/src/vendor/shared/contracts/brief.ts` **identically**, and update the
   fixture in `server/test/contracts.test.ts:107-116`.
   Required skills: `zod` (schema shape + exported inferred type),
   `typescript-expert`.
   Done when: `diff server/src/vendor/shared/contracts/brief.ts client/src/vendor/shared/contracts/brief.ts`
   is empty, `grep -rn "finding_lines" server client --include=*.ts --include=*.tsx`
   returns nothing, and `cd server && pnpm test contracts` passes.

2. **[server] `modules/smart-diff/constants.ts`** — every pattern list and
   threshold from §1, with the precedence and test-file rationale as comments.
   No logic in this file.
   Required skills: `typescript-expert`, `onion-architecture` (ring 2:
   `constants.ts` is where literals live).
   Done when: no path fragment or numeric threshold appears anywhere else in the
   module.

3. **[server] `modules/reviews/helpers.ts` + `repository/review.repo.ts` +
   `repository.ts`** — pure `pickLatestReviewIdPerAgent(rows)`; the
   `latestFindingLocations(db, prId)` query from §5 (now including `findingId`);
   the facade method. Ordering `createdAt DESC, id DESC`; `dismissedAt IS NULL`;
   returns `FindingLocation[]`, never rows.
   Required skills: `drizzle-orm-patterns`, `onion-architecture` (row types die
   at the repository boundary), `engineering-insights` (tiebreaker +
   one-read-path rules).
   Done when: `modules/smart-diff/` contains **zero** `drizzle-orm` /
   `db/schema.js` imports and `pulls/routes.ts` is untouched.

4. **[server] `modules/smart-diff/classify.ts` + `split.ts` + `helpers.ts`** —
   pure `classifyPath`, `groupFiles`, `buildSplitSuggestion`, and the
   file→`SmartDiffFile` mapper (`pseudocode_summary: null`, `findings` refs per
   §2, ordering per §1). No I/O, no `Container`, no Fastify.
   Required skills: `onion-architecture` (ring 2 purity), `typescript-expert`.
   Done when: these files import only `@devdigest/shared` types and the module's
   own `constants.ts`.

5. **[server] `modules/smart-diff/service.ts`** — `SmartDiffService` with the
   explicit-deps constructor from §4 and one method
   `get(workspaceId, prId): Promise<SmartDiff>`: workspace-scoped pull lookup
   first (throw `NotFoundError` if absent) → `getPrFiles` →
   `latestFindingLocations` → pure composition → return.
   Required skills: `onion-architecture` (explicit deps, no `Container`),
   `typescript-expert`.
   Done when: the service compiles with no `fastify`, `drizzle-orm` or
   `platform/container.js` import, and a hermetic test drives it with a stub
   repository object.

6. **[server] `modules/smart-diff/routes.ts` + register in `modules/index.ts`** —
   the single `GET /pulls/:id/smart-diff` from §4: `schema: { params: IdParams }`,
   `getContext` for the workspace, thin handler (parse → service → return).
   Required skills: `fastify-best-practices`, `zod`, `onion-architecture`
   (ring 4 must not skip ring 2).
   Done when: `server/test/routes-smoke.test.ts` still passes and the route is
   registered through the `modules` registry, not ad hoc from `app.ts`.

7. **[server] Seed the two boilerplate files** for PR #482 (§13).
   Required skills: `drizzle-orm-patterns` (keep the block idempotent).
   Done when: `pnpm db:seed` run twice leaves the PR with exactly six
   `pr_files` rows.

8. **[server] Tests** — `test/smart-diff.test.ts` (hermetic): table-driven
   `classifyPath` cases (every lockfile name → `boilerplate`; `dist/index.ts` →
   `boilerplate` beats `wiring`; `package.json`, `tsconfig.json`,
   `src/api/index.ts`, `.github/workflows/ci.yml`, `src/config.ts` → `wiring`;
   `src/middleware/ratelimit.ts`, `src/foo.test.ts` → `core`); in-group and group
   ordering; empty groups omitted; the `findings` refs (one entry per undismissed
   finding, carrying the right `finding_id`, ascending by line, duplicates on one
   line preserved, dismissed excluded, unmatched file ignored); split suggestion
   below/above threshold, remainder bucket, every file present exactly once; and
   `SmartDiff.parse(result)` succeeding on a fully-built response.
   `test/smart-diff.it.test.ts` (real Postgres): a PR with two agents' reviews
   returns the union of both agents' latest findings; a re-run of the same agent
   supersedes its own older review; a PR with no review returns empty `findings`
   arrays and still groups files; another workspace's PR id → 404.
   Required skills: `zod` (parse the built object against the contract),
   `drizzle-orm-patterns`, `engineering-insights` (the `*.it.test.ts` suffix rule).
   Done when: both `pnpm exec vitest run --exclude '**/*.it.test.ts'` and
   `pnpm exec vitest run .it.test` are green.

9. **[client] `src/lib/hooks/smart-diff.ts` + barrel export** — `usePrSmartDiff`
   per §12, importing `SmartDiff` from `@devdigest/shared` (matching
   `hooks/intent.ts`).
   Required skills: `frontend-ui-architecture` (data access only in the hooks
   layer), `react-best-practices`.
   Done when: no component imports `api` for this endpoint.

10. **[client] The domain-free marker slot in `src/components/diff-viewer/`** —
    optional `renderLineMarker` on `CodeLine`/`FileCard`/`DiffViewer`, the neutral
    positioning style, and the `FileCard` re-export from `index.ts` with its
    header comment updated (§8, §11). **No** `focus` prop and **no** `diffLineId`
    — revision 1's scroll design is not implemented.
    Required skills: `frontend-ui-architecture` (this layer stays domain-free —
    no "finding"/"severity" vocabulary enters it), `react-best-practices`,
    `typescript-expert` (optional props keep every existing caller unchanged).
    Done when: rendering with no `renderLineMarker` is byte-identical to today
    and `cd client && pnpm test` is still green.

11. **[client] Finding-target plumbing (§10 steps 1-2)** — `FindingCard` gets a
    real `id` + `scrollMarginTop`; `targetFindingId`/`targetFindingNonce` are
    threaded `page.tsx` → `FindingsTab` → `ReviewRunAccordion` → `FindingsPanel`;
    the accordion force-opens when it owns the target; the panel sets `focusIdx`
    and scrolls; both filter escapes (`hideLow`, `selectedSeverity`) are
    implemented; `page.tsx` owns `findingTarget` state and exposes
    `onOpenFinding`.
    Required skills: `react-best-practices` (effect deps incl. the nonce, no
    timer hacks, no duplicated derived state), `frontend-ui-architecture` (state
    owned by the common ancestor that survives the tab switch),
    `next-best-practices` (tab change through the existing `setTab`/router
    helper, not a hand-built URL).
    Done when: calling `onOpenFinding(id)` from anywhere lands on that finding's
    card with the correct accordion open, and the existing Timeline→run
    navigation still works unchanged.

12. **[client] `SmartDiffViewer` + toggle + large-file highlight + DiffTab
    wiring** — the new colocated folder per §11 (`SmartDiffViewer.tsx`,
    `constants.ts` with `LARGE_FILE_LINES`, `helpers.ts`, `styles.ts`,
    `index.ts`); the Smart/Original toggle and split banner in `DiffTab` (§7);
    `page.tsx` passing `findings` + `onOpenFinding` into `DiffTab`; the i18n
    edits (`findingLines` value → `"{count} findings"`; new `orderSmart`,
    `orderOriginal`, `largeFile` keys).
    Required skills: `frontend-ui-architecture` (placement; no domain code in
    `@devdigest/ui`), `react-best-practices` (module-scope pure helpers, real
    `<button>`s, no router import in the presentational component),
    `next-best-practices` (`"use client"` at this boundary only).
    Done when: Smart is the default, groups render core-first, `boilerplate`
    starts collapsed, markers sit on the right lines, large files are highlighted,
    Original mode shows no markers, and the files count is unchanged in both modes.

13. **[client] Tests** — `SmartDiffViewer.test.tsx`: three group headers, core
    first; a lockfile hidden until `boilerplate` is expanded, with the group
    header still showing its finding count; a line marker renders for a finding's
    line and clicking it calls `onOpenFinding` with the right `finding_id`
    (**not** a navigation, **not** an anchor `href`); a file over
    `LARGE_FILE_LINES` gets the highlight and one under it does not; a `null`
    `pseudocode_summary` renders nothing; a file in `files` but in no group is
    still rendered; a group file with no matching `PrFile` renders without
    crashing.
    `DiffTab` test: Original mode renders zero marker buttons; the
    "Files changed · N files" header is identical in both modes.
    `FindingsPanel` / `ReviewRunAccordion` tests (or one integration-style
    `FindingsTab` test): a target finding opens the right accordion, scrolls the
    right card (stubbed `scrollIntoView`), and is revealed even when `hideLow` or
    a severity filter would have hidden it.
    Required skills: `react-testing-library` (query by role/label, no
    implementation details), `react-best-practices`.
    Done when: `cd client && pnpm test` is green with `fetch` mocked and
    `Element.prototype.scrollIntoView` stubbed.

14. **[docs] Fold in the durable parts** — add `smart-diff` to
    `server/CLAUDE.md`'s module list in "Where things live"; append entries to
    `server/insights.md` and `client/insights.md` under the **exact existing
    headings** for anything genuinely learned (e.g. the pre-existing unused
    `smartDiff.*` i18n block; the shared diff viewer having had no marker slot;
    the "target state must live above the tab switch" lesson; whichever
    classification pattern proved wrong in practice). Date each entry `YYYY-MM-DD`
    from the session context, italic, append-only.
    Required skills: `engineering-insights`.
    Done when: no new or renamed headings were introduced and nothing obvious
    from reading the code was logged.

---

## Skills the implementer must apply

- **`zod`** — steps 1, 6, 8: the one `SmartDiffFile` shape change with its
  exported inferred type, both vendor copies kept identical, the contracts
  fixture updated, and the hermetic test parsing the built response against the
  contract.
- **`onion-architecture`** — steps 2-6: the new module's ring split
  (`routes.ts` ↔ `service.ts` ↔ pure files), explicit service deps instead of
  `Container`, row types dying at the repository boundary, and *not* copying the
  grandfathered "query in the route" pattern from `pulls`.
- **`fastify-best-practices`** — step 6: plugin-per-domain registration through
  `modules/index.ts`, `schema:`-declared params, thin handler.
- **`drizzle-orm-patterns`** — steps 3, 7, 8: the two-query
  latest-review-per-agent read with a stable `ORDER BY … , id DESC`, the
  `dismissedAt IS NULL` filter, and the idempotent seed insert.
- **`postgresql-table-design`** — read-only here: it is what confirms
  `pr_files`/`reviews`/`findings` already carry everything this feature needs and
  no migration or new column is warranted.
- **`frontend-ui-architecture`** — steps 9-13: `SmartDiffViewer` colocated under
  its single consumer; findings vocabulary kept out of
  `src/components/diff-viewer/` (injected `renderLineMarker` slot instead) and out
  of `@devdigest/ui`; `LARGE_FILE_LINES` colocated rather than reusing the
  PR-level size constants; all data access through `src/lib/hooks/*`; the finding
  target owned by the common ancestor that survives the tab switch.
- **`react-best-practices`** — steps 10-13: pure helpers at module scope, effects
  used only for the DOM scroll side effect, the nonce re-trigger, no
  `setTimeout`/`rAF` sequencing hacks, real `<button>`s, server state left in the
  query cache.
- **`next-best-practices`** — steps 11, 12: the tab change through the existing
  `setTab` (`router.replace` with the `tab` query param), client-component
  boundaries.
- **`react-testing-library`** — step 13, including the jsdom `scrollIntoView` stub.
- **`typescript-expert`** — throughout: optional props that keep every existing
  `DiffViewer`/`FileCard`/`FindingCard` caller unchanged, and null-safe
  `pseudocode_summary`.
- **`security`** — light but real: the new route is workspace-scoped like every
  sibling (no IDOR across workspaces), takes no user-controlled input beyond a
  uuid param validated by `IdParams`, logs no file contents, and the finding
  navigation stays in-app (no user-controlled URL is ever put in an `href`).
- **`engineering-insights`** — read `server/insights.md` and `client/insights.md`
  before starting (mandatory per module `CLAUDE.md`), and append at the end under
  existing headings only.

## Verification

Per module (commands from each module's `CLAUDE.md`):

```sh
cd server && pnpm typecheck && pnpm test
#   split check: pnpm exec vitest run --exclude '**/*.it.test.ts'
#                pnpm exec vitest run .it.test
cd client && pnpm typecheck && pnpm test
./scripts/e2e.sh        # flows 02/04/05 — flow 05 opens the Files changed tab
```

Static checks:

```sh
grep -rn "container\.llm\|completeStructured\|resolveFeatureModel\|container\.github" server/src/modules/smart-diff
#   → must print nothing  (the "no LLM call" guarantee)
diff server/src/vendor/shared/contracts/brief.ts client/src/vendor/shared/contracts/brief.ts
#   → must print nothing  (vendor copies identical)
grep -rn "finding_lines" server client --include=*.ts --include=*.tsx
#   → must print nothing  (old contract shape fully removed)
```

End-to-end check that proves the feature works:

1. `./scripts/dev.sh`, then `cd server && pnpm db:migrate && pnpm db:seed`
   (no new migration — this only confirms the DB is current and reseeds the two
   new boilerplate rows).
2. Open seeded PR #482 → **Files changed**. The header reads
   `Files changed · N files`; the **Smart order / Original order** toggle sits in
   the header row with **Smart order** active by default. Files are grouped
   **Core → Wiring → Boilerplate**; `pnpm-lock.yaml` and `dist/bundle.min.js` sit
   in **Boilerplate**, which is **collapsed** on arrival. Expanding reveals them.
3. **Files count + Original mode**: switch to **Original order** — the same
   `Files changed · N files` header is unchanged, the flat original file order is
   back, and **no finding marker appears anywhere** in the diff. Switch back to
   Smart; the count is still identical.
4. **Large file**: `pnpm-lock.yaml` (+412/−87) is visibly highlighted with the
   large-file chip in Smart mode; a small file (e.g. `src/config.ts`, +4/−0) is not.
5. `curl -s localhost:3001/pulls/<pr-uuid>/smart-diff | jq` → the response
   validates against `SmartDiff`: groups in role order, `pseudocode_summary: null`
   everywhere, each `findings[]` entry carrying both `line` and `finding_id`,
   `split_suggestion.total_lines` equal to the PR's ±.
6. **Navigation (the acceptance criterion for requirement 5)** — on a real
   imported PR with a real review, in Smart mode: click a severity marker sitting
   on a diff line. The app must (a) stay on `/repos/:repoId/pulls/:number` with
   the URL changing to `?tab=findings`, (b) show the Agent runs tab, (c) have the
   run accordion that owns that finding **open**, and (d) be scrolled to that
   finding's own card, which is visibly focused. It must **not** open a popup, a
   modal, a github.com tab, or land at the top of the file/tab. Navigate back to
   Files changed and click the same marker again — it must work a second time
   (the nonce).
7. **Filter escapes**: on the Agent runs tab, enable "hide low confidence" and
   select a severity filter that excludes your target finding, go back to Files
   changed, and click that finding's marker — the card must still be revealed and
   scrolled to.
8. **No-review case**: on a freshly imported PR with no review, Smart mode renders
   the same grouping with no markers, no chips and no errors.
9. **No model call**: watch the API log through steps 2-8 — no provider/model/
   token/cost line, and no new `agent_runs` row:
   `docker exec devdigest-postgres psql -U devdigest -d devdigest -c 'select count(*) from agent_runs'`
   before and after must match.
10. **Multi-agent consistency**: run two different agents on one PR, then compare
    the sum of the Smart Diff per-file finding chips with the PR-list FINDINGS
    column and the Findings tab aggregate — all three must agree.
11. **Split suggestion**: on a PR over 400 changed lines, the banner appears above
    the groups with proposed splits; below the threshold it is absent.

## Explicit note

Architecture and security review are **out of scope for the implementer** and
are handled by separate review agents/skills after implementation. Implement the
constraints this plan specifies (they are requirements, not review findings), but
do not re-litigate placement, the classification taxonomy, or the navigation
mechanism while coding — if something in the repo contradicts this plan, stop and
surface the discrepancy instead of working around it.

## Open questions / assumptions

1. **"Latest completed review run" is implemented as "each agent's latest
   review" (§2).** This deviates from the literal wording of the original task
   brief and is justified by `server/insights.md` (2026-07-30),
   `client/insights.md` (2026-07-30), and the need to agree with the PR list and
   the Findings tab. For single-agent PRs the readings are identical. A change
   would be one line inside `pickLatestReviewIdPerAgent`'s caller.
2. **The finding target is in-memory, not URL-persisted** — a reload on
   `?tab=findings` lands on the tab but not on the card. This deliberately
   mirrors the existing run-level limitation (`FindingsTab.tsx:86`). Making both
   URL-persisted (`?tab=findings&finding=<id>`) is a coherent follow-up and would
   also make the target shareable and e2e-assertable; deliberately not built now.
3. **The classification taxonomy is a judgement call.** Test files → `core`,
   docs/markdown → `wiring`, snapshots → `boilerplate` are deliberate choices
   documented in `constants.ts`, and Original mode is always one click away if a
   reviewer disagrees with the grouping.
4. **`LARGE_FILE_LINES = 150` is a first guess.** It is a single colocated
   constant precisely so it can be tuned after seeing real PRs; the PR-level
   `SIZE_*` constants were considered and rejected (§9).
5. **`pseudocode_summary` stays `null`.** The contract field is `nullish`, so no
   change is needed when a later lesson fills it in — but nothing here generates
   it, and the client must never assume it is present.
6. **The `smartDiff.*` i18n block already exists** in
   `client/messages/en/prReview.json:53-62` with no consumer — pre-built course
   scaffolding, like `rollupSeverities` was for the severity-counters lesson.
   This plan reuses it, changes the English value of `findingLines`, and adds
   `orderSmart` / `orderOriginal` / `largeFile`. `en` is the only locale in the
   repo, so there is no second file to sync.
7. **No caching layer.** The classification is recomputed per request from two
   small queries. If it ever becomes slow, `pr_brief` is the obvious place to
   memoize — deliberately not built now.
8. **No new e2e flow.** Flow 05 covers the tab shallowly. A dedicated Smart Diff
   flow (assert the toggle, expand Boilerplate, assert `pnpm-lock.yaml`, click a
   marker and assert `?tab=findings`) is a natural follow-up now that step 7 seeds
   boilerplate files — proposed, not planned; it would be materially easier if
   open question 2 (URL-persisted target) were done first.
