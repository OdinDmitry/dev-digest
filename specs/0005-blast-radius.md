# Development Plan: Blast Radius — `server` + `client` + `mcp`

> **Location/numbering note.** Root [`specs/`](README.md) holds cross-module
> Development Plans produced by `planner` and consumed by `implementer`;
> module-level `specs/` folders hold single-module *design* specs. This feature
> spans **three** packages (a new `server/` module + a shared contract, a new
> `client/` tab, and the real `mcp/` tool that `0004` shipped as a stub), so it
> lives here and takes the next number in root `specs/`'s own sequence
> (`0001-four-claude-code-subagents.md`, `0002-intent-layer.md`,
> `0003-smart-diff.md`, `0004-local-mcp-server.md` → `0005`).
>
> **Everything in §"Design decisions" is already decided.** The response
> contract shape, the file:line click-through mechanism, the traversal depth,
> the "no live-clone fallback on this route" rule, the MCP `depth` argument's
> fate and the exclusion of an in-app code viewer came from the user or from
> research done before this plan and must not be re-derived, re-researched or
> "improved" during implementation. If the repo contradicts something here,
> **stop and surface it** — see the Explicit note.

## Goal

Answer, for one already-imported pull request, the question *"what else might
this diff touch?"* — which symbols are declared in the PR's changed files, who
imports/calls those symbols, and which HTTP endpoints are reachable from the
changed code through the import graph. It is a **pure read over the existing
`repo-intel` Postgres index**: no LLM anywhere on the main path, and no AST
parse, no `ripgrep` scan and no import-graph rebuild at request time. Surfaced
three ways: a new Fastify route `GET /pulls/:id/blast`, a new **Blast** tab on
the PR detail page whose every `file:line` is a `github.com` deep link, and a
real `get_blast_radius` MCP tool replacing the `0004` stub.

## Out of scope

- **An in-app code viewer, a "read file by path" endpoint, or any new
  source-viewing component.** The user explicitly chose external GitHub blob
  links (`githubBlobUrl`, §7) over building a viewer, specifically to avoid
  this scope. The existing patch-based `DiffViewer`/`FileCard` cannot render a
  caller file that is not part of this PR's diff — that is *why* GitHub links
  are used, not a gap to close. **Do not re-open this.**
- **Threading the MCP `depth` argument through to the server.** The traversal
  depth is fixed at `BFS_DEPTH = 2` server-side (§4). `depth` stays in the tool's
  input schema for API stability (it already shipped in `0004`) and is
  deliberately ignored — a documented simplification, **not a TODO** (§10).
- **The optional one-paragraph LLM summary of the map.** Called out as an
  explicitly separated, optional final step (step 14) that may be skipped
  entirely; the required steps must make **zero** LLM calls.
- **Any DB schema change, migration, seed change, or new table.** Everything
  this feature reads (`symbols`, `references`, `file_edges`, `file_facts`,
  `file_rank`, `repo_index_state`) already exists (§3). `server/src/db/migrations/`
  is do-not-touch.
- **Changes to the indexer pipeline** (`repo-intel/pipeline/*`), the AST/depgraph
  adapters, or `INDEXER_VERSION`. This plan only *reads* the index.
- **`reviewer-core/`, `e2e/`.** No file in either changes.
- **The `BlastRadius`/`DownstreamImpact`/`BlastCaller`/`ChangedSymbol` contracts
  in `contracts/brief.ts`.** They belong to the never-built PR-brief feature,
  do not match the real facade shape, and are **not** to be force-fitted,
  edited, renamed or deleted (§6).
- **The PR description and demo video** from the ticket's acceptance criteria —
  process artifacts, not implementation.
- **Architecture and security review of the result** — see "Explicit note".

## Constraints

Verified against HEAD (branch `MCP`, 2026-08-07). Line numbers cited were
re-read for this plan; if one has moved, the named symbol is authoritative.

1. **`repo-intel` already models almost all of this — do not build a parallel
   graph layer.** `BlastResult` (`server/src/modules/repo-intel/types.ts:74-87`)
   already carries `changedSymbols`, `callers` (with `rank`), `impactedEndpoints`,
   `factsByFile?`, `degraded?`/`reason?` (`DegradedReason`, `:27-32`).
   `RepoIntel.getBlastRadius(repoId, changedFiles)` is the facade method
   (`types.ts:147`), implemented at `service.ts:220-304` with the Postgres-only
   `tryPersistentBlast()` at `service.ts:315-391`.
2. **`repo-intel/README.md:12` is explicit: features call `repoIntel.*`, they do
   not reimplement graph walks.** The 2-hop reverse-import walk therefore lands
   **inside `repo-intel`** (facade + repository), never inside the new `blast/`
   module. `blast/` owns HTTP shaping and workspace scoping, nothing else.
3. **Every table this feature needs already exists.** `file_edges` with its
   reverse-lookup index `file_edges_repo_to_idx` on `(repo_id, to_file)`
   (`server/src/db/schema/repo-intel.ts:55-68` — its own doc comment says this
   index "is what blast uses to walk 'who depends on this file?' in O(degree)"),
   `file_facts` (`:75-88`), `file_rank` with `rank`/`percentile` (`:105-121`),
   `repo_index_state` with the `full|partial|degraded|failed` status enum
   (`:35-48`). **No migration. `server/src/db/migrations/` is do-not-touch.**
4. **Onion rings (`onion-architecture`).** `routes.ts` = ring 4 (parse →
   `getContext` → delegate → return DTO; no Drizzle, no logic); `service.ts` =
   ring 2 with **explicit constructor deps, never `Container`** — the four
   grandfathered `Container`-taking services are a closed set and this is a new
   module; `repository.ts` = ring 3, the only place with Drizzle. Row types
   (`$inferSelect`, `db/rows.js`) must **not** cross into the new service.
   Reference shape: `smart-diff/routes.ts:18-28` + `smart-diff/service.ts:14-40`.
5. **A module is not just a `routes.ts`.** Even a trivial read slice gets a
   service. `pulls`/`polling`/`settings`/`workspace` run Drizzle in `routes.ts`
   — that is a listed accepted violation, **not a pattern to copy**.
6. **Module registration is one import + one `Record` entry** in
   `server/src/modules/index.ts:13,40` (see the `smartDiff` entry). No
   filesystem autoload — that is deliberate (`index.ts:19-22`).
7. **Routes declare zod `params`/`body` schemas via `fastify-type-provider-zod`**
   (`server/CLAUDE.md`). `IdParams` (`modules/_shared/schemas.ts:11`) is the PR-id
   param schema. Existing read routes (`smart-diff`, `repo-intel`) declare **no**
   `response` schema — follow that; do not add one.
8. **Workspace scoping comes first, before any other query.** `smart-diff/service.ts:26-27`
   does `pullExists(workspaceId, prId)` → `NotFoundError` before anything else.
   `server/insights.md` (2026-08-05) records a real cross-workspace data leak
   caused by exactly one code path that skipped this check. Every branch of the
   new service must be workspace-scoped.
9. **`ORDER BY` on a non-unique key needs a tiebreaker** (`server/insights.md`,
   2026-08-04). This bites here twice in *existing* code: `service.ts:372`
   (`callers.sort((a, b) => b.rank - a.rank)` — `rank` ties constantly across a
   repo) and `service.ts:387` (`[...endpoints]` from a `Set`, i.e. DB row order).
   Both must become total orders (§5).
10. **Errors use `platform/errors.ts`** (`AppError`/`NotFoundError`/
    `ValidationError`, `:7-42`) and the `{ error: { code, message, details } }`
    envelope. A repository/adapter failure must not surface as a driver error.
11. **`@devdigest/shared` is vendored by copy, twice, and the copies drift.**
    `server/src/vendor/shared/` and `client/src/vendor/shared/` — a contract
    change must be manually re-synced (root `CLAUDE.md`; `client/insights.md`
    2026-08-05 records that the two copies are *not* byte-identical, so diff only
    the block you add). `mcp/` deliberately vendors **nothing** (`mcp/CLAUDE.md:40-46`).
