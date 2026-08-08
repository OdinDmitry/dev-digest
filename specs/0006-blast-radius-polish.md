# Development Plan: Blast Radius polish — `server` + `client` + `mcp`

> **Location/numbering note.** Root [`specs/`](README.md) holds cross-module
> Development Plans produced by `planner` and consumed by `implementer`;
> module-level `specs/` folders hold single-module *design* specs. This is a
> follow-up to [`0005-blast-radius.md`](0005-blast-radius.md) — the completed,
> already-shipped plan whose feature it polishes — and touches the same three
> packages (`server/`'s `repo-intel` + `blast` modules and the shared contract,
> the `client/` Blast tab plus the shared diff viewer, and the `mcp/` tool), so
> it lives here and takes the next number in root `specs/`'s own sequence
> (`0001` … `0005-blast-radius.md` → `0006`).
>
> **Everything in §"Design decisions" is already decided.** The four fixes, their
> scope boundaries and the explicit non-goals below came from the user after
> manually reviewing the shipped feature. They must not be re-derived,
> re-researched, widened or "improved" during implementation. `0005`'s own
> decisions stay in force except where a section here supersedes one explicitly.
> If the repo contradicts something here, **stop and surface it** — see the
> Explicit note.

## Goal

Four user-reported polish items on the shipped Blast Radius feature, all
additive: (1) changed symbols show the line they are declared on — the data is
already in `symbols.line`, it is simply dropped on the floor between the
repository and the facade; (2) the caller list stops rendering a normalized
PageRank score as `rank 0.00` and renders the already-persisted `file_rank.percentile`
as human-readable "top N%" instead; (3) any file reference inside the Blast tab
that is part of *this PR's own diff* switches to the "Files changed" tab and
scrolls to that file's card instead of opening GitHub (out-of-diff references
keep the external link, unchanged); (4) changed symbols are grouped into one box
per file instead of one box per symbol. No change to what the graph walk
computes, how it is capped, or how it is ordered.

## Out of scope

The user was offered each of these and declined them. Do not implement them, do
not leave TODOs for them, do not "prepare" for them.

- **Attributing `impacted_endpoints` to the specific changed symbol that reaches
  them.** Endpoints come from a **file-level** reverse-import BFS
  (`reverseImportClosure`, `repo-intel/service.ts:445-…`), not a per-symbol
  walk; restructuring that is separate work.
- **A line number on `impacted_endpoints` rows.** `extractEndpoints()`
  (`server/src/adapters/codeindex/extract.ts:182-195`) is a heuristic regex
  extractor whose output (`file_facts.endpoints: string[]`) has never captured a
  line. Fixing that means touching the extractor and the persisted shape.
  `PrBlastEndpoint` keeps `{ endpoint, file, hops }` and the MCP endpoint
  `location` stays file-only.
- **Any change to `repoIntel.getBlastRadius` / `tryPersistentBlast`'s graph
  algorithm, caps (`MAX_CALLERS_PER_SYMBOL`, `MAX_BLAST_CALLERS_TOTAL`,
  `MAX_BLAST_GRAPH_FILES`, `BFS_DEPTH`) or ordering rules** from `0005` §4/§5.
  This pass adds two additive fields to existing rows and changes client
  presentation/navigation. `compareCallers` stays keyed on `rank`;
  `percentile` is **display-only and never a sort key**.
- **A line-level scroll target in the diff viewer.** Fix 3 is **file-level**:
  `FileCard`/`CodeLine` have no per-line id or anchor system today (verified:
  `grep -rn "id=|scrollIntoView|getElementById" client/src/components/diff-viewer`
  returns nothing), and the one existing cross-tab-jump precedent
  (`targetFindingId`) also only jumps to a whole card.
- **An in-app viewer for files that are NOT in this PR's diff.** `0005`'s
  boundary is unchanged and load-bearing: `DiffViewer`/`FileCard` are
  patch-based and cannot render a file absent from the diff. Out-of-diff
  references keep `githubBlobUrl`. **Do not re-open this.**
- **The `depgraph`/`toRel()` Windows-separator bug.** Already fixed and merged
  (`server/insights.md`, 2026-08-07). Not pending work; do not reference it.
- **Any DB schema change or migration.** `symbols.line` and
  `file_rank.percentile` are existing columns. `server/src/db/migrations/` is
  do-not-touch.
- **`reviewer-core/`, `e2e/`.** No file in either changes (`grep -rn "blast"
  e2e/` is empty today and stays that way).
- **Architecture and security review of the result** — see "Explicit note".

## Constraints

Verified against HEAD (branch `MCP`, 2026-08-08). Line numbers cited were
re-read for this plan; where one has moved, the named symbol is authoritative.

1. **`0005`'s constraints all still apply** — in particular ring placement
   (`onion-architecture`: `blast/` has no Drizzle and no row types; all graph
   work lives in `repo-intel`), the workspace-scoped-first rule
   (`server/insights.md` 2026-08-05), and the total-order rule
   (`server/insights.md` 2026-08-04). Nothing here changes a sort key, so the
   existing total orders (`compareCallers` `service.ts:846-852`,
   `compareChangedSymbols` `:855-860`, `compareEndpointRows` `:863-868`) are
   **not touched**.
2. **`symbols.line` is a NULLABLE column** — `integer('line')` with no
   `.notNull()` (`server/src/db/schema/context.ts:71`), and
   `FullSymbolRow.line` is therefore `number | null`
   (`repo-intel/repository.ts:115-123`). The new field is nullable end to end
   (§1). The degraded ripgrep path's `CodeSymbol.line`
   (`vendor/shared/adapters.ts:237-242`) is a plain `number`, which widens
   cleanly.