12. **Barrel name collisions are a real, previously-hit failure mode.**
    `server/src/vendor/shared/index.ts` is `export *` over 11 contract files;
    `server/insights.md` (2026-08-04) records `TS2308` from a duplicate
    `AgentStats`. Grep the whole `contracts/` folder for **every** new exported
    name before adding it (§6).
13. **Client data fetching goes through one TanStack Query hook file per
    resource** under `client/src/lib/hooks/*`, never a raw `fetch` in a component
    (`client/CLAUDE.md`). Template: `hooks/smart-diff.ts:1-19`.
14. **Tab state is a `?tab=` query param, not a route segment**
    (`page.tsx:61,69`); tabs are declared in `PrDetailHeader.tsx:111-120` as
    `{ key, label, icon, count }` on the `Tabs` primitive; only the active tab's
    component is mounted (`page.tsx:149,151,179`).
15. **`messages/en/blast.json` already exists and is already loaded.**
    `client/src/i18n/request.ts:16-25` merges every `messages/en/*.json` file by
    filename into a namespace, so `useTranslations("blast")` works today with
    `stat.symbols`/`stat.callers`/`stat.endpoints`/`stat.crons`, `callerCount`,
    `noDownstream`, `graph.empty`. This is the same "pre-built i18n scaffolding
    waiting for its lesson" pattern logged in `client/insights.md` (2026-08-05):
    **reuse these keys, add missing ones to the same file, do not create a new
    namespace.**
16. **`githubBlobUrl(repoFullName, sha, file, startLine, endLine)`**
    (`client/src/lib/github-urls.ts:24-37`) is the file:line mechanism, already
    used by `FindingCard.tsx:46-49` and `ConventionCard.tsx`. It pins the link to
    a sha, so it needs `pr.head_sha` and `activeRepo.full_name` — both already in
    scope in `page.tsx` (`:94,142,161`).
17. **`mcp/` rules are unchanged from `0004`:** tools never import the MCP SDK,
    no handler ever rejects (a crashed stdio server is not auto-restarted), stdout
    is the JSON-RPC channel (stderr-only logging), `fetch` only in
    `devdigest/http.ts`, `process.env` only in `config.ts`, and narrow
    hand-written Zod wire parsers instead of vendored contracts
    (`mcp/CLAUDE.md:37-61`).
18. **`vitest` everywhere; DB-backed server tests use the `*.it.test.ts` suffix**
    (`server/CLAUDE.md`) — everything else must be hermetic. Client component
    tests mock `fetch`/`@/lib/api` (`DiffTab.test.tsx:9-14`). `mcp/` tests are
    hermetic against `test/helpers/fake-api.ts`.
19. **Do-not-touch:** `server/src/db/migrations/`. Also, per §"Out of scope",
    treat `repo-intel/pipeline/*` and `contracts/brief.ts` as untouchable in
    this plan.

## Affected modules & files

### `server/`

| File | Change |
|---|---|
| `src/modules/repo-intel/repository.ts` | **new method** `getImporters(repoId, toFiles)` — the reverse-edge query (§4) |
| `src/modules/repo-intel/service.ts` | `tryPersistentBlast()` — per-symbol caller cap fix + total ordering (§5) + the 2-hop endpoint walk (§4) |
| `src/modules/repo-intel/types.ts` | `BlastResult` gains `impactedEndpointRows?` + `callersTotal?`/`callersTruncated?`; new `BlastEndpointRow` (§4) |
| `src/modules/repo-intel/constants.ts` | new `MAX_BLAST_GRAPH_FILES`, `MAX_BLAST_CALLERS_TOTAL` |
| `src/modules/reviews/repository/pull.repo.ts` + `repository.ts` | **new method** `pullRepoId(workspaceId, prId)` — workspace-scoped `repo_id` projection (§3) |
| `src/modules/blast/routes.ts` | **new** — `GET /pulls/:id/blast` |
| `src/modules/blast/service.ts` | **new** — `BlastService`, explicit deps |
| `src/modules/blast/helpers.ts` | **new** — pure `BlastResult` + `IndexState` → `PrBlastRadius` mapper |
| `src/modules/blast/constants.ts` | **new** — the degraded/empty reason strings |
| `src/modules/index.ts` | one import + one `Record` entry |
| `src/vendor/shared/contracts/blast.ts` | **new** contract file (§6) |
| `src/vendor/shared/index.ts` | one `export *` line |
| `test/blast.test.ts` | **new** — hermetic service + helper coverage |
| `test/repo-intel-blast-graph.test.ts` | **new** — hermetic 2-hop walk + cap/ordering coverage |
| `test/blast.it.test.ts` | **new** — route through a real Postgres index |

### `client/`

| File | Change |
|---|---|
| `src/vendor/shared/contracts/blast.ts` | **new** — hand-synced copy of the server's (constraint 11) |
| `src/vendor/shared/index.ts` | one `export *` line |
| `src/lib/hooks/blast.ts` | **new** — `useBlastRadius(prId)` |
| `src/lib/hooks/index.ts` | one `export *` line |
| `src/app/repos/[repoId]/pulls/[number]/_components/BlastTab/{BlastTab.tsx,styles.ts,index.ts,BlastTab.test.tsx}` | **new** |
| `src/app/repos/[repoId]/pulls/[number]/_components/PrDetailHeader/PrDetailHeader.tsx` | one tab entry |
| `src/app/repos/[repoId]/pulls/[number]/page.tsx` | one import + one `{tab === "blast" && …}` block |
| `messages/en/blast.json` | add the missing keys alongside the existing ones |

### `mcp/`

| File | Change |
|---|---|
| `src/devdigest/wire.ts` | **new** `WireBlast*` parsers |
| `src/devdigest/api.ts` | 8th port method `getBlastRadius(prId)` |
| `src/devdigest/http.ts` | its `HttpDevDigestApi` implementation |
| `src/project.ts` | `projectBlast()` + `renderBlastText()` |
| `src/tools/schemas.ts` | `BlastRadiusResult` output schema |
| `src/tools/get-blast-radius.ts` | stub body → real implementation |
| `src/constants.ts` | drop `BLAST_RADIUS_NOT_IMPLEMENTED_MESSAGE`, add the new fixed strings |
| `src/instructions.ts` | one clause (§10) |
| `test/helpers/fake-api.ts` | `getBlastRadius` + `makeBlast()` |
| `test/tools.test.ts`, `test/http.test.ts`, `test/schema-budget.test.ts` | replace the stub assertions |
| `CLAUDE.md`, `README.md` | "a stub" → the real tool |

### Repo root

- `README.md` — no change needed: the L04 row already reads
  *"Blast Radius (reads `repo-intel`) via the `devdigest-mcp` server"*
  (`README.md:93`), which is exactly what this plan ships.

---

## Design decisions

The implementer must not re-derive any of these.

### §1 Two discrepancies found while writing this plan — read these first

Both are pre-existing and both are **in scope to fix here**, because the ticket's
own acceptance criteria depend on them.

1. **`MAX_CALLERS_PER_SYMBOL` is currently applied globally, not per symbol.**
   `constants.ts:29-30` documents it as *"Caller fan-out cap per changed symbol
   (ORDER BY rank DESC LIMIT N)"*, but `service.ts:386` does
   `callers.slice(0, MAX_CALLERS_PER_SYMBOL)` across the **whole flattened
   list** — so a PR touching 30 symbols returns 20 callers total, most symbols
   showing none. The ticket's step 4 ("cap at 20 callers **per symbol**")
   requires the documented behaviour. Fix per §5.
2. **`BFS_DEPTH = 2` (`constants.ts:49`) exists but is consumed only by
   `getCriticalPaths()` (`service.ts:663-701`).** Endpoint attribution in
   `tryPersistentBlast` is **1 hop today**: it reads `file_facts` for the caller
   files only (`service.ts:376-382`). The ticket's step 5 asks for a 2-level
   reverse-import walk. Build it per §4.

Two things that look like gaps but are **not** — do not "fix" them:

- `getResolvedCallers` (`repository.ts:503-531`) has no explicit
  `from_path != decl_file` filter, yet is correctly cross-file: `decl_file` is
  only ever populated by joining through a `file_edges` row
  (`repository.ts:406-424`), and a file does not import itself. Adding a
  redundant self-filter is noise.