3. **`file_rank.percentile` is `smallint NOT NULL`, 0-100, higher = more
   important** (`server/src/db/schema/repo-intel.ts:115`; computed in
   `repo-intel/pipeline/rank.ts:54-69` as "share of files with rank ≤ this
   rank", top file ≈ 100). `getResolvedCallers` already inner-joins `file_rank`
   (`repository.ts:519-547`) — adding `percentile` to its `.select({})` adds no
   join and no new index need.
4. **`getFileRankFor` returns `{ path, percentile }`, not `{ path, rank }`**
   (`repository.ts:455-462`; `server/insights.md` 2026-08-07). Do not add a new
   repository method to expose a raw `rank` anywhere.
5. **`@devdigest/shared` is vendored by copy, twice, and the copies drift**
   (root `CLAUDE.md`; `client/insights.md` 2026-08-05). `server/src/vendor/shared/contracts/blast.ts`
   and `client/src/vendor/shared/contracts/blast.ts` are byte-identical today —
   verified — and must stay so after this change. `mcp/` deliberately vendors
   **nothing** and hand-writes narrow parsers (`mcp/CLAUDE.md`).
6. **`mcp/` rules unchanged from `0004`/`0005`:** tools never import the MCP
   SDK, no handler ever rejects, stdout is the JSON-RPC channel, `fetch` only in
   `devdigest/http.ts`, wire parsers strip-not-strict with `.nullish()` on
   anything the projection can survive without. The tool `description` stays
   ≤ 200 chars (`test/schema-budget.test.ts`).
7. **`MonoLink` (`client/src/vendor/ui/primitives/MonoLink.tsx:25-52`) already
   renders both affordances from one component**: with `href` → an
   `<a target="_blank" rel="noopener noreferrer">`; with only `onClick` → a
   `<button>`, identical styling either way. Fix 3 therefore introduces **no new
   visual style** — it picks the branch that already exists. This matches
   `SmartDiffViewer`'s marker → finding-card affordance, which is also a
   `<button>` (`SmartDiffViewer.tsx:175-179`) while every external file
   reference in `FindingCard.tsx:68-70` is a `MonoLink href=…`.
8. **The one cross-tab-jump precedent is `targetFindingId`, and its placement is
   a documented rule.** `findingTarget: { id, n }` lives in `page.tsx:77-81`
   (with the nonce so clicking the same target twice re-triggers the effect),
   `handleOpenFinding` sets it and calls `setTab("findings")`, and it is threaded
   `page.tsx` → `FindingsTab` → `ReviewRunAccordion` → `FindingsPanel`, where a
   `useEffect` keyed on `[targetFindingId, targetFindingNonce, shown]` reveals
   and scrolls (`FindingsPanel.tsx:51-66`). `client/insights.md` (2026-08-05)
   records **why** the state lives in `page.tsx`: it is the only component that
   stays mounted across a `?tab=` change (`page.tsx:150,152,180,191` mount
   exactly one tab). Fix 3 mirrors this shape exactly.
9. **Hooks in `page.tsx` must be declared above its three early returns**
   (`:103`, `:111`, `:123`) — `allFindings` (`:85-88`) already is. The new
   `diffFilePaths` memo and `fileTarget` state go next to `findingTarget`
   (`:77-81`), not after the guards (`react-best-practices`, rules of hooks).
10. **`FileCard`'s `open` state is local and size-heuristic-defaulted** —
    `useState((additions ?? 0) + (deletions ?? 0) <= AUTO_EXPAND_MAX_LINES)`
    (`FileCard.tsx:45-47`, `AUTO_EXPAND_MAX_LINES = 200`,
    `diff-viewer/constants.ts:4`). A large target file starts collapsed, so the
    scroll target must force it open (§3).
11. **`DiffTab` renders one of two subtrees** (`DiffTab.tsx:125-137`):
    `SmartDiffViewer` (smart mode, groups files by role — and `boilerplate`
    starts **collapsed**, `SmartDiffViewer.tsx:24-28`) or the flat `DiffViewer`
    (original mode, or any smart-diff loading/error state). **Both** paths must
    honour the scroll target, and the smart path must also open the containing
    group (§3).
12. **`client/src/components/diff-viewer/` is the shared (non-feature) layer.**
    It may not learn anything about blast; a `targetFilePath: string` prop is
    domain-free in exactly the way its existing `renderLineMarker` pass-through
    is ("this layer stays domain-free", `FileCard.tsx:40-42`)
    (`frontend-ui-architecture`).
13. **`client/tsconfig.json:19` sets `lib: ["ES2022","DOM","DOM.Iterable"]`** —
    so `Object.groupBy` (ES2024) does **not** typecheck in `client/`. See
    §0 for the resolution; do not widen `lib` for one helper.
14. **`messages/en/blast.json` already carries unused keys** (`view.*`,
    `graph.*`, `stat.crons`) — the pre-built-i18n-scaffolding pattern logged in
    `client/insights.md` (2026-08-05). Add new keys to that same file; do not
    create a namespace and do not delete keys that fall out of use.
15. **`vitest` everywhere; DB-backed server tests use `*.it.test.ts`**
    (`server/CLAUDE.md`). Client component tests mock `@/lib/api`
    (`BlastTab.test.tsx:9-14`); `mcp/` tests run hermetically against
    `test/helpers/fake-api.ts`.
16. **Test-helper overrides must use default-parameter destructuring, not `??`**
    — `client/insights.md` (2026-08-07): `BlastTab.test.tsx`'s `renderTab`
    already does this (`:39-45`) so `{ repoFullName: null }` is honoured. Any
    new override added to it must follow suit.
17. **`insights.md` is append-only.** `mcp/insights.md`'s 2026-08-07 entry
    ("`PrBlastRadius`'s `changed_symbols` … carry no line number") becomes
    historically superseded by Fix 1. **Do not edit or delete it** — append a
    new dated entry under the same existing heading saying the contract now
    carries `line` and `symbolLocation()` builds `file:line`.
18. **Do-not-touch:** `server/src/db/migrations/`. Per §"Out of scope", also
    treat `repo-intel/pipeline/*`, `adapters/codeindex/extract.ts` and
    `contracts/brief.ts` as untouchable in this plan.

## Affected modules & files

### `server/`

| File | Change |
|---|---|
| `src/modules/repo-intel/types.ts` | `BlastChangedSymbol` gains `line: number \| null`; `BlastCallerRow` gains `percentile: number` |
| `src/modules/repo-intel/repository.ts` | `getResolvedCallers`'s `.select({})` gains `percentile: t.fileRank.percentile`; `ResolvedCallerRow` gains `percentile: number` |
| `src/modules/repo-intel/service.ts` | pass `s.line` at both `changedSymbols.push` sites (`:260`, `:336`); pass `c.percentile` at the caller-mapping site (`:377-383`) |
| `src/vendor/shared/contracts/blast.ts` | `PrBlastSymbol.line`, `PrBlastCaller.percentile` |
| `src/vendor/shared/index.ts` | **no change** (already `export *`s the file) |
| `src/modules/blast/helpers.ts` | thread `line` / `percentile` through the camelCase→snake_case mapper (`:37-48`) |
| `test/blast.test.ts` | fixtures + mapper assertions gain the two fields |
| `test/repo-intel-blast-graph.test.ts` | assert `line`/`percentile` flow through the facade |
| `test/blast.it.test.ts` | `:136`'s exact `changed_symbols` equality gains `line`; assert a caller's `percentile` |

### `client/`

| File | Change |
|---|---|
| `src/vendor/shared/contracts/blast.ts` | hand-synced copy of the server's (constraint 5) |
| `src/app/…/_components/BlastTab/BlastTab.tsx` | file-grouped symbol rendering, symbol line, percentile instead of `rank.toFixed(2)`, in-diff-jump vs external-link branching |
| `src/app/…/_components/BlastTab/helpers.ts` | **new** — `groupSymbolsByFile`, `topPercentLabel` (pure, module scope) |
| `src/app/…/_components/BlastTab/styles.ts` | styles for the new file-group box / symbol row / divider |
| `src/app/…/_components/BlastTab/BlastTab.test.tsx` | grouping, line, percentile and jump-vs-link assertions |
| `src/app/…/pulls/[number]/page.tsx` | `fileTarget` state + `handleJumpToFile` + `diffFilePaths` memo; two new props each on `DiffTab` and `BlastTab` |
| `src/app/…/_components/DiffTab/DiffTab.tsx` | accept + forward `targetFilePath`/`targetFileNonce` to both subtrees |
| `src/app/…/_components/DiffTab/_components/SmartDiffViewer/SmartDiffViewer.tsx` | forward the target; force the containing role group open |
| `src/components/diff-viewer/DiffViewer/DiffViewer.tsx` | forward the target to `FileCard` |
| `src/components/diff-viewer/FileCard/FileCard.tsx` | stable `id`, force-open when targeted, scroll-into-view effect |
| `src/components/diff-viewer/helpers.ts` | **new export** `diffFileCardId(path)` |
| `src/components/diff-viewer/index.ts` | one export line for `diffFileCardId` |
| `messages/en/blast.json` | new keys: `topPercent`, `symbolLine`, `jumpToFile` |

### `mcp/`

| File | Change |
|---|---|
| `src/devdigest/wire.ts` | `WireBlastSymbol` gains `line: z.number().int().nullish()` (+ doc comment) |
| `src/project.ts` | `symbolLocation(file, line)` → `file:line`; `projectBlast` passes `s.line`; endpoint `location` unchanged |
| `src/tools/schemas.ts` | comment-only: `BlastSymbolOut.location` is no longer file-only |
| `test/helpers/fake-api.ts` | `makeBlast()`'s symbol fixture gains `line` |
| `test/http.test.ts` | contract-drift fixture gains `line`/`percentile` |
| `test/tools.test.ts` | assert a symbol's `location` is now `file:line` |
| `insights.md` | one appended dated entry (constraint 17) |

### Not touched

`reviewer-core/`, `e2e/`, every migration, `contracts/brief.ts`,
`repo-intel/constants.ts`, `modules/blast/{routes,service,constants}.ts`,
`mcp/src/tools/get-blast-radius.ts`, `mcp/src/constants.ts`,
`mcp/src/instructions.ts`.

---

## Design decisions

The implementer must not re-derive any of these.

### §0 One discrepancy found while writing this plan — read this first

**`Object.groupBy` is not available to `client/`.** The brief for this work
assumed Node ≥ 22 makes it usable for Fix 4's grouping. It does not:
`client/tsconfig.json:19` sets `lib: ["ES2022","DOM","DOM.Iterable"]`, and
`Object.groupBy` is an ES2024 library type — it will not typecheck, and this
code ships to a browser, not to Node. Widening `lib` for one helper is not
worth it.

**Resolution (decided, do not re-derive):** a linear contiguity scan, which is
strictly better here anyway because `changed_symbols` already arrives sorted
`file ASC, name ASC, kind ASC` from the server (`compareChangedSymbols`,
`service.ts:855-860`), so same-file symbols are already adjacent and the scan
preserves the server's total order exactly with no re-sorting:

```ts
// BlastTab/helpers.ts — pure, module scope, no React import
export interface SymbolFileGroup { file: string; symbols: PrBlastSymbol[]; }

export function groupSymbolsByFile(symbols: readonly PrBlastSymbol[]): SymbolFileGroup[] {
  const groups: SymbolFileGroup[] = [];
  for (const symbol of symbols) {
    const last = groups[groups.length - 1];            // `| undefined` under noUncheckedIndexedAccess
    if (last && last.file === symbol.file) last.symbols.push(symbol);
    else groups.push({ file: symbol.file, symbols: [symbol] });
  }
  return groups;
}
```

If the server order were ever broken, this degrades to two groups for one file
— visually redundant, never wrong. **No client-side re-sorting**: the server
owns the ordering semantics (`0005` §5, and `client/insights.md` 2026-07-30 on
clients re-deriving server aggregations).

### §1 Fix 1 — the changed symbol's line

The data exists and is already selected: `getSymbolRows` puts `line` into
`FullSymbolRow` (`repository.ts:502-516`), and `service.ts` discards it at both
`changedSymbols.push({ file: s.path, name: s.name, kind: s.kind })` sites
(`:260` degraded path, `:336` persistent path). Pass `s.line` through at both.

**The field is nullable, end to end** (constraint 2). `symbols.line` is a
nullable column, so:

| Layer | Shape |
|---|---|
| `BlastChangedSymbol` (`repo-intel/types.ts:57-61`) | `line: number \| null` |
| `PrBlastSymbol` (both contract copies) | `line: z.number().int().nullable()` |
| `blast/helpers.ts` mapper (`:37-41`) | `line: s.line` |
| `WireBlastSymbol` (`mcp/…/wire.ts:154-159`) | `line: z.number().int().nullish()` — house style: tolerate absence |

- **Do not invent a fallback line.** `null` means "the indexer recorded no start
  line for this symbol"; rendering nothing is correct, `:0` or `:1` is a lie.
- **MCP:** `symbolLocation()` (`project.ts:277-285`) stops being an identity
  function and becomes `line == null ? file : \`${file}:${line}\`` — the same
  `path:line` form `callerLocation()` already builds, which is what
  `0004` §10 and `0005` §10 always specified. Update its doc comment and the
  now-wrong `// … no line: PrBlastSymbol carries none` comment on
  `BlastSymbolOut.location` (`tools/schemas.ts:152`). **`BlastEndpointOut.location`
  stays file-only** and its comment stays correct (out of scope).
  `projectBlast` (`project.ts:307-316`) passes `s.line` at the one call site;
  the endpoint call at `:320` becomes `symbolLocation(e.file, null)` (or a
  dedicated file-only expression — implementer's choice, but it must not start
  emitting an endpoint line).
- **Client:** the line renders inside the symbol row created by Fix 4 (§3/§4) —
  as plain text, not a link. Rationale (decided): the file-group header already
  carries the one click affordance for that file, and Fix 3's in-diff jump is
  file-level, so a second control on the same row would have an identical
  destination. Render `t("symbolLine", { line })` only when `line != null`.

### §2 Fix 2 — percentile replaces the `rank 0.00` display

`rank` is a normalized PageRank score summing to ~1 across the whole repo
(`pipeline/rank.ts`, "Option B: rank = pagerank"), so on a repo with hundreds of
files every value lands in 0.001–0.01 and `caller.rank.toFixed(2)`
(`BlastTab.tsx:221`) prints `0.00` for essentially every caller — verified live:
`0.005007…`, `0.003710…`, `0.003517…`, `0.003442…` all render `0.00`.

**Decision: display `file_rank.percentile`, keep `rank` as the sort key.**

- `getResolvedCallers` (`repository.ts:519-547`) already inner-joins
  `t.fileRank`; add `percentile: t.fileRank.percentile` to its existing
  `.select({})` and `percentile: number` to `ResolvedCallerRow` (`:126-131`).
  **No new join, no new query, no new index** (`drizzle-orm-patterns`,
  `postgresql-table-design`: the access path is already served).
- `BlastCallerRow` (`repo-intel/types.ts:63-72`) gains `percentile: number`
  (non-null: the column is `NOT NULL` and reached through an inner join).
  `service.ts:377-383` passes `percentile: c.percentile`.
- **The degraded ripgrep path (`service.ts:281-287`) sets `percentile: 0`**, the
  same way it already sets `rank: 0` — there is no persistent rank there. Keep
  the existing comment style.
- **`compareCallers` (`service.ts:846-852`), `capAndOrderCallers` (`:879-903`)
  and `MAX_*` are untouched.** `percentile` is display-only and must not become
  a sort key or a tiebreaker — adding one would change the shipped ordering,
  which is out of scope.
- **`rank` stays on the contract.** It is the documented sort key, `mcp/`'s
  parser already tolerates it, and dropping it is a breaking contract change for
  no gain. The client simply stops rendering it.
- `PrBlastCaller` (both copies) gains `percentile: z.number().int()`;
  `blast/helpers.ts:42-48` maps `percentile: c.percentile`.
- **Client copy (decided):** percentile is "share of files ranked at or below
  this one", top file ≈ 100 (`pipeline/rank.ts:54-69`), so render *distance from
  the top*:

  ```ts
  // BlastTab/helpers.ts
  /** percentile 100 → "top 1%" (never "top 0%"), 60 → "top 40%". */
  export function topPercentLabel(percentile: number): number {
    return Math.max(1, 100 - Math.round(percentile));
  }
  ```
  rendered as `t("topPercent", { percent: topPercentLabel(caller.percentile) })`
  → **"top 12%"**, in the same muted `s.statLabel` slot `rank` occupied.
- **MCP: no change.** Verified — the projection never surfaces `rank` at all
  (`BlastCallerOut = { location, symbol }`, `tools/schemas.ts:144-148`;
  `WireBlastCaller.rank` is `.nullish()` and dropped, `wire.ts:161-172`). There
  is no useless `0.00` to fix there, and adding `percentile` to a narrow
  hand-written parser that does not project it would violate `mcp/CLAUDE.md`'s
  "only the fields it projects" rule. **Leave `mcp/` alone for Fix 2.**
- The `"rank"` key in `messages/en/blast.json:45` becomes unused. **Leave it**
  (constraint 14 — unused keys are normal in this file).

### §3 Fix 3 — in-diff file references jump to the Files-changed tab

**Scope, exactly:** for **any** file reference inside the Blast tab — changed
symbol group header, caller row, or endpoint row — if that path is present in
`pr.files[].path`, clicking it switches to the "Files changed" tab and scrolls
to that file's card. If the path is **not** in the diff, the existing external
`githubBlobUrl` link is kept **unchanged**. This is **file-level**: no line
anchor, no in-app viewer for out-of-diff files (`0005`'s boundary, still in
force and still the reason the GitHub links exist).

Note the shape of the data: changed-symbol files are by construction the PR's
changed files, so those headers will essentially always take the jump branch;
callers and endpoints are the common out-of-diff case. The branch is still
written as a lookup, not hardcoded per section.

**a) Affordance — no new interaction style.** `MonoLink` already renders an
`<a target="_blank">` when given `href` and a `<button>` when given only
`onClick` (constraint 7), with identical styling. So:

```tsx
// BlastTab.tsx — one place decides, every call site uses it
function FileRef({ file, line, inDiff, onJump, repoFullName, headSha, children }: …) {
  if (inDiff) return <MonoLink onClick={() => onJump(file)}>{children}</MonoLink>;
  return <MonoLink href={fileLineHref(repoFullName, headSha, file, line)}>{children}</MonoLink>;
}
```

`fileLineHref` (`BlastTab.tsx:43-50`) is unchanged and stays the only path to
`githubBlobUrl`. The existing "`repoFullName`/`headSha` missing → plain text,
never a dead `href`" behaviour is preserved by falling through to the same
branch. This matches the codebase's existing split: same-page navigation is a
`<button>` (`SmartDiffViewer.tsx:175-179`'s `LineMarker`), external references
are `MonoLink href` (`FindingCard.tsx:68-70`).

**b) State placement — mirror `targetFindingId` exactly** (constraint 8). In
`page.tsx`, next to `findingTarget` (`:77-81`) and **above the early returns**
(constraint 9):

```ts
const [fileTarget, setFileTarget] = React.useState<{ path: string; n: number } | null>(null);
const handleJumpToFile = (path: string) => {
  setFileTarget((p) => ({ path, n: (p?.n ?? 0) + 1 }));   // nonce: same target twice must re-fire
  setTab("diff");
};
const diffFilePaths = React.useMemo(
  () => new Set((pr?.files ?? []).map((f) => f.path)),
  [pr],
);
```