- `pr_files.path` and the index's `symbols.path`/`file_edges.*` use the same
  repo-relative form. `run-executor.ts:479-482` already feeds PR file paths
  straight into `repoIntel.getFileRank(repoId, changedFiles)` and gets hits.
  No path normalisation layer is needed.

### §2 Where the work lives — the ring map for this feature

| Ring | Files | Owns |
|---|---|---|
| 0 domain | `vendor/shared/contracts/blast.ts` (both copies), `mcp/src/devdigest/wire.ts` | the wire shape |
| 2 application | `modules/blast/service.ts`, `modules/blast/helpers.ts`, `modules/blast/constants.ts`, `mcp/src/project.ts` | scoping, state decision, mapping |
| 2/3 facade | `modules/repo-intel/service.ts` (ring 2) + `repository.ts` (ring 3) | **all** graph traversal and SQL |
| 3 adapters | `modules/reviews/repository/pull.repo.ts`, `mcp/src/devdigest/http.ts` | SQL / HTTP |
| 4 delivery | `modules/blast/routes.ts`, `modules/index.ts`, `mcp/src/tools/get-blast-radius.ts`, the client tab | parse → delegate → render |

Hard rules, checkable by eye on the diff:

- `modules/blast/` contains **zero** Drizzle imports, **zero** `db/schema.js`
  imports, and no row types. It never touches `file_edges` — it asks
  `container.repoIntel`.
- `BlastService`'s constructor takes an explicit `BlastServiceDeps` interface,
  **not** `Container` (constraint 4). Model it on `SmartDiffServiceDeps`
  (`smart-diff/service.ts:14-16`): `{ reviews: Pick<ReviewRepository,
  'pullRepoId' | 'prFileSummaries'>; repoIntel: RepoIntel }`. `routes.ts`
  constructs it once at plugin load, exactly like `smart-diff/routes.ts:21`.
- The route body is four lines: `getContext` → `service.get(workspaceId, id)` →
  return. Compare `repo-intel/routes.ts:32-41`.

### §3 `GET /pulls/:id/blast`

```
GET /pulls/:id/blast   params: IdParams (uuid)   → PrBlastRadius
```

- **No rate limiter of its own.** Pure read, cannot spend money; the global
  120/min limiter applies. Same comment as `smart-diff/routes.ts:23`.
- **No `response` zod schema** (constraint 7) — the handler's TS return type is
  `PrBlastRadius`.
- **Changed files come from `prFileSummaries(prId)`**
  (`reviews/repository.ts:48-50` → `pull.repo.ts:50-58`), the same lightweight
  read `smart-diff` uses. **Never** `GET /pulls/:id`'s full detail (it does a
  live GitHub round-trip and carries every patch — `server/insights.md`
  2026-07-30).
- **`prFileSummaries` does not return `repoId`.** Add a narrow, domain-projected,
  workspace-scoped repository method rather than reaching for `getPull` (whose
  `PullRow` must not cross into a ring-2 service, constraint 4):

  ```ts
  // reviews/repository/pull.repo.ts — mirrors prFileSummaries' explicit .select({})
  export async function pullRepoId(db, workspaceId, prId): Promise<string | null>
  ```
  `SELECT repo_id FROM pull_requests WHERE workspace_id = ? AND id = ?`. It is
  simultaneously the existence check and the repo lookup, so it **replaces**
  `pullExists` here; `null` → `throw new NotFoundError('Pull request not found')`
  as the service's very first act (constraint 8). Expose it on `ReviewRepository`
  next to `prFileSummaries`.

**Service algorithm — fixed, in this order:**

1. `repoId = await reviews.pullRepoId(workspaceId, prId)`; `null` → `NotFoundError`.
2. `files = await reviews.prFileSummaries(prId)` → `changedFiles = files.map(f => f.path)`.
   If empty → return the **empty-but-ok** result: `state: 'ok'`, `reason: null`,
   all arrays `[]`, `callers_total: 0`. (An empty diff is a real answer, not a
   degradation.)
3. `indexState = await repoIntel.getIndexState(repoId)` — never throws
   (`types.ts:143`, `service.ts:196-205`).
4. **Gate.** If `indexState.status` is `'degraded'` or `'failed'`, **or**
   `indexState.degraded === true` → return `state: 'degraded'` with all arrays
   empty and `reason` = `indexState.degradedReason ?? indexState.status`,
   **without calling `getBlastRadius` at all**.
5. Otherwise `blast = await repoIntel.getBlastRadius(repoId, changedFiles)`.
   If it still comes back `degraded: true` (belt and braces), map to
   `state: 'degraded'` with `reason = blast.reason`.
6. `state = indexState.status === 'partial' ? 'partial' : 'ok'`;
   `reason = state === 'partial' ? 'index_partial' : null`.

**Why the step-4 gate is load-bearing, not defensive padding.**
`getBlastRadius` falls through to a **live-clone, request-time `ripgrep`/AST
scan** (`service.ts:236-303`, via `container.codeIndex.symbols/references` and
`readClone`) whenever `tryPersistentBlast` returns `null` — which is exactly the
unindexed case. That directly violates the acceptance criterion *"Server does
not rebuild the AST/import graph during the request."* Gating on
`getIndexState()` first makes the fallback **structurally unreachable from this
route**, so the request path is Postgres-only by construction. It also *is* the
ticket's step 6 ("return a partial/degraded state with an explanation — never
mask missing data as an empty array"). Both requirements are satisfied by the
same three lines.

A hermetic test must pin this: build the service with a `repoIntel` stub whose
`getBlastRadius` **throws** and whose `getIndexState` returns
`status: 'degraded'`, and assert the route still returns `state: 'degraded'`
(i.e. `getBlastRadius` was never called).

### §4 The 2-hop reverse-import endpoint walk — inside `repo-intel`

Per constraint 2 this lands in the facade, not in `blast/`.

**New repository method** (`repo-intel/repository.ts`, next to `getEdges`):

```ts
/** Reverse edges: who imports any of `toFiles`. Served by file_edges_repo_to_idx. */
async getImporters(repoId: string, toFiles: string[]): Promise<IndexerEdgeRow[]>
```
`SELECT from_file, to_file FROM file_edges WHERE repo_id = ? AND to_file IN (...)`,
returning `{ fromFile, toFile }`. Early-return `[]` on an empty `toFiles`, like
every other list method there.

**Use `getImporters`, not `getEdges`.** `getEdges(repoId)` (`repository.ts:432-437`)
pulls the *entire* graph — up to `MAX_INDEXED_FILES = 5000` files' worth of edges
— to answer a question about a handful of files. The `(repo_id, to_file)` index
exists precisely for this lookup and its own schema comment says so
(`db/schema/repo-intel.ts:66`). Two indexed `IN` queries beat one full-table
read; this is the `drizzle-orm-patterns` / `postgresql-table-design` "index the
access path you actually query" rule applied to an index that is already there.

**New private helper on `RepoIntelService`:**

```ts
private async reverseImportClosure(
  repoId: string,
  seeds: string[],
): Promise<{ hopByFile: Map<string, number>; truncated: boolean }>
```

- Two rounds (`BFS_DEPTH = 2`), each one `getImporters` call — **not** a
  per-file loop. Round 1 seeds = `changedFiles` → importers at hop 1. Round 2
  seeds = the hop-1 set → importers at hop 2.
- Reuse the existing `BFS_DEPTH` constant. Write the loop as
  `for (let hop = 1; hop <= BFS_DEPTH; hop += 1)`, so the depth is one constant,
  not a hard-coded 2.
- A file already seen (including a changed file, hop 0) keeps its **lowest** hop
  and is not re-expanded — cycles are common in real import graphs and this is
  what terminates the walk.
- **Cap.** `MAX_BLAST_GRAPH_FILES = 300` (new, in `repo-intel/constants.ts`)
  total visited files across both hops. A hub file (`utils/index.ts`) can have a
  four-figure importer set and the answer is not more useful at 1200 files than
  at 300. On overflow, keep the first `MAX_BLAST_GRAPH_FILES` **after sorting
  the round's candidates by `file_rank.rank` DESC** (reuse `getFileRankFor`) so
  the truncation keeps the *important* files, and set `truncated = true`.