`pr` may be undefined at that point (the guards come later) — hence `pr?.files ?? []`.

Threading:

- `<BlastTab … diffFilePaths={diffFilePaths} onJumpToFile={handleJumpToFile} />`
  (`page.tsx:191-193`). `diffFilePaths: ReadonlySet<string>`,
  `onJumpToFile: (path: string) => void`.
- `<DiffTab … targetFilePath={fileTarget?.path ?? null} targetFileNonce={fileTarget?.n ?? 0} />`
  (`page.tsx:180-189`) — same two-prop shape as `targetFindingId`/`targetFindingNonce`
  at `:175-176`.

**c) The scroll target in the diff viewer.**

- **A path-safe DOM id.** A raw repo path contains `/` and can contain spaces,
  `#`, quotes and other characters, so it is not usable as a literal id. New
  helper in `client/src/components/diff-viewer/helpers.ts`, exported from the
  folder's `index.ts`:

  ```ts
  /** Stable DOM id for a file's card. `encodeURIComponent` escapes `/`, spaces,
   *  `#`, quotes … into %XX, giving a valid HTML5 id with no whitespace.
   *  Look it up with `document.getElementById` ONLY — encodeURIComponent leaves
   *  `.` unescaped and `.` is a CSS class delimiter, so `querySelector('#…')`
   *  would break on any path with a file extension. */
  export function diffFileCardId(path: string): string {
    return `diff-file-${encodeURIComponent(path)}`;
  }
  ```
  This mirrors `FindingCard.tsx:55`'s `id={\`finding-${f.id}\`}` +
  `FindingsPanel`'s `getElementById` precedent; a uuid needed no encoding, a
  path does.

- **`FileCard`** (`FileCard.tsx:33-47,65-66`) gains two optional props
  (`targetFilePath?: string | null`, `targetFileNonce?: number`), an `id` on its
  root `div`, and one effect:

  ```tsx
  const isTarget = !!targetFilePath && targetFilePath === file.path;
  React.useEffect(() => {
    if (!isTarget) return;
    setOpen(true);                                  // constraint 10: a >200-line file starts collapsed
    document.getElementById(diffFileCardId(file.path))
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [isTarget, targetFileNonce, file.path]);
  ```
  The card element exists whether open or not, so no `requestAnimationFrame`/
  `setTimeout` sequencing is needed — the same reasoning `FindingsPanel.tsx:47-50`
  documents. `open` stays local state; the target only forces it true, it never
  takes ownership of it (collapsing again afterwards must still work).

- **`DiffViewer`** (`DiffViewer.tsx:14-35`) accepts the same two optional props
  and passes them to every `FileCard` — a pure pass-through, exactly like
  `renderLineMarker`, so the shared layer stays domain-free (constraint 12).

- **`SmartDiffViewer`** (`SmartDiffViewer.tsx:38-78`) accepts them and passes
  them down through `SmartDiffGroupSection` → `SmartDiffFileEntry` → `FileCard`.
  **`SmartDiffGroupSection` must also force itself open** when it contains the
  target, or a target in the `boilerplate` group (which defaults closed,
  `:24-28`) is unmounted and the jump silently does nothing:

  ```tsx
  const containsTarget = !!targetFilePath && group.entries.some((e) => e.prFile.path === targetFilePath);
  React.useEffect(() => { if (containsTarget) setOpen(true); }, [containsTarget, targetFileNonce]);
  ```
  This is the direct analogue of `FindingsPanel` clearing `hideLow` before
  scrolling — reveal, then scroll.

- **`DiffTab`** (`DiffTab.tsx:29-43,125-137`) accepts the two props and forwards
  them to **both** branches (`SmartDiffViewer` and the plain `DiffViewer`) —
  constraint 11.

**d) What happens on a jump to a file that is not rendered.** Nothing, silently
— the effect is a no-op when no `FileCard` matches. That case is unreachable by
construction (`diffFilePaths` is built from the same `pr.files` the tab renders),
so no error UI is added for it.