**Endpoint attribution** replaces `service.ts:376-382`:

- `factFiles` = changed files (hop 0) ∪ closure (hops 1–2). Hop 0 is included
  deliberately: a changed file that *is* a route file is the most directly
  impacted endpoint of all, and today's code misses it.
- One `getFileFacts(repoId, factFiles)` call (`repository.ts:534-549`).
- Produce a new typed row per (endpoint, file):

  ```ts
  export interface BlastEndpointRow {
    endpoint: string;   // "METHOD /path", from file_facts.endpoints
    file: string;       // the file whose file_facts declared it
    hops: number;       // 0 = the changed file itself, 1 = importer, 2 = importer-of-importer
  }
  ```
- Dedupe on `endpoint` keeping the **lowest** `hops` (and, on a tie, the
  lexicographically first `file`) — one endpoint, one row, attributed to its
  shortest path from the diff.

**`BlastResult` grows additively — nothing existing changes shape.**
`impactedEndpoints: string[]` stays exactly as it is (it is the only form the
degraded ripgrep path can produce, and `test/repo-intel-facade-degraded.test.ts:54-65`
asserts on it). Add, as optionals present only on the persistent path — the same
convention `factsByFile` already documents at `types.ts:79-84`:

```ts
impactedEndpointRows?: BlastEndpointRow[];
endpointsTruncated?: boolean;
callersTotal?: number;       // pre-cap, pre-truncation count
callersTruncated?: boolean;
```

`getBlastRadius` has exactly one consumer in the repo today — nothing in
`run-executor.ts` reads it (it uses `getCallerSignatures`/`getFileRank`), so
this extension has no other call sites to update. Confirm that with a grep
before editing; if a second consumer has appeared, **stop and surface it**.

### §5 Caller capping and total ordering

Replacing `service.ts:354-372,386`:

- **Group callers by `viaSymbol`**, sort **within each group**, slice each group
  to `MAX_CALLERS_PER_SYMBOL` (= 20, unchanged), then flatten. This is what the
  constant already claims to do (§1.1).
- **Then** apply a new global ceiling `MAX_BLAST_CALLERS_TOTAL = 200` (new, in
  `repo-intel/constants.ts`) so a 40-symbol PR cannot return 800 rows.
  `callersTotal` reports the count **before** both caps; `callersTruncated` is
  `true` when either fired.
- **Every sort is total** (constraint 9 — this is the exact bug class logged on
  2026-08-04):
  - callers: `rank` DESC, then `file` ASC, then `line` ASC, then `viaSymbol` ASC.
  - changed symbols: `file` ASC, then `name` ASC, then `kind` ASC.
  - endpoint rows: `hops` ASC, then `endpoint` ASC, then `file` ASC.
  - `impactedEndpoints` (the flat legacy array): sorted ASC, not `[...set]`.
- The existing `.includes('.')` skip for qualified `Class.method` dual-emits
  (`service.ts:329`) and the `enclosingFromRows` attribution stay as they are.

### §6 The response contract — a **new** file, new names

**Decision (do not re-litigate): a new `contracts/blast.ts`, not an edit to
`contracts/brief.ts`.** `brief.ts` already exports `BlastRadius`, `BlastCaller`,
`ChangedSymbol` and `DownstreamImpact` (`:16-44`) for the never-built PR-brief
composition; they lack any degraded/state flag and do not match the facade.
`test/contracts.test.ts:68-80` parses `BlastRadius` in its current shape, and the
barrel is `export *` — so reusing or renaming those names is both a test break
and the `TS2308` collision class from `server/insights.md` (2026-08-04). New
file, distinct `PrBlast*` prefix, zero edits to `brief.ts`.

`server/src/vendor/shared/contracts/blast.ts` (then `export * from
'./contracts/blast.js';` in `index.ts`, then **hand-copied to
`client/src/vendor/shared/`** — constraint 11):

```ts
export const PrBlastState = z.enum(['ok', 'partial', 'degraded']);

export const PrBlastSymbol   = z.object({ file, name, kind });                       // all string
export const PrBlastCaller   = z.object({ file, symbol, via_symbol, line: int, rank: number });
export const PrBlastEndpoint = z.object({ endpoint, file, hops: int });

export const PrBlastRadius = z.object({
  pr_id: z.string(),
  repo_id: z.string(),
  state: PrBlastState,
  reason: z.string().nullable(),          // null when state === 'ok'
  changed_files: z.array(z.string()),
  changed_symbols: z.array(PrBlastSymbol),
  callers: z.array(PrBlastCaller),
  callers_total: z.number().int(),        // before the per-symbol + global caps
  callers_truncated: z.boolean(),
  impacted_endpoints: z.array(PrBlastEndpoint),
  endpoints_truncated: z.boolean(),
});
```

Fixed decisions inside this shape:

- **snake_case on the wire**, matching every existing contract; the facade's
  camelCase dies in `blast/helpers.ts` (a pure mapper — that is what `helpers.ts`
  is for).
- **`reason` is `z.string().nullable()`, not an enum.** The values come from
  `DegradedReason`, a server-internal union that may grow; duplicating it in a
  shared contract creates a second source of truth. The client renders it
  through a lookup map with a generic fallback (§7), so an unknown reason
  degrades to prose rather than throwing. Document this in a comment above the
  field — `zod`'s `schema-use-enums` rule is being consciously traded here for
  forward-compatibility across a package boundary.
- **`state` *is* an enum** — three values, owned by this contract, closed.
- **`impacted_endpoints` is the structured row form**, not the flat
  `string[]`. The flat legacy `BlastResult.impactedEndpoints` never reaches the
  wire; the route always serves `impactedEndpointRows`, falling back to mapping
  the flat array to `{ endpoint, file: '', hops: 1 }` **only** if a future
  degraded path somehow reaches step 5 (it cannot today, §3).
- **No `summary` field.** The optional LLM paragraph (step 14) would add
  `summary: z.string().nullable()`; the base contract ships without it, so
  skipping step 14 leaves no dangling always-null field.
- **Before adding each name, grep `server/src/vendor/shared/contracts/` for it**
  (constraint 12). `PrBlastState`, `PrBlastSymbol`, `PrBlastCaller`,
  `PrBlastEndpoint`, `PrBlastRadius` were checked free at plan time; re-check.

### §7 The client Blast tab

**Hook** — `client/src/lib/hooks/blast.ts`, a near-copy of `hooks/smart-diff.ts`:

```ts
export const blastKey = (prId) => ["pr-blast", prId];
export function useBlastRadius(prId: string | null | undefined) {
  return useQuery({ queryKey: blastKey(prId),
                    queryFn: () => api.get<PrBlastRadius>(`/pulls/${prId}/blast`),
                    enabled: !!prId });
}
```
Import the **vendored shared type**, not a locally-declared interface. The
`hooks/repo-intel.ts:14-24` local-interface precedent exists because `IndexState`
is a server-internal type with no contract; `PrBlastRadius` *is* a contract, so
follow `smart-diff`'s approach. Re-export from `hooks/index.ts`.

**Component** — `_components/BlastTab/BlastTab.tsx` (+ `styles.ts`, `index.ts`,
`BlastTab.test.tsx`), colocated per `client/CLAUDE.md`. Props:

```ts
{ prId: string | null; repoFullName: string | null; headSha: string | null }
```
`page.tsx` already holds all three (`:37,94,161-162`); pass them down rather than
re-deriving. Any sub-component extracted for readability stays **inside
`BlastTab/`** until a second consumer appears (`frontend-ui-architecture`'s
placement ladder) — do not promote anything to `@devdigest/ui` or to
`pulls/_components/`.

Layout, top to bottom:
1. A state banner when `state !== 'ok'` (§8).
2. A stat strip reusing the existing i18n keys: `stat.symbols`, `stat.callers`,
   `stat.endpoints`.
3. **Changed symbols → callers**: one card per changed symbol (`file`, `name`,
   `kind`), listing its callers (those whose `via_symbol` matches) with
   `file:line`, the enclosing `symbol`, and `rank`. `callerCount` and
   `noDownstream` are existing keys — use them.