### §4 Fix 4 — one box per file, not one per symbol

`BlastTab.tsx:114-123` renders one `SymbolCard` per changed symbol, so three
symbols in one file produce three boxes with three identical file-path headers.

New structure, replacing `SymbolCard`:

```
FileGroup  (one per distinct changed file — `s.symbolCard` box, reused)
├── header: <FileRef …>{group.file}</FileRef>          ← §3 decides jump vs GitHub, ONCE per file
└── for each symbol in group.symbols:
    ├── symbol row: <span>{name}</span> <Badge>{kind}</Badge> {line != null && "L{line}"}  {callerCount}
    ├── callers: the existing caller list, unchanged logic, nested one level deeper
    └── a divider between symbols (not after the last one)
```

Fixed points:

- **Grouping is §0's `groupSymbolsByFile`**, called through `React.useMemo` on
  `data.changed_symbols`. The pure helper lives in the new
  `BlastTab/helpers.ts` at module scope, not in the component body
  (`react-best-practices`).
- **Caller resolution is unchanged**: `data.callers.filter(c => c.via_symbol === symbol.name)`,
  still per symbol, still no client-side re-derivation beyond that grouping
  (`0005` §7).
- **The per-symbol messaging is unchanged**: the existing `callerCount` and
  `noDownstream` keys and their placement relative to a symbol stay exactly as
  they are today (`BlastTab.tsx:205-211`) — just nested inside the group.
- **`SymbolCard`'s file-path header disappears** (superseded by the group
  header). The `key` for a group is `group.file`; for a symbol row,
  `${symbol.name}:${symbol.kind}` within its group.
- **`callers_truncated` / `endpoints_truncated` notes, the stat strip, the state
  banners, the empty state and the endpoints section are untouched**, except
  that `EndpointRow`'s file (`BlastTab.tsx:245`) now goes through `FileRef`
  too (§3).
- Sub-components stay **inside `BlastTab/`** (`frontend-ui-architecture`'s
  placement ladder) — nothing is promoted to `@devdigest/ui` or to
  `pulls/_components/`. Styles go in the existing `BlastTab/styles.ts`.

### §5 i18n

Add to `messages/en/blast.json` (constraint 14 — same file, no new namespace):

| Key | Value |
|---|---|
| `topPercent` | `"top {percent}%"` |
| `symbolLine` | `"line {line}"` |
| `jumpToFile` | `"View in this PR's diff"` — the `title`/`aria-label` on an in-diff `FileRef`, so the two affordances are distinguishable to a screen reader and on hover |

Leave `rank` (now unused) and every existing key/value in place.

### §6 Tests

**`client/.../BlastTab.test.tsx`** — extend, do not rewrite. `renderTab` gains
`diffFilePaths` and `onJumpToFile` overrides using **default-parameter
destructuring** (constraint 16). The fixture must contain a file that IS in the
diff and one that IS NOT:

- `BASE.changed_symbols` becomes **two symbols in the same file** plus one in a
  second file, each with a `line`, so grouping is observable.
- **Grouping:** the shared file path renders **once** (`getAllByText(path)` has
  length 1 for the group header), and both symbol names render under it.
- **Line:** `line 12` renders for a symbol; a symbol with `line: null` renders
  no line text and does not crash.
- **Percentile:** `top 20%` renders for `percentile: 80`; `rank` no longer
  appears anywhere (assert `queryByText(/0\.00/)` is null).
- **In-diff jump:** with `diffFilePaths: new Set(["src/util.ts"])`, the changed
  symbol's group header is a **button** (`getByRole("button", { name: … })`),
  clicking it calls `onJumpToFile` with exactly that path, and it is **not** a
  link.
- **Out-of-diff link:** a caller in `src/caller.ts` (absent from
  `diffFilePaths`) is still a **link** whose `href` is
  `githubBlobUrl(repo, sha, "src/caller.ts", 42)` with `target="_blank"` — the
  existing assertion, kept.
- **An endpoint file that IS in the diff** is a button too (proving the branch
  is not changed-symbols-only).
- The existing degraded / partial / empty / unknown-reason / null-`repoFullName`
  tests must keep passing unmodified except for fixture field additions.

**`client/.../DiffTab.test.tsx`** — one new case: rendering with
`targetFilePath` pointing at a file in `files` yields a card whose `id` is
`diffFileCardId(path)` and which is expanded even when the file exceeds
`AUTO_EXPAND_MAX_LINES`. (`scrollIntoView` is not implemented in jsdom — stub it
on `Element.prototype` in the test, as is standard; assert the expansion and the
id, not the scroll.)

**`server/test/blast.test.ts`** — fixtures gain `line`/`percentile`; the mapper
assertions at `:159-160` and `:220-221` assert both fields survive
camelCase→snake_case, including a `line: null` symbol.

**`server/test/repo-intel-blast-graph.test.ts`** — the `getSymbolRows` stub's
rows already carry `line`; assert it reaches `changedSymbols[].line`, and that a
`getResolvedCallers` stub row's `percentile` reaches `callers[].percentile`.
Also assert that **ordering is unchanged** when percentiles disagree with ranks
(i.e. percentile did not become a sort key).

**`server/test/blast.it.test.ts`** — `:136`'s exact-equality assertion gains
`line: 1`; add an assertion that each returned caller has a numeric
`percentile` matching the seeded `file_rank` row (80 / 60 at `:106-107`).

**`mcp/`** — `test/helpers/fake-api.ts`'s `makeBlast()` symbol fixture
(`:184`) gains `line`; `test/http.test.ts`'s contract-drift fixture
(`:107-114`) gains `line` on the symbol and `percentile` on the caller (it is a
copy of a real route response and must stay one); `test/tools.test.ts`'s happy
path (`:380-396`) asserts
`sc.symbols[0].location === "src/payments/retry.ts:<line>"`, plus one case where
the wire symbol has no `line` and `location` falls back to the bare file path.

### §7 Security

Applying the `security` skill's confidence rule — this pass introduces no new
input surface, so only two things are worth stating:

- **No new attacker-controlled sink.** `line`/`percentile` are numbers read from
  the repo's own index; they are rendered as React children (auto-escaped) and
  never interpolated into an `href`. Paths continue to reach `githubBlobUrl`,
  which `encodeURIComponent`s each segment (`github-urls.ts:8-13`).
- **`diffFileCardId` feeds `encodeURIComponent(path)` into a DOM id and then
  `getElementById`** — no `innerHTML`, no `querySelector` string parsing, no
  `dangerouslySetInnerHTML`. The jump target is chosen by set membership in
  `pr.files[].path`, i.e. server-supplied data, not by anything a user types.
- Workspace scoping, route auth and the request-time-no-filesystem rule are
  unchanged from `0005` §9 — no route, service or query gains a new branch.

---

## Steps

Each step is independently reviewable. Run the module's `pnpm typecheck` before
moving on. Steps 1–3 are `server/`, 4 is `mcp/`, 5–8 are `client/`.

1. **[server] `repo-intel` field pass-through** — `line: number | null` on
   `BlastChangedSymbol` and `percentile: number` on `BlastCallerRow`
   (`repo-intel/types.ts:57-72`); `percentile` added to `getResolvedCallers`'s
   existing `.select({})` and to `ResolvedCallerRow`
   (`repository.ts:126-131,519-547`); `s.line` passed at `service.ts:260` and
   `:336`; `c.percentile` passed at `:377-383`; `percentile: 0` on the degraded
   path alongside the existing `rank: 0` (`:281-287`). (§1, §2)
   Required skills: `drizzle-orm-patterns` (extend the existing typed
   `.select({})`; the join is already there — no new query, no raw SQL),
   `postgresql-table-design` (the column is `NOT NULL` smallint behind an
   existing inner join — nothing to add or index), `onion-architecture` (ring 3
   stays the only Drizzle site; no row type crosses into a service),
   `typescript-expert` (`number | null` under `noUncheckedIndexedAccess`),
   `engineering-insights` (read `server/insights.md` first — it covers
   `repo-intel` too).
   Done when: `pnpm typecheck` passes; `compareCallers`/`capAndOrderCallers`/
   `repo-intel/constants.ts` show **no diff**; `git status --porcelain
   server/src/db/migrations/` is empty.

2. **[server] Contract + mapper, both vendor copies** — `PrBlastSymbol.line:
   z.number().int().nullable()` and `PrBlastCaller.percentile: z.number().int()`
   in `server/src/vendor/shared/contracts/blast.ts`, hand-copied into
   `client/src/vendor/shared/contracts/blast.ts`; `blast/helpers.ts:37-48`
   threads both fields. (§1, §2, constraint 5)
   Required skills: `zod` (`type-export-schemas-and-types` — the file already
   exports schema + inferred type per member; `object-optional-vs-nullable` —
   `line` is `.nullable()`, present-but-null, **not** `.optional()`),
   `onion-architecture` (ring 0 contract; the camelCase→snake_case mapping stays
   in the pure `helpers.ts`, never in the route or the service).
   Done when: `diff server/src/vendor/shared/contracts/blast.ts
   client/src/vendor/shared/contracts/blast.ts` prints nothing; `brief.ts` is
   untouched; `server/test/contracts.test.ts` still passes unmodified.

3. **[server] Tests for steps 1–2** — `test/blast.test.ts`,
   `test/repo-intel-blast-graph.test.ts`, `test/blast.it.test.ts:136`. (§6)
   Required skills: `engineering-insights` (the `.it.test.ts` suffix rule; and
   `server/insights.md` 2026-08-07 — any `.it.test.ts` `appWith()` needs
   `MockSecretsProvider` so no adapter reaches the network),
   `typescript-expert`.
   Done when: `cd server && pnpm test` is green, and the ordering assertion
   fails if `percentile` is wired into `compareCallers`.