4. **Potentially affected endpoints**: `endpoint` with its `file` and a hop
   label (`hops: 0` = "in this diff", 1 = "1 hop", 2 = "2 hops").

**Every `file:line` is a `<MonoLink href={githubBlobUrl(repoFullName, headSha,
file, line)}>` opening in a new tab** — the exact `FindingCard.tsx:46-49` shape,
including `href={undefined}` (rendering as plain text, not a dead link) when
`repoFullName` or `headSha` is missing. This applies to changed symbols, callers
**and** endpoint files, including files that are not in this PR's diff — that is
precisely why GitHub links are used rather than the diff viewer. **No new
viewer, no new endpoint, no `DiffViewer` reuse.**

**Tab registration:**
- `PrDetailHeader.tsx:115-119` tabs array gains
  `{ key: "blast", label: "Blast", icon: "Zap" }` after `diff`. `Zap` is a real
  icon in `vendor/ui/icons.tsx:29,111`.
- **No `count` on the tab.** A count would require fetching blast data in the
  header, i.e. on every PR page load whether or not the tab is opened. Leaving
  it off is the decision, not an omission.
- `page.tsx` gains one import and, after the `tab === "diff"` block
  (`:179-188`):
  `{tab === "blast" && <BlastTab prId={prId} repoFullName={repoFullName} headSha={pr.head_sha} />}`.

**i18n** — add the missing keys to the existing `messages/en/blast.json`
(constraint 15). Needed beyond what is already there: `tab` (the tab label),
`title`, `empty.*` (§8), `state.partial`, `state.degraded`, `reason.*` (one per
`DegradedReason` value + `unknown` fallback), `section.symbols`,
`section.endpoints`, `hops.direct|one|two`, `rank`. Keep the existing keys'
values untouched unless the English is wrong for the new context (the
`client/insights.md` 2026-08-05 precedent allows editing a value, never a key).

**No client-side re-derivation of "which callers belong to which symbol"
beyond the `via_symbol` grouping** — the server owns the semantics
(`client/insights.md` 2026-07-30 logs a real user-visible bug from the client
independently re-deriving a server aggregation).

### §8 Empty, partial and degraded states — three distinct UIs

The acceptance criteria call for a *clear empty state* **and** a *separate*
partial/degraded state. They must not collapse into one.

| Condition | UI |
|---|---|
| `state === 'ok'` and `changed_symbols.length === 0` | `EmptyState` primitive: "No symbols were found in this PR's changed files" + the reason it can happen (non-source files only, e.g. docs/config). Not an error. |
| `state === 'ok'`, symbols present, `callers.length === 0` | The existing `noDownstream` message key, per-symbol. Not a banner. |
| `state === 'partial'` | An **informational** banner above the results: the index is incomplete, results may be missing callers; a link to the repo's context page to re-index. Results are still rendered. |
| `state === 'degraded'` | A **warning** banner instead of results: this repository is not indexed (or indexing failed), so blast radius cannot be computed; re-index to enable it. Render `reason` through the `reason.*` lookup with an `unknown` fallback. **Never render empty arrays as "no impact".** |
| query `isError` | The existing `ErrorState` pattern used elsewhere on this page. |
| `callers_truncated` / `endpoints_truncated` | An inline note under the affected list ("showing the top N by file rank"). |

The banner copy must be prose the user can act on, not a raw enum value.

### §9 Security

Applying the `security` skill's confidence rule — only what is genuinely
reachable here.

- **A01 / IDOR is the one real risk, and §3 step 1 is the mitigation.** `:id` is
  an attacker-supplied uuid; `pullRepoId(workspaceId, prId)` is workspace-scoped
  and runs **first**, and `repoId` is read from that row, never from the request.
  There is no code path that derives `repoId` from user input.
  `server/insights.md` (2026-08-05) documents a real cross-workspace leak from a
  single branch that skipped this check — the service has no early-return branch
  that can skip it.
- **No filesystem read at request time** (§3 step 4) — so no path traversal
  surface, no `clonePath` interpolation, nothing to sanitize.
- **No LLM call** on the main path — no prompt-injection surface introduced by
  the route (step 14, if built, adds one and carries its own guard).
- **Content trust.** Symbol names, file paths and endpoint strings come from
  indexed third-party source code, i.e. attacker-influenceable text. In the
  client they are rendered as React children (auto-escaped) and only ever fed to
  `githubBlobUrl`, which `encodeURIComponent`s each path segment
  (`github-urls.ts:8-13`) — never into `dangerouslySetInnerHTML`, never as a raw
  `href`. In `mcp/` they are data inside labelled fields; every `next_step`
  string stays a constant from `constants.ts` with only validated arguments
  interpolated (`0004` §15 — unchanged).
- **Not applicable here:** authn/session work (the local API is no-auth by
  design, `0004` constraint 6), rate limiting beyond the global limiter (§3),
  file-upload and secrets handling (nothing is written or read from disk).

### §10 The MCP tool

**Port + adapter.** `DevDigestApi` grows an **8th** method, keeping the "one per
existing Fastify endpoint" property (`api.ts:12-27`):

```ts
getBlastRadius(prId: string): Promise<WireBlast>;
```
`HttpDevDigestApi.getBlastRadius` mirrors `listReviews` exactly
(`http.ts:80-83`): `assertUuid(prId, 'prId')`, then
`this.request('GET', \`/pulls/${encodeURIComponent(prId)}/blast\`, undefined, WireBlast)`
at the **default** timeout (it is a Postgres read, not a GitHub round-trip).

**Wire parsers** in `devdigest/wire.ts` — hand-written and narrow, because
`mcp/` deliberately vendors no contracts (constraint 17). Same house style as
the existing parsers: strip (not strict) on unknown keys, `.nullish()` on
anything the projection does not require, a doc comment naming the server file
each mirrors. `WireBlastSymbol`, `WireBlastCaller`, `WireBlastEndpoint`,
`WireBlast`. `state` is `z.enum(['ok','partial','degraded'])`; `reason` is
`z.string().nullish()`.

**Tool body** — replace the stub, keeping `inputSchema: { repo, pr, depth }`
byte-identical. Follow `get-conventions.ts:22-50`:
`resolveRepo` → `resolvePr` → `api.getBlastRadius(pr.id)` → project → truncate →
`{ content: [{type:'text', text}], structuredContent }`, everything wrapped in
`try/catch → renderToolError(err, TOOL_NAME)` so the handler never rejects.

- **`depth` is accepted and deliberately not forwarded.** The server walk is
  fixed at `BFS_DEPTH = 2` and the route takes no depth parameter. Keep the
  argument (it shipped in `0004`; removing it is a breaking input change for a
  tool a host may already have cached) and consume it with an explicit
  `void args.depth;` plus a comment stating the traversal is fixed at 2 hops.
  Update its `.describe()` in `tools/schemas.ts:62-68` to say so — the current
  text ("Import-graph hops to follow (default 1).") would be a lie. Something
  like `Accepted for compatibility; traversal is fixed at 2 hops.` **This is a
  decision, not a TODO — do not wire it through.**