4. **[mcp] Symbol `location` becomes `file:line`** — `WireBlastSymbol.line`
   (`wire.ts:154-159`), `symbolLocation(file, line)` + its call sites
   (`project.ts:277-285,307-320`), the stale comment on
   `BlastSymbolOut.location` (`tools/schemas.ts:152`), the three test files, and
   **one appended** `mcp/insights.md` entry under an existing heading
   (constraint 17). (§1, §6)
   Required skills: `zod` (`parse-never-trust-json`, strip-not-strict,
   `.nullish()` for a field the projection can survive without),
   `onion-architecture` (`project.ts` stays pure; no SDK import in a tool file;
   `fetch` stays in `http.ts` alone), `engineering-insights` (append-only —
   supersede the 2026-08-07 entry with a new one, never edit it),
   `typescript-expert`.
   Done when: `cd mcp && pnpm typecheck && pnpm test && pnpm build` is green
   with no network and no `:3001` running; `get_blast_radius`'s `description` is
   still ≤ 200 chars; `mcp/src/tools/get-blast-radius.ts`, `constants.ts` and
   `instructions.ts` show no diff.

5. **[client] Contract sync check + the diff-viewer scroll target** — verify
   step 2's client copy landed, then `diffFileCardId` in
   `components/diff-viewer/helpers.ts` (+ one `index.ts` export), the `id` /
   forced-open / `scrollIntoView` effect on `FileCard`, and the pass-through
   props on `DiffViewer` and `SmartDiffViewer` (including
   `SmartDiffGroupSection`'s force-open). (§3c)
   Required skills: `frontend-ui-architecture` (`components/diff-viewer/` is the
   shared layer — a `targetFilePath: string` prop is domain-free; it must not
   learn anything about blast), `react-best-practices` (effect keyed on
   `[isTarget, targetFileNonce, file.path]`; `open` stays local state that the
   target only forces true; the id helper is a module-scope pure function),
   `security` (`getElementById` only — never `querySelector('#…')`, see §3c).
   Done when: `grep -rn "blast" client/src/components/diff-viewer/` prints
   nothing, and a file above `AUTO_EXPAND_MAX_LINES` renders expanded when
   targeted.

6. **[client] `page.tsx` + `DiffTab` threading** — `fileTarget` state,
   `handleJumpToFile`, the `diffFilePaths` memo (all three **above** the early
   returns), the two new `DiffTab` props forwarded to both of its subtrees, and
   the two new `BlastTab` props. (§3b, constraint 9)
   Required skills: `react-best-practices` (rules of hooks — no hook after an
   early return; the nonce exists so the same target re-fires; `useMemo` for the
   `Set` so `BlastTab` does not see a new identity every render),
   `frontend-ui-architecture` (the target-holding state belongs to the only
   component that outlives both trigger and destination — `page.tsx`, per
   `client/insights.md` 2026-08-05), `next-best-practices` (`"use client"`
   already present on every file involved; no new route or param).
   Done when: `page.tsx` compiles with no hook declared below `:103`'s first
   early return, and clicking a blast link switches the tab.

7. **[client] `BlastTab` restructure** — `BlastTab/helpers.ts`
   (`groupSymbolsByFile`, `topPercentLabel`), the `FileRef` branch, the
   file-grouped rendering replacing `SymbolCard`, the symbol line, percentile
   instead of `rank.toFixed(2)`, the new `styles.ts` entries, and the three new
   `messages/en/blast.json` keys. (§0, §1, §2, §3a, §4, §5)
   Required skills: `frontend-ui-architecture` (everything stays inside
   `_components/BlastTab/`; pure helpers in a sibling `helpers.ts`, not in a
   global `utils/` and not in the component body; nothing promoted to
   `@devdigest/ui`), `react-best-practices` (module-scope pure helpers and style
   objects; `useMemo` for the grouping; no business logic in JSX),
   `next-best-practices` (`"use client"` stays at the top),
   `security` (every out-of-diff path still goes through `fileLineHref` →
   `githubBlobUrl`; no raw `href`, no `dangerouslySetInnerHTML`),
   `engineering-insights` (`client/insights.md` 2026-08-05 — add keys to the
   existing `blast.json`, never a new namespace; and 2026-08-07 — keep the
   `{ refetch: reload }` rename so the folder's no-raw-`fetch` grep guard stays
   clean).
   Done when: a PR changing three symbols in one file renders **one** box with
   one file header; no `.toFixed(` remains in `BlastTab.tsx`; every existing
   `blast.json` key is still present.

8. **[client] Tests** — `BlastTab.test.tsx` per §6 and the one new `DiffTab`
   case. (§6)
   Required skills: `react-testing-library` (query by role — `getByRole("button")`
   vs `getByRole("link")` is the whole point of the jump-vs-link assertions;
   `@/lib/api` mocked; `NextIntlClientProvider` + `QueryClientProvider`
   wrappers), `engineering-insights` (`client/insights.md` 2026-08-07 —
   default-parameter destructuring in `renderTab`, never `?? DEFAULT`, so a
   deliberately-`null` override survives).
   Done when: `cd client && pnpm test` is green, and the in-diff test fails if
   `FileRef`'s branch is inverted.

---

## Skills the implementer must apply

- **`onion-architecture`** — steps 1, 2, 4. Ring 3 (`repository.ts`) stays the
  only Drizzle site; the facade (`repo-intel`) still owns every graph read;
  `blast/` gains no logic beyond the pure mapper in `helpers.ts`; `mcp/`'s
  `project.ts` stays pure and SDK-free.
- **`drizzle-orm-patterns`** + **`postgresql-table-design`** — step 1 only. One
  column added to an existing typed `.select({})` behind an existing inner join.
  **No migration, no new index, no new query.** If the implementer finds
  themselves running `db:generate`, they have left the plan.
- **`zod`** — steps 2, 4. `.nullable()` (not `.optional()`) for `line` on the
  contract; `.nullish()` for it on `mcp/`'s tolerant wire parser; schema **and**
  inferred type exported for every member, matching the file's existing style.
- **`frontend-ui-architecture`** — steps 5, 6, 7. The shared
  `components/diff-viewer/` layer must not learn about blast; the target state
  lives on the nearest ancestor that outlives both trigger and destination
  (`page.tsx`); new pure helpers sit in a sibling `helpers.ts` inside the
  feature folder, nothing is promoted to shared.
- **`react-best-practices`** — steps 5, 6, 7. Hooks above early returns; effect
  dependency arrays including the nonce; `useMemo` for the path `Set` and the
  grouping; module-scope helpers and style objects; local `open` state that the
  target forces but does not own.
- **`next-best-practices`** — steps 6, 7. `"use client"` on every touched
  component; no new route segment (the tab is still a `?tab=` query param).
- **`react-testing-library`** — step 8. Role-based queries (`button` vs `link`)
  and the intl + query providers; stub `scrollIntoView` rather than asserting on
  it.
- **`security`** — steps 5, 7. No new attacker-controlled sink; paths keep going
  through `githubBlobUrl`'s per-segment encoding; DOM lookup by
  `getElementById` only (§3c, §7).
- **`typescript-expert`** — throughout. `number | null` handled explicitly (never
  `?? 0` on a displayed value — `client/insights.md` 2026-07-30), strict mode
  with `noUncheckedIndexedAccess` in `groupSymbolsByFile`.
- **`engineering-insights`** — steps 1, 3, 4, 7, 8. Read `server/insights.md`,
  `client/insights.md` and `mcp/insights.md` **before** touching each package
  (mandatory project convention). The entries that bite directly here: the
  `getFileRankFor` returns `percentile` note (server, 2026-08-07), the
  cross-tab-target placement rule and the pre-built-i18n rule (client,
  2026-08-05), the `?? DEFAULT`-in-a-test-helper trap and the `refetch(` grep
  false positive (client, 2026-08-07), and the symbol-`location` note (mcp,
  2026-08-07) which this plan supersedes. At the end, append any genuine lesson
  under an **existing** heading, dated `2026-08-08`; invent no headings, edit
  nothing, and write nothing if nothing substantial surfaced.
- **`fastify-best-practices`** — **not applicable.** No route, plugin, schema or
  registration changes. Listed so its absence is a decision, not an oversight.
- **`reviewer-core` / `e2e` skills** — **not applicable.** No file in either
  package changes.

## Verification

Per module (each module's own `CLAUDE.md` commands):

```sh
cd server && pnpm typecheck && pnpm test          # unit + integration
cd client && pnpm typecheck && pnpm test
cd mcp    && pnpm typecheck && pnpm test && pnpm build
```

Static guards:

```sh
# must print NOTHING
git status --porcelain server/src/db/migrations/                 # no migration
grep -rn "toFixed" client/src/app/repos/*/pulls/*/_components/BlastTab/
grep -rn "blast" client/src/components/diff-viewer/              # shared layer stays domain-free
grep -rn "Object.groupBy" client/src/                            # §0
grep -rn "querySelector" client/src/components/diff-viewer/      # getElementById only
grep -rn "drizzle-orm\|db/schema" server/src/modules/blast/
grep -rn "@devdigest/shared" mcp/

# must print NO DIFF
diff server/src/vendor/shared/contracts/blast.ts client/src/vendor/shared/contracts/blast.ts
git diff --stat -- server/src/modules/repo-intel/constants.ts \
                   server/src/modules/blast/routes.ts \
                   server/src/modules/blast/service.ts \
                   mcp/src/tools/get-blast-radius.ts \
                   mcp/src/constants.ts mcp/src/instructions.ts
```

End-to-end check that proves the polish works (`./scripts/dev.sh`, then
`cd mcp && pnpm build`; use an indexed repo with a PR that changes a shared
helper, i.e. the same setup `0005`'s E2E step 3 describes):

1. **Grouping.** Open a PR that changes **two or more symbols in one file** →
   the Blast tab shows **one** box for that file with one file-path header and
   one row per symbol, separated by dividers — not two boxes.
2. **Line.** Each symbol row shows its declaration line, and it matches the line
   the GitHub blob view lands on for that symbol.
3. **Percentile.** Every caller row reads "top N%" with **different** values
   across callers (the old display was `rank 0.00` for all of them). Cross-check
   one against `SELECT percentile FROM file_rank WHERE repo_id=… AND file_path=…`.
4. **In-diff jump.** Click a changed symbol's file header → the page switches to
   **Files changed** and scrolls to that file's card, **expanded**, with **no**
   new browser tab. Repeat with a file large enough to default collapsed
   (>200 changed lines) and with a file in the **boilerplate** group in Smart
   order — both must open and scroll.
5. **Same target twice.** Jump, switch back to Blast, click the same file again
   → it re-scrolls (the nonce works).
6. **Out-of-diff link unchanged.** Click a caller whose file is **not** in this
   PR's diff → a new tab opens
   `github.com/{owner}/{repo}/blob/{head_sha}/{path}#L{n}` on the right line.
   Repeat for an endpoint file that is not in the diff.
7. **Endpoint file that IS in the diff** → jumps, does not open GitHub.
8. **Nothing else regressed.** `0005`'s E2E steps 5-9 still hold: the request is
   still a tens-of-milliseconds Postgres read with no clone/AST/ripgrep activity
   and no LLM call, and the empty / partial / degraded states still render
   distinctly.
9. **MCP.** `get_blast_radius(repo="owner/name", pr=<n>)` → each entry in
   `symbols[]` now has `location: "path:line"`; endpoints' `location` is still
   file-only; `isError` unset; `/mcp` still shows `devdigest: connected`.

## Explicit note

Architecture and security review are **out of scope for the implementer** and are
handled by separate review agents/skills after implementation. Implement the
constraints and decisions this plan specifies — they are requirements, not review
findings — and do not re-litigate the four fixes' scope, the file-level (not
line-level) jump target, the "out-of-diff references keep their GitHub link"
boundary, the decision to keep `rank` on the contract while displaying
`percentile`, the decision to leave `mcp/`'s caller projection alone, or the
contiguity-scan grouping in place of `Object.groupBy`. If something in the repo
contradicts this plan (a file that does not exist, a facade method that has
changed shape, a second consumer of `BlastChangedSymbol`/`BlastCallerRow`),
**stop and surface the discrepancy** instead of working around it.

## Open questions / assumptions

1. **`Object.groupBy` is unavailable in `client/`** — surfaced and resolved in
   §0 (`client/tsconfig.json:19`'s `lib` is `ES2022`). Flagged here because the
   task brief assumed otherwise; the resolution is decided, not open.
2. **`symbols.line` is nullable, so `PrBlastSymbol.line` is nullable** —
   `server/src/db/schema/context.ts:71`. The brief said `line: number`; the
   column disagrees, so the contract follows the column (§1). Every consumer
   must handle `null` rather than substituting a placeholder line.
3. **Exact percentile copy ("top N%", clamped at 1)** is the planner's call per
   the brief (§2). If the rendered numbers read oddly against a real repo — e.g.
   most callers land in "top 1%" because the repo is small — the fix is the
   label in `blast.json` plus `topPercentLabel`, both one-liners, and is not a
   reason to revisit the decision to display `percentile` instead of `rank`.
4. **No `count` badge on the Blast tab** — unchanged from `0005` §7 (it would
   force a fetch on every PR page load). Grouping does not change that.
5. **`getBlastRadius`'s only consumers are still `blast/service.ts` and the two
   server test files** — assumed, as in `0005` open question 4. Grep before
   editing `repo-intel/types.ts`; if a second consumer of `BlastChangedSymbol`
   or `BlastCallerRow` has appeared, stop and surface it.