- **Output schema** `BlastRadiusResult` in `tools/schemas.ts`:
  `{ repo, pr, state, reason, changed_files_total, symbols[], endpoints[],
  callers_total, truncated, next_step }` where each `symbols[]` entry is
  `{ symbol, location, callers: [{ location, symbol }] }` and `location` is the
  one-string `"path:line"` form `0004` §10 already established. Reuse
  `truncateText` and `MAX_RESULT_CHARS` from `constants.ts`; cap symbols at a new
  `MAX_BLAST_SYMBOLS = 25` and callers at `MAX_BLAST_CALLERS_PER_SYMBOL = 5` in
  the projection (the server's 20/symbol is a UI budget, not a token budget).
- **Error/empty paths** (`0004` §11 shape: what happened → what is available →
  the exact next call), as new constants in `mcp/src/constants.ts`, replacing
  `BLAST_RADIUS_NOT_IMPLEMENTED_MESSAGE`:
  - `state === 'degraded'` → Tool Execution Error naming the reason and pointing
    at `http://localhost:3000` → the repository → re-index, then retry.
  - `state === 'partial'` → a **successful** result with the partial-index
    caveat in `next_step`. Not an error — partial data is still useful.
  - `state === 'ok'` with no symbols → a **successful** result with
    `symbols: []` and a `next_step` explaining that the diff touches no indexed
    source symbols. Not an error (contrast `get_conventions`, where empty means
    "you must run extraction first"; here empty is a real answer).
- `title`/`description` lose "not implemented". Description stays **≤ 200
  chars** (`schema-budget.test.ts` enforces it) and must name what it returns.
- `annotations: { readOnlyHint: true, openWorldHint: false }` — unchanged.
- **`instructions.ts`**: add one short clause naming `get_blast_radius` so the
  now-real tool is discoverable at session start. The blurb is ~1.1KB against a
  2KB truncation and `schema-budget.test.ts` asserts the ceiling mechanically,
  so this is safe. One clause only — do not rewrite the blurb.

**Test double.** `test/helpers/fake-api.ts` gains `blast: Record<string, WireBlast>`,
a `getBlastRadius(prId)` that goes through `this.record(...)` like every sibling
(so `failures.getBlastRadius` and `callCount` keep working), and a `makeBlast()`
fixture builder alongside `makeReview()`/`makeConvention()`.

### §11 Tests

**`server/test/repo-intel-blast-graph.test.ts` (hermetic, new).** Drive
`RepoIntelService` with a patched `repo` object — the exact technique
`test/repo-intel-facade-degraded.test.ts:18-41` already uses. Assert:
- a 2-hop closure: `a.ts` (changed) ← `b.ts` ← `c.ts` reaches `c.ts` at hop 2,
  and `d.ts` (which imports `c.ts`) is **not** reached at hop 3;
- a cycle (`b.ts` ↔ `c.ts`) terminates and each file keeps its lowest hop;
- endpoints from a **changed** file appear with `hops: 0`;
- an endpoint reachable at both hop 1 and hop 2 is deduped to `hops: 1`;
- exactly **two** `getImporters` calls are made regardless of fan-out
  (no per-file N+1), and `getEdges` is **never** called;
- `MAX_BLAST_GRAPH_FILES` truncation sets `endpointsTruncated` and keeps the
  highest-ranked files;
- **per-symbol** capping: 30 callers across 3 symbols → 20 per symbol, not 20
  total; `callersTotal` reports the pre-cap number;
- every returned list is in the §5 total order, verified by shuffling the stub's
  row order and asserting an identical result.

**`server/test/blast.test.ts` (hermetic, new).** `BlastService` against stub
deps:
- unknown/foreign-workspace PR → `NotFoundError` (both the "no row" and the
  "row in another workspace" case);
- **`getBlastRadius` is never called when the index state is degraded/failed** —
  stub it to throw and assert `state: 'degraded'` still returns (§3);
- no changed files → `state: 'ok'`, empty arrays, `reason: null`;
- `status: 'partial'` → `state: 'partial'` **with results still present**;
- the `helpers.ts` mapper: camelCase → snake_case, `hops` preserved,
  `callers_total`/`*_truncated` propagated.

**`server/test/blast.it.test.ts` (new, `.it.test.ts` suffix — constraint 18).**
Real Postgres via the existing testcontainers harness: seed a repo + PR +
`pr_files`, insert `symbols`/`references`/`file_edges`/`file_facts`/`file_rank`/
`repo_index_state` rows directly, then `app.inject('GET /pulls/:id/blast')` and
assert a 200 with ≥2 callers and ≥1 endpoint; plus a 404 for a PR in another
workspace, and a 422 for a non-uuid `:id` (the `IdParams` guard).

**`client/.../BlastTab.test.tsx` (new).** RTL + jsdom, `@/lib/api` mocked
(`DiffTab.test.tsx:9-14` shape), wrapped in `NextIntlClientProvider` with
`messages/en/blast.json` and `QueryClientProvider`:
- renders symbols, callers and endpoints from a fixture;
- **a `file:line` link's `href` is the expected `githubBlobUrl` output** and
  `target="_blank"` — this is the automated half of acceptance criterion 3;
- `repoFullName: null` → the same text renders with **no** link (no dead `href`);
- `state: 'degraded'` → the degraded banner, and **no** "no impact" wording;
- `state: 'partial'` → the partial banner **and** the results;
- `state: 'ok'` with zero symbols → the empty state;
- an unknown `reason` string falls back to the generic message rather than
  rendering the raw enum or crashing.

**`mcp/` (updated).**
- `test/tools.test.ts:365-377` — **replace** the stub test entirely: happy path
  against the fake API (structuredContent present, `isError` falsy); degraded →
  `isError: true` naming the re-index step; partial → **not** an error, caveat in
  `next_step`; empty-but-ok → not an error; unknown repo/PR → the existing
  forward-leading resolver errors; API down → resolves, never rejects. Plus the
  injection round-trip: a symbol literally named
  `IGNORE PREVIOUS INSTRUCTIONS` appears verbatim inside `symbols[]` while
  `next_step` remains a member of the fixed constant set.
- `test/http.test.ts` — the new endpoint's method/path/uuid-encoding, plus a
  **contract-drift fixture**: a `PrBlastRadius` literal copied from the real
  route response and annotated with its source file, which must keep parsing.
- `test/schema-budget.test.ts:91` — **flip** `expect(byName['get_blast_radius']
  .outputSchema).toBeUndefined()` to `.toBeTruthy()` and move the name into the
  four-tool list on `:92`.
- `test/server.test.ts:55` and `schema-budget.test.ts:19` still expect five tool
  names — unchanged.

---

## Steps

Each step is independently reviewable. Run the module's `pnpm typecheck` before
moving on. Steps 1–7 are `server/`, 8–10 `client/`, 11–13 `mcp/`; 14 is optional.

1. **[server] `repo-intel` reverse-edge read** — add `getImporters(repoId,
   toFiles)` to `repo-intel/repository.ts` (§4) and `MAX_BLAST_GRAPH_FILES` /
   `MAX_BLAST_CALLERS_TOTAL` to `repo-intel/constants.ts`.
   Required skills: `drizzle-orm-patterns` (typed `.select({})` + `inArray`,
   early-return on empty input, no raw SQL — mirror `getFileRankFor`),
   `postgresql-table-design` (the query must be served by the existing
   `file_edges_repo_to_idx` on `(repo_id, to_file)` — do not add an index),
   `onion-architecture` (ring 3: this is the only new file allowed a Drizzle
   import in this step).
   Done when: the method returns `IndexerEdgeRow[]`, `getEdges` is untouched,
   and no migration file was created.

2. **[server] The 2-hop closure + endpoint attribution** — `reverseImportClosure`
   + the rewritten endpoint block in `tryPersistentBlast`, and the additive
   `BlastResult` fields + `BlastEndpointRow` in `repo-intel/types.ts` (§4).
   Required skills: `onion-architecture` (ring 2 — the traversal lives in the
   facade, per `repo-intel/README.md:12`, never in a feature module),
   `typescript-expert` (the `Map<string, number>` hop bookkeeping under
   `noUncheckedIndexedAccess`), `engineering-insights` (read `server/insights.md`
   first — it covers this module too).
   Done when: exactly two `getImporters` calls happen per request regardless of
   fan-out; `getEdges` is never called from the blast path; `BlastResult`'s
   existing fields are unchanged and `test/repo-intel-facade-degraded.test.ts`
   still passes untouched.

3. **[server] Caller capping + total ordering** — per-symbol cap, global ceiling,
   `callersTotal`/`callersTruncated`, and the four total sorts (§5).
   Required skills: `engineering-insights` (`server/insights.md` 2026-08-04 —
   this is that exact bug class), `typescript-expert`.
   Done when: a fixture with 3 symbols × 30 callers returns 20 **per symbol**;
   shuffling the stub's row order produces a byte-identical result.

4. **[server] Tests for steps 1–3** — `test/repo-intel-blast-graph.test.ts` (§11).
   Required skills: `engineering-insights` (hermetic-by-default; no `.it.test.ts`
   suffix here because nothing touches Postgres).
   Done when: `cd server && pnpm test` is green with no Docker running.

5. **[server] The shared contract** — `src/vendor/shared/contracts/blast.ts` +
   one `export *` line in `src/vendor/shared/index.ts` (§6).
   Required skills: `zod` (`type-export-schemas-and-types` — export both the
   schema and its inferred type; `schema-use-enums` for `state`;
   `object-strict-vs-strip` defaults; the documented `reason: string` exception),
   `onion-architecture` (ring 0 — imports nothing but `zod`).
   Done when: `cd server && pnpm typecheck` passes (no `TS2308` from the
   barrel), `contracts/brief.ts` is untouched, and `test/contracts.test.ts` still
   passes unmodified.

6. **[server] `pullRepoId` + the `blast/` module** — the repository method in
   `reviews/repository/pull.repo.ts` (+ the `ReviewRepository` facade method),
   then `modules/blast/{routes,service,helpers,constants}.ts` implementing §3,
   then one import + one entry in `modules/index.ts`.
   Required skills: `onion-architecture` (explicit `BlastServiceDeps`, never
   `Container`; no Drizzle or row types in `service.ts`/`routes.ts`; the pure
   mapper in `helpers.ts`), `fastify-best-practices` (one plugin per domain,
   `IdParams` via the zod type provider, no hand-rolled `.parse()` in the
   handler, no `response` schema), `security` (§9 — the workspace-scoped lookup
   is the first statement in the service and there is no branch around it),
   `zod` (the route's params schema only).
   Done when: `grep -n "drizzle\|db/schema" server/src/modules/blast/` prints
   nothing; the service's constructor signature names its two dependencies;
   `getBlastRadius` is provably unreachable when the index state is
   degraded/failed.

7. **[server] Tests for step 6** — `test/blast.test.ts` (hermetic) and
   `test/blast.it.test.ts` (Postgres) per §11.
   Required skills: `engineering-insights` (the `.it.test.ts` suffix rule; and
   `server/insights.md` 2026-08-07 — mock `secrets` with `MockSecretsProvider`
   in any `.it.test.ts` `appWith()` so no adapter reaches the network),
   `security` (the cross-workspace 404 case is a required test, not optional).
   Done when: `pnpm test` and the integration lane are both green, and the
   "index degraded → `getBlastRadius` never called" test fails if the §3 gate is
   removed.

8. **[client] Contract sync + hook** — hand-copy `contracts/blast.ts` into
   `client/src/vendor/shared/contracts/`, add the `export *` line to the client
   barrel, then `src/lib/hooks/blast.ts` + the `hooks/index.ts` re-export (§7).
   Required skills: `frontend-ui-architecture` (one hook file per resource under
   `lib/hooks`, the only place that talks to the API; server state lives in the
   query cache and is never mirrored into client state), `react-best-practices`
   (`enabled: !!prId`, a stable `queryKey` factory), `zod`.
   Done when: the two `contracts/blast.ts` files are identical, the client
   typechecks, and `grep -rn "fetch(" client/src/app/**/BlastTab` is empty.

9. **[client] `BlastTab` + i18n + tab registration** — the component, its
   `styles.ts`, the new keys in `messages/en/blast.json`, the `PrDetailHeader`
   tab entry and the `page.tsx` block (§7, §8).
   Required skills: `frontend-ui-architecture` (colocated under
   `_components/BlastTab/`; sub-components stay inside that folder; nothing is
   promoted to `@devdigest/ui`), `react-best-practices` (pure helpers and style
   objects at module scope, not inside the component body; no business logic in
   JSX), `next-best-practices` (`"use client"` at the top, matching every sibling
   tab), `security` (§9 — every path goes through `githubBlobUrl`, never a raw
   `href` or `dangerouslySetInnerHTML`), `engineering-insights`
   (`client/insights.md` 2026-08-05 — reuse the pre-built `blast.json` keys
   rather than inventing a namespace).
   Done when: all three states (empty / partial / degraded) render distinctly;
   the tab adds no fetch to the header; `messages/en/blast.json`'s existing keys
   are still present.

10. **[client] `BlastTab.test.tsx`** — the assertions in §11.
    Required skills: `react-testing-library` (query by role/text, not by
    implementation; `@/lib/api` mocked; wrap in `NextIntlClientProvider` +
    `QueryClientProvider`), `engineering-insights` (`client/insights.md`
    2026-08-04 — a mocked router that mutates a module variable does not
    re-render; only relevant if the test navigates).
    Done when: `cd client && pnpm test` is green and the `href` assertion fails
    if `githubBlobUrl` is swapped for a hand-built string.

11. **[mcp] Wire parser + port + adapter** — `WireBlast*` in
    `devdigest/wire.ts`, the 8th `DevDigestApi` method, its
    `HttpDevDigestApi` implementation (§10).
    Required skills: `zod` (`parse-never-trust-json`, strip-not-strict,
    `.nullish()` on everything the projection does not require),
    `onion-architecture` (ring 0 wire / ring 1 port / ring 3 adapter — `fetch`
    stays in `http.ts` alone), `security` (`assertUuid` + `encodeURIComponent`
    before interpolation, default timeout, `redirect: 'error'` inherited from
    `request()`).
    Done when: `grep -rn "@devdigest/shared" mcp/` is still empty and
    `grep -rln "fetch(" mcp/src` still matches only `devdigest/http.ts`.

12. **[mcp] Projection + the real tool** — `projectBlast`/`renderBlastText` in
    `project.ts`, `BlastRadiusResult` in `tools/schemas.ts`, the rewritten
    `tools/get-blast-radius.ts`, the constants swap, the `DepthArg` description
    update and the one-clause `instructions.ts` addition (§10).
    Required skills: `zod` (one exported output schema + inferred type; pass
    `.shape` to `outputSchema` — `mcp/insights.md` 2026-08-06),
    `onion-architecture` (`project.ts` stays pure; the tool file imports no SDK),
    `security` (`next_step` strings stay constants from `constants.ts`; symbol
    names and paths are emitted only in labelled field positions),
    `typescript-expert`.
    Done when: `grep -rn "modelcontextprotocol" mcp/src/tools` prints nothing;
    the tool's `description` is ≤ 200 chars; `BLAST_RADIUS_NOT_IMPLEMENTED_MESSAGE`
    no longer exists anywhere in `mcp/`.

13. **[mcp] Test double + test updates + docs** — `fake-api.ts`, the rewritten
    `tools.test.ts` block, `http.test.ts`'s drift fixture, the
    `schema-budget.test.ts:91-92` flip, and the `mcp/CLAUDE.md:5` /
    `mcp/README.md:25` wording (§10, §11).
    Required skills: `engineering-insights` (`mcp/insights.md`'s existing
    entries; append a dated entry under an **existing** heading only if something
    genuinely non-obvious surfaced), `security` (the injection round-trip test),
    `zod` (parse built results against the output schema).
    Done when: `cd mcp && pnpm typecheck && pnpm test && pnpm build` is green
    with no network and no `:3001` running, and no doc still calls the tool a stub.

14. **[optional, clearly separated] One-paragraph LLM explanation.** Skippable
    in full; nothing above depends on it. If built: a **single** `completeText`
    call behind an explicit opt-in query param (`GET /pulls/:id/blast?explain=1`),
    defaulting **off**, so the main path provably makes zero LLM calls. The
    prompt is assembled from the already-computed map only — every node and edge
    comes from the index, the model may not introduce a file, symbol or endpoint —
    and the response gains `summary: string | null` on the contract (both vendor
    copies) rendered as plain text. `blast/service.ts` must not gain a
    `Container`; the LLM arrives as one more explicit dep. A test must assert
    that the default (no query param) path never touches the injected LLM stub.
    Required skills: `onion-architecture` (`LLMProvider` is a ring-1 port; the
    call is a service concern, not a route concern), `security` (indexed
    third-party symbol names enter a prompt — the existing `INJECTION_GUARD`
    convention applies and no keyword denylist may be added on top,
    `server/CLAUDE.md`), `zod`.
    Done when: with the param absent, an LLM stub that throws on any call still
    yields a 200.

---

## Skills the implementer must apply

- **`onion-architecture`** — steps 1–3, 6, 9, 11–12, 14. The §2 ring map is the
  file layout. Graph traversal and SQL live in `repo-intel`
  (`repo-intel/README.md:12`); `blast/` is HTTP shaping only; `BlastService`
  takes explicit deps, never `Container`; no row type crosses into a service; the
  route parses and delegates.
- **`drizzle-orm-patterns`** + **`postgresql-table-design`** — step 1 only.
  A typed `.select({})` with `inArray`, early-return on empty input, served by
  the **existing** `file_edges_repo_to_idx`. No new table, no new index, **no
  migration** — `server/src/db/migrations/` is do-not-touch. If the implementer
  finds themselves generating a migration, they have left the plan.
- **`fastify-best-practices`** — step 6. One plugin per domain registered in
  `modules/index.ts`; zod `params` via `fastify-type-provider-zod`; no `response`
  schema (matching `smart-diff`/`repo-intel`); no extra rate limiter.
- **`zod`** — steps 5, 6, 8, 11, 12, 14. New contract file with exported schemas
  **and** inferred types; `z.enum` for `state`; the documented
  `reason: z.string()` exception; tolerant strip-not-strict wire parsers in
  `mcp/`; `.shape` when handing an output schema to `registerTool`.
- **`security`** — steps 6, 7, 9, 11, 12, 14. §9 is the whole list: workspace
  scoping first and unconditionally (the `server/insights.md` 2026-08-05 leak
  class), no request-time filesystem access, escaped paths through
  `githubBlobUrl`, `assertUuid` + `encodeURIComponent` in `http.ts`, and
  constant-only `next_step` strings.
- **`frontend-ui-architecture`** — steps 8–9. Hook under `lib/hooks/` is the only
  thing that talks to the API; the tab is colocated under `_components/BlastTab/`;
  nothing is promoted to shared until a second consumer exists; server state
  stays in the query cache.
- **`react-best-practices`** + **`next-best-practices`** — step 9. `"use client"`,
  module-scope helpers and style objects, no logic in JSX, stable query keys.
- **`react-testing-library`** — step 10. Role/text queries, mocked `@/lib/api`,
  the intl + query providers.
- **`typescript-expert`** — throughout. Strict mode with
  `noUncheckedIndexedAccess`, discriminated `state` handling instead of
  stringly-typed branches, no `any` at the facade boundary.
- **`engineering-insights`** — steps 2, 3, 4, 7, 9, 10, 13. Read
  `server/insights.md`, `client/insights.md` and `mcp/insights.md` **before**
  touching each package (mandatory project convention). The three entries that
  bite directly here: unstable sort order (server, 2026-08-04), the
  cross-workspace early-return leak (server, 2026-08-05), and pre-built i18n
  scaffolding (client, 2026-08-05). At the end, append any genuine lesson under
  an **existing** heading, dated `2026-08-07`; invent no headings and write
  nothing if nothing substantial surfaced.
- **`reviewer-core` / `e2e` skills** — **not applicable.** No file in either
  package changes. Listed so their absence is a decision, not an oversight.

## Verification

Per module (each module's own `CLAUDE.md` commands):

```sh
cd server && pnpm typecheck && pnpm test          # unit + integration
cd client && pnpm typecheck && pnpm test
cd mcp    && pnpm typecheck && pnpm test && pnpm build
```

Static guards (each must print **nothing**):

```sh
grep -rn "drizzle-orm\|db/schema"  server/src/modules/blast/   # ring 4/2 stay SQL-free
grep -rn "Container"               server/src/modules/blast/service.ts
grep -rn "getEdges"                server/src/modules/blast/   # traversal is the facade's
git status --porcelain server/src/db/migrations/               # no migration
git diff --name-only -- server/src/vendor/shared/contracts/brief.ts   # brief.ts untouched
grep -rn "BLAST_RADIUS_NOT_IMPLEMENTED" mcp/                   # stub message gone
grep -rn "@devdigest/shared"       mcp/                        # still no vendored contracts
grep -rln "fetch(" mcp/src | grep -v "devdigest/http.ts"       # one HTTP file
diff server/src/vendor/shared/contracts/blast.ts client/src/vendor/shared/contracts/blast.ts
```

End-to-end check that proves the feature works:

1. `./scripts/dev.sh` (Postgres → migrate → seed → API :3001 → web :3000), then
   `cd mcp && pnpm build`.
2. Import a real repository and wait for the **Indexed** badge
   (`GET /repos/:id/index-state` → `status: "full"`).
3. Open a PR on that repo **that changes a shared helper**, then the **Blast**
   tab. Acceptance: the map shows **at least two real callers** and **at least
   one HTTP endpoint**.
4. **Click a `file:line`** on a caller that is *not* part of this PR's diff → a
   new tab opens `github.com/{owner}/{repo}/blob/{head_sha}/{path}#L{n}` and
   lands on the right line. Repeat for a changed symbol and for an endpoint file.
5. **No request-time parsing.** With the browser network panel open, confirm
   `GET /pulls/:id/blast` returns in tens of milliseconds, and confirm in the API
   log that the request produced no clone read and no ast-grep/ripgrep activity.
   (Structurally guaranteed by §3 step 4 — this is the observable confirmation.)
6. **Empty state.** Open a PR whose diff touches only docs/config → the empty
   state renders, distinct from the degraded banner.
7. **Degraded state.** Open the tab for a repo that has not been indexed (or
   restart the API with `REPO_INTEL_ENABLED=false`) → the degraded banner with a
   readable reason, **not** an empty "no impact" map.
8. **Partial state.** Force a `partial` index (`UPDATE repo_index_state SET
   status='partial' WHERE repo_id=…`) → the partial banner **plus** results.
9. **Zero LLM calls on the main path.** Steps 3–8 must produce no LLM request in
   the API log and no cost row. (If step 14 was built: `?explain=1` produces
   **exactly one**.)
10. **MCP.** In Claude Code, `get_blast_radius(repo="owner/name", pr=<n>)` →
    a compact structured result naming the same symbols/callers/endpoints as the
    UI, with `structuredContent` present and `isError` unset. Then: an unindexed
    repo → the forward-leading degraded error; `depth=3` → the same result as
    `depth=1` (fixed at 2 hops, §10); the API stopped → a clear "not reachable"
    error and `/mcp` still shows `devdigest: connected` (the server must not have
    crashed).

## Explicit note

Architecture and security review are **out of scope for the implementer** and are
handled by separate review agents/skills after implementation. Implement the
constraints and decisions this plan specifies — they are requirements, not review
findings — and do not re-litigate the contract shape, the GitHub-link
click-through, the fixed 2-hop depth, the ignored MCP `depth` argument, the
"gate on index state before calling `getBlastRadius`" rule, or the decision to
add a new contract file instead of reusing `contracts/brief.ts` while coding. If
something in the repo contradicts this plan (a file that does not exist, a
facade method that has changed shape, a second consumer of `getBlastRadius`),
**stop and surface the discrepancy** instead of working around it.

## Open questions / assumptions

1. **`file_facts.endpoints` coverage is only as good as `extractEndpoints`**
   (`server/src/adapters/codeindex/extract.ts`). If the demo repo's routing style
   is not recognised, acceptance criterion "one HTTP endpoint" can fail on a
   correct implementation. Verify against the actual demo repo at step 3 of the
   E2E check **before** concluding the walk is broken; if the extractor is the
   gap, that is a separate change (and out of this plan's scope — surface it).
2. **`MAX_BLAST_GRAPH_FILES = 300`, `MAX_BLAST_CALLERS_TOTAL = 200`,
   `MAX_BLAST_SYMBOLS = 25` and `MAX_BLAST_CALLERS_PER_SYMBOL = 5` are first
   guesses**, each one constant in one file. Tune after seeing a real repo's
   fan-out; do not tune them speculatively during implementation.
3. **Whether hop-0 endpoints (a changed file that is itself a route file) should
   be visually separated from hop-1/2 in the UI** is left to the implementer's
   judgement within §7's structure — the data carries `hops`, and the i18n keys
   `hops.direct|one|two` exist for it either way.
4. **`getBlastRadius` currently has no consumer besides this feature** (verified:
   `run-executor.ts` uses `getCallerSignatures`/`getFileRank`, not
   `getBlastRadius`). The §4 additive extension assumes that still holds — grep
   before editing `types.ts`, and if a second consumer has appeared, stop and
   surface it.
