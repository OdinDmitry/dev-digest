# Development Plan: Blast Radius UX fixes — `client` only

> **Location/numbering note.** [`docs/plans/`](README.md) holds cross-module
> Development Plans; module-scoped ones live in `docs/plans/<module>/`. This
> plan is **`client/`-only** and would, by that rule alone, belong in
> [`docs/plans/client/`](client/). It is deliberately filed here anyway, on
> explicit instruction, as the **third entry in one continuous series** —
> [`0005-blast-radius.md`](0005-blast-radius.md) (the shipped feature) →
> [`0006-blast-radius-polish.md`](0006-blast-radius-polish.md) (line numbers,
> percentile, in-diff jump, file grouping) → this one — so the series stays
> readable in one place and takes the next number in the top-level sequence
> (`0001` … `0006` → `0007`). Splitting the third instalment into a different
> folder from its two predecessors would cost more than the rule saves.
>
> Historical: written before the `docs/specs` + `docs/plans` split, when these
> files lived in a root `specs/` folder.
>
> **Everything in §"Design decisions" is already decided.** The four fixes come
> from the user after using the shipped `0006` feature live, including the root
> cause of each. They must not be re-derived, re-researched, widened or
> "improved" during implementation. `0005`'s and `0006`'s decisions stay in
> force except where a section here supersedes one explicitly. If the repo
> contradicts something here, **stop and surface it** — see the Explicit note,
> and see §0, which is exactly that situation caught during planning.

## Goal

Four user-reported UX fixes on the Blast tab, all `client/`-only and all
subtractive or near-subtractive: (1) the redundant "no downstream callers"
sentence is deleted and the caller-count badge becomes unconditional, so every
symbol row reads `N callers` including `0 callers`; (2) a changed symbol's
declaration line becomes a clickable GitHub deep link instead of inert text;
(3) a caller's `file:line` **always** opens GitHub with the `#Lxx` anchor and
stops branching on whether its file is in this PR's diff; (4) switching
PR-detail tabs resets the shared scroll container to the top, so a scroll
position deep inside "Files changed" no longer leaks into the next tab. File-
*level* references (the file-group header, the endpoint row) keep `0006`'s
in-diff-jump-vs-GitHub-link branching completely unchanged.

## Out of scope

Do not implement these, do not leave TODOs for them, do not "prepare" for them.

- **A line number on `impacted_endpoints` rows.** `PrBlastEndpoint` is
  `{ endpoint, file, hops }` (`client/src/vendor/shared/contracts/blast.ts:41-46`)
  and never carried a line, because `extractEndpoints()` on the server never
  captured one. This was already declared out of scope in `0006`; it stays out
  of scope. `EndpointRow` therefore stays a **file-level** reference and keeps
  using `FileRef`.
- **Any change to `FileRef`'s in-diff/out-of-diff branching, or to where it is
  used at file level** (`BlastTab.tsx:216-243` for the component,
  `:265-278` `FileGroup`'s header, `:354-385` `EndpointRow`). Fixes 2/3 are
  *line*-level only. `0006`'s tests for that branching must keep passing
  **unmodified**.
- **Any change to `client/src/vendor/ui/shell/AppFrame.tsx`** or to any other
  shared vendored UI file. `AppFrame` is the shell for every page in the app;
  Fix 4 is implemented in `page.tsx` alone (§3).
- **Any change to `DiffTab.tsx`'s scroll poll** (`DiffTab.tsx:109-125`) or to
  anything under `client/src/components/diff-viewer/`. Fix 4 does not touch
  them; the poll shipped in `0006` and works.
- **Any `server/`, `mcp/`, `reviewer-core/` or `e2e/` change.** No contract
  changes, no new fields, no migrations, no MCP projection change. This plan
  edits four `client/` files plus one test file.
- **Deleting the now-unused `"noDownstream"` key from
  `messages/en/blast.json:15`.** Constraint 5.
- **Fixing `"callerCount": "{count} callers"` to be grammatical at 1** ("1
  callers"). Pre-existing, explicitly accepted by the user, and pluralization
  is a separate concern; the key works unmodified at 0, which is what Fix 1
  needs.
- **Any ref-forwarding / context / scroll-container-registry solution for Fix
  4.** §3 is decided: one `document.querySelector("main")` in `page.tsx`.
- **Architecture and security review of the result** — see "Explicit note".

## Constraints

Verified against HEAD (branch `MCP`, 2026-08-08) by reading each file. Every
line number below was re-checked; where the brief's number had moved, the
verified one is given and flagged.

1. **`SymbolRow` today has both redundant caller-count affordances, exactly as
   described.** `BlastTab.tsx:322-324` renders the count badge behind
   `callers.length > 0 &&`; `:327-329` renders `s.noDownstream` +
   `t("noDownstream", { count: 1 })` as the `else` of a ternary whose other
   branch is the caller list (`:330-349`). Brief cited `~297-352` for
   `SymbolRow` — verified exact: `SymbolRow` spans `:297-352`.
2. **`fileLineHref` is at `BlastTab.tsx:44-51`** (brief said `~44-51` —
   exact), signature
   `(repoFullName: string | null, headSha: string | null, file: string, line?: number) => string | undefined`,
   returning `undefined` when either of the first two is falsy. It is the only
   path to `githubBlobUrl` in this folder and stays unchanged.
3. **`MonoLink` with `href === undefined` renders a `<button>`, NOT plain
   text.** `client/src/vendor/ui/primitives/MonoLink.tsx:29-58`: the `href`
   branch returns an `<a>`, and **the fallthrough always returns a
   `<button>`** — with `onClick={undefined}` when none was passed, i.e. an
   inert, focusable, pointer-cursored control. This directly contradicts the
   brief's "MonoLink with `href={undefined}` already renders as plain text".
   See §0 for the decided resolution.
4. **`symbol.file` exists on `PrBlastSymbol`** (`contracts/blast.ts:21-27`:
   `{ file, name, kind, line: number | null }`), so a symbol's line href can be
   built without threading the group's file down — but note `FileGroup` already
   guarantees `group.file === symbol.file` for every symbol in the group
   (`helpers.ts:13-21` groups by exactly that field). Use `symbol.file`.
5. **`messages/en/blast.json` keeps unused keys on purpose** — the pre-built
   i18n scaffolding pattern (`client/insights.md`, 2026-08-05; the file already
   carries unused `view.*`, `graph.*`, `stat.crons`, and `rank` which `0006`
   orphaned and left). `"noDownstream"` (`:15`) joins that list. `"callerCount"`
   (`:14`) is `"{count} callers"` and needs **no** change to render `0 callers`.
   **No edit to `blast.json` at all in this plan.**
6. **`page.tsx`'s three early returns are at `:119`, `:127`, `:139`** (brief:
   `~119, 127, 139` — exact). Every hook must be declared above `:119`
   (`react-best-practices`, rules of hooks). The existing tab-related state sits
   at `:77-97` (`findingTarget` `:77-81`, `handleOpenFinding` `:78-81`,
   `fileTarget` `:88-92`, `diffFilePaths` `:94-97`) — brief: `~77-97`, exact.
   `tab` is derived at `:62` (`search.get("tab") ?? "overview"`).
7. **`AppFrame.tsx:29` is the app's single scrollable container** —
   `<main style={{ flex: 1, minHeight: 0, overflow: "auto" }}>{children}</main>`.
   Verified: `grep -rn "<main" client/src` returns **exactly one hit**, that
   line. So `document.querySelector("main")` is unambiguous today, which is the
   safety check the brief asked for. Recorded here so a future second `<main>`
   is a known-breaking change rather than a silent one.
8. **`AppFrame` is not remounted by a `?tab=` change.** `page.tsx` returns
   `<AppShell crumb={crumb}>` from the same component across every tab value and
   swaps only the children inside it (`:166-217` mounts exactly one tab's
   content), and the tab lives in a query param on the same route
   (`setParam` → `router.replace`, `:64-70`). This is the same fact
   `client/insights.md` (2026-08-05) relies on for `findingTarget`'s placement —
   and it is precisely why the scroll offset survives the switch.
9. **`DiffTab`'s scroll-to-target is a `setTimeout` poll owned by `DiffTab`,
   first attempt at 50 ms** (`DiffTab.tsx:109-125`; `MAX_ATTEMPTS = 60`,
   `behavior: "smooth"`). Verified still shaped this way, per the brief's
   instruction to check before relying on it. **Correction to the brief's
   ordering rationale:** React runs effects **child-first**, so `DiffTab`'s
   effect actually runs *before* `page.tsx`'s new `[tab]` effect on a switch to
   the diff tab — but the conclusion is unchanged and stronger: the poll's
   scroll is deferred by `setTimeout(…, 50)`, so it always lands *after* the
   synchronous top-reset regardless of effect ordering. Do not "fix" the
   ordering by reordering effects or adding a delay to the reset.
10. **`client/insights.md`'s two 2026-08-08 entries are the `0006` debugging
    history for this exact area** — the "scroll target must live on an ancestor
    that doesn't unmount across the subtree swap" lesson and the
    "`requestAnimationFrame` / `behavior: smooth` silently never complete in the
    non-compositing browser-automation pane" lesson. Both are already resolved
    in the shipped code. **Do not re-open, re-debug or re-instrument any of
    that**; if a manual verification of Fix 4 through that tool shows no
    movement, read the second entry before concluding anything.
11. **`@testing-library/user-event` is NOT installed in `client/`**
    (`client/insights.md`, 2026-08-08). Use `fireEvent`, matching
    `BlastTab.test.tsx:2`'s existing import.
12. **Test-helper overrides use default-parameter destructuring, not `??`**
    (`client/insights.md`, 2026-08-07). `BlastTab.test.tsx:53-63`'s `renderTab`
    already does; any new override must follow suit.
13. **`client/tsconfig.json` has `strict` + `noUncheckedIndexedAccess` and no
    `noUnusedLocals`/`noUnusedParameters`** (`:7-8`). So a prop left unused
    after Fix 2/3 would **not** fail `pnpm typecheck` — which is why §2 removes
    it deliberately rather than leaving it to a compiler error.
14. **There is no page-level test anywhere in `client/`.**
    `glob client/src/**/page.test.tsx` returns nothing; every existing test is a
    `_components/<Name>/<Name>.test.tsx`. Fix 4 therefore has no natural unit
    test home — see §4.
15. **Do-not-touch for this plan:** `client/src/vendor/**` (both `ui` and
    `shared` — no contract change, no primitive change), `client/messages/**`,
    `client/src/components/diff-viewer/**`, `DiffTab.tsx`,
    `SmartDiffViewer.tsx`, `BlastTab/helpers.ts`, and everything outside
    `client/`.

## Affected modules & files

### `client/` (the only module)

| File | Change |
|---|---|
| `src/app/repos/[repoId]/pulls/[number]/_components/BlastTab/BlastTab.tsx` | Fix 1 (`SymbolRow`'s count badge + `noDownstream` removal), Fixes 2/3 (new `LineRef`, symbol line and caller `file:line` become always-GitHub), prop trim on `SymbolRow` |
| `src/app/repos/[repoId]/pulls/[number]/_components/BlastTab/styles.ts` | drop the now-dead `noDownstream` entry; add one `lineRefText` entry (§0) |
| `src/app/repos/[repoId]/pulls/[number]/page.tsx` | Fix 4 — one `useEffect` keyed on `[tab]`, above the early returns |
| `src/app/repos/[repoId]/pulls/[number]/_components/BlastTab/BlastTab.test.tsx` | new/updated cases per §4 |
| `insights.md` | append at most one dated entry under an **existing** heading, if anything substantial surfaced |

### Explicitly not touched

`messages/en/blast.json` (constraint 5), `BlastTab/helpers.ts`, `DiffTab.tsx`,
`DiffTab.test.tsx`, `src/components/diff-viewer/**`, `src/vendor/**`,
`server/`, `mcp/`, `reviewer-core/`, `e2e/`.

---

## Design decisions

The implementer must not re-derive any of these.

### §0 One discrepancy found while writing this plan — read this first

**`MonoLink` with no `href` renders an inert `<button>`, not plain text.**
The brief states that `MonoLink href={undefined}` "already renders as plain text
per its established behavior, so the 'no link when repo unknown' case is free".
It does not: `MonoLink.tsx:47-58` unconditionally falls through to a `<button
className="mono" onClick={undefined}>` whenever `href` is falsy — a control that
looks and focuses like a control but does nothing. That is what the caller row
renders **today** when `repoFullName`/`headSha` are null; the existing test
(`BlastTab.test.tsx:98-105`) passes only because it asserts "the text is
present" + "there is no *link*", never "there is no button".

This matters because Fixes 2/3 would multiply that dead control: the symbol
line, currently a plain `<span>` (`BlastTab.tsx:320`), would become a second
dead button per symbol row whenever the repo isn't resolved yet.

**Resolution (decided, do not re-derive):** one tiny local component in
`BlastTab.tsx`, used at both line-level sites, that falls back to real text:

```tsx
/** A LINE-level reference: always a GitHub deep link, never an in-diff jump.
 *  The "Files changed" tab renders only the unified-diff HUNKS from
 *  `pr.files[].patch`, so an arbitrary declaration/call-site line has no
 *  reliable in-app scroll target even when its file IS in the diff — only
 *  file-level anchors exist (`diffFileCardId`, specs/0006 §3c). GitHub can
 *  always show any line at the pinned SHA, so line references don't branch.
 *  Falls back to text (not `MonoLink`) when the href is unknown: `MonoLink`
 *  with no `href` renders an inert <button>, not plain text. */
function LineRef({ href, children }: { href?: string; children: React.ReactNode }) {
  if (!href) return <span className="mono" style={s.lineRefText}>{children}</span>;
  return <MonoLink href={href}>{children}</MonoLink>;
}
```

with one new style entry, matching `MonoLink`'s own resting look so the
fallback is visually indistinguishable from the linked state minus the
affordance:

```ts
// BlastTab/styles.ts
lineRefText: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
```

This is a deliberate, minimal deviation from the brief's "just use a plain
`MonoLink`" wording, forced by the fact above. It is still **less** code than
today at these two sites (no `inDiff`, no `onJump`, no `t` threading), it keeps
both line-level references identical, and it makes the existing
`repoFullName: null` test assert something true rather than accidentally true.
`MonoLink` itself is **not** modified (constraint 15) — no new prop, no new
branch in a vendored primitive.

### §1 Fix 1 — one caller-count affordance, always rendered

`SymbolRow` currently states the same fact twice and inconsistently: a badge
that only appears when there is at least one caller (`:322-324`), and a
sentence that only appears when there are none (`:327-329`). The sentence's
copy is also stale — `"{count} changed symbol(s), no downstream callers found."`
with a hardcoded `count: 1`, written when a card meant one symbol, which after
`0006`'s file grouping reads as a claim about the whole group.

Decided shape:

- **Delete the `noDownstream` branch and the ternary around it.** The caller
  list renders as `callers.length > 0 && <div style={s.callerList}>…</div>` (or
  an equivalent guard). There is **no `else`**.
- **Drop the `callers.length > 0 &&` guard on the count badge** at `:322-324`
  so it renders unconditionally: `0 callers`, `1 callers`, `N callers`.
- **`s.noDownstream` (`styles.ts:97-101`) is deleted.** Unused *style* entries
  are ordinary dead code, not scaffolding; the pre-built-scaffolding convention
  (`client/insights.md` 2026-08-05) is about `messages/en/*.json`, and only
  that. Verified `noDownstream` has exactly three occurrences in `client/`
  (the JSON key, this style, the JSX at `:328`) — after this step, one.
- **`messages/en/blast.json` is not edited at all** (constraint 5): `callerCount`
  already interpolates 0 correctly, and `noDownstream` stays as an unused key.

### §2 Fixes 2 & 3 — line references always go to GitHub; file references are untouched

**The reasoning is settled and must not be re-litigated.** The "Files changed"
tab renders only the unified-diff hunks contained in `pr.files[].patch`, not
whole files, so a symbol's declaration line or a caller's call site may not be
present in the rendered patch even when the file itself is in the diff. There is
no reliable in-app scroll target for an arbitrary line — only the file-level
`diffFileCardId` anchors `0006` introduced. GitHub can always show any line of
the file at the pinned head SHA. So the boundary is drawn at the file/line
distinction:

| Reference | Behaviour | Component |
|---|---|---|
| File-group header (`FileGroup`, `:265-278`) | **unchanged** — in-diff → jump, else GitHub | `FileRef` |
| Endpoint row (`EndpointRow`, `:354-385`) | **unchanged** — in-diff → jump, else GitHub | `FileRef` |
| Symbol's own declaration line (`:320`) | **always** GitHub `#Lxx`; text when repo unknown | `LineRef` (§0) |
| Caller's `file:line` (`:331-343`) | **always** GitHub `#Lxx`; text when repo unknown | `LineRef` (§0) |

Concretely in `BlastTab.tsx`:

- **`:320`** — `{symbol.line != null && <span style={s.statLabel}>{t("symbolLine", { line: symbol.line })}</span>}`
  becomes

  ```tsx
  {symbol.line != null && (
    <LineRef href={fileLineHref(repoFullName, headSha, symbol.file, symbol.line)}>
      {t("symbolLine", { line: symbol.line })}
    </LineRef>
  )}
  ```

  The `symbol.line != null` guard **stays** — `line` is `number | null` on the
  contract (`contracts/blast.ts:26`) and a null line must render nothing, never
  a fabricated `:0`/`:1` (`0006` §1, still in force). `s.statLabel` is dropped
  from this element; `MonoLink`/`LineRef` bring their own type styling.
- **`:331-343`** — the caller row's `<FileRef … inDiff={diffFilePaths.has(caller.file)} onJump={onJumpToFile} …>`
  becomes

  ```tsx
  <LineRef href={fileLineHref(repoFullName, headSha, caller.file, caller.line)}>
    {caller.file}:{caller.line}
  </LineRef>
  ```

  `caller.line` is a non-nullable `number` (`contracts/blast.ts:34`), so no
  guard is needed here.
- **`fileLineHref` (`:44-51`) is unchanged** — it already takes an optional
  `line` and already returns `undefined` when repo info is missing.
- **`FileRef` (`:216-243`) is unchanged** and keeps both remaining call sites.
- **Prop trim (decided — the brief left this to the planner):** after the above,
  `SymbolRow` reads neither `diffFilePaths` nor `onJumpToFile`. **Remove both
  from `SymbolRow`'s props and from `FileGroup`'s `<SymbolRow …>` call site**
  (`:282-290`). Keeping unused props "for API consistency" would be exactly the
  kind of dead surface a reader has to disprove — and constraint 13 means the
  compiler would never flag it. **Keep both props on `FileGroup`,
  `EndpointRow`, `BlastResult` and `BlastTab`**: `FileGroup` still needs them
  for its header and `EndpointRow` for its file. `SymbolRow` still needs `t`
  (`callerCount`, `symbolLine`, `topPercent`), `repoFullName` and `headSha`.

### §3 Fix 4 — a tab switch resets the shared scroll container

**Root cause (settled):** `AppFrame.tsx:29`'s `<main …overflow: "auto">` is the
single scrollable container for the whole app shell, not one per tab, and a
`?tab=` change swaps only `page.tsx`'s children inside that same persistent
`<main>` (constraint 8). So scrolling deep into "Files changed" — e.g. via
`0006`'s Blast-tab jump — and then clicking straight to another tab leaves the
scrollbar where it was, and the new tab renders starting from that offset,
which for a long diff can be the very bottom.

**Decided fix, `page.tsx` only:**

```tsx
// A ?tab= change swaps this page's children inside AppFrame's single
// persistent scrollable <main> (vendor/ui/shell/AppFrame.tsx) — nothing
// remounts, so the previous tab's scroll offset would otherwise carry into
// the next one (e.g. Files changed, scrolled to the bottom, → Blast).
React.useEffect(() => {
  document.querySelector("main")?.scrollTo({ top: 0 });
}, [tab]);
```

Fixed points:

- **Placement: alongside the other tab-related state at `:77-97`, and above
  every early return** (`:119`, `:127`, `:139` — constraint 6, the same rules-of-
  hooks constraint `0006` already established for `fileTarget`/`diffFilePaths`).
  `tab` is already in scope from `:62`.
- **`AppFrame.tsx` is NOT modified.** It is shared by every page in the app;
  changing it would alter behaviour on routes this plan has neither touched nor
  considered.
- **The un-scoped `document.querySelector("main")` is accepted, deliberately.**
  It relies on there being exactly one `<main>` in the app — checked
  specifically, and true today: `grep -rn "<main" client/src` returns exactly
  one hit (constraint 7). The user's explicit instruction is "no overcomplicated
  code", and a ref-forwarding or context-based scroll-container registry would
  mean changing `AppFrame` (see above) plus every consumer. **Do not build one.**
  The discomfort is recorded here rather than engineered away.
- **It does not fight `0006`'s jump-to-file scroll.** `handleJumpToFile`
  (`:89-92`) sets `fileTarget` *and* `setTab("diff")` in one handler, so this
  effect and `DiffTab`'s poll both run for that commit — and the poll's scroll
  is `setTimeout`-deferred by 50 ms (`DiffTab.tsx:121-123`), so it always lands
  after the synchronous top-reset. Note constraint 9's correction to the
  brief's stated reason (effects run child-first, not parent-first); the outcome
  is the same and does not depend on effect ordering at all. **Do not add a
  delay, a flag or an ordering hack to "protect" the jump.**
- **Firing on first mount is fine and intended** (the container is already at
  the top; the call is a no-op).
- **Clicking "jump to file" while already on the diff tab** doesn't re-fire this
  effect (`tab` is unchanged) — the poll's nonce handles re-scrolling, exactly
  as `0006` designed it. This is correct, not a gap.

### §4 Tests

**`BlastTab.test.tsx`** — extend, do not rewrite. The existing fixture (`BASE`,
`:26-51`) already has what's needed: two symbols with lines in `src/util.ts`,
one with `line: null` in `src/other.ts`, and one caller in `src/caller.ts` with
`via_symbol: "doThing"` (so `doOtherThing` and `helper` both have **zero**
callers).

| # | Existing test | Action |
|---|---|---|
| a | `:81-96` — caller `file:line` links to GitHub | **Keep as-is** (`src/caller.ts` is in no test's `diffFilePaths`), and **add a new case** proving it stays a GitHub link even when `diffFilePaths` **does** contain `src/caller.ts` — that is the whole point of Fix 3 |
| b | `:98-105` — caller `file:line` is text, not a link, when `repoFullName` is null | **Keep unmodified.** Still valid under `LineRef`; §0 makes it *more* true (a `<span>`, not an inert `<button>`). Do **not** add a `queryByRole("button")` assertion — the caller row's parent still contains other controls |
| c | `:118-128` — each symbol's line renders as text | **Extend**: keep the visible-text assertions and `queryAllByText(/^line \d+$/)` `.toHaveLength(2)`, and **add** that `getByRole("link", { name: "line 12" })` has `href === githubBlobUrl(REPO_FULL_NAME, HEAD_SHA, "src/util.ts", 12)` |
| d | `:139-150` and `:152-162` — file-header and endpoint in-diff buttons | **Must keep passing unmodified.** Fixes 2/3 do not touch `FileRef` or file-level branching. If either needs an edit, the implementer has changed something out of scope — stop and surface it |
| e | — | **New**: `queryByText(/no downstream callers/i)` finds nothing anywhere (the old `noDownstream` copy is gone), **and** a zero-caller symbol still shows its count — `getAllByText("0 callers")` has length 2 (`doOtherThing`, `helper`) while `getByText("1 callers")` covers `doThing` |

Notes for the implementer:

- `renderTab`'s existing `diffFilePaths` override (`:56`) is all that (a)'s new
  case needs — pass `new Set(["src/caller.ts"])` and assert the link, not a
  button. Follow constraint 12's default-parameter style if any new override is
  added.
- Query by **role** for the link/button distinction (`react-testing-library`);
  that distinction is the entire subject of Fixes 2/3 and of `0006`'s (d) tests.
- Use `fireEvent`, not `user-event` (constraint 11).

**`DiffTab.test.tsx`** — **confirmed to need no change.** Its scroll-target test
(`:132-149`) asserts the card's `diffFileCardId` id and that a large file
renders expanded when targeted; it renders `DiffTab` directly, never `page.tsx`
or `AppFrame`, so Fix 4 is invisible to it. Read it and confirm before running —
do not assume — but do not pre-emptively edit it.

**`page.tsx`'s scroll-reset effect: deliberately left to manual/E2E
verification, no new test file.** Constraint 14: there is no `page.test.tsx`
anywhere in `client/` — every test in the suite is a colocated
`_components/<Name>/<Name>.test.tsx`. Inventing the app's first page-level test
harness (which would need `useParams`/`useSearchParams`/`useRouter` mocks, the
repo context, the shell, and a jsdom stub for `Element.prototype.scrollTo`,
which jsdom does not meaningfully implement) is disproportionate to a
three-line effect and is not this plan's job. **This is a recorded testing gap,
not an oversight** — it is covered by Verification step 4 below. Do not create
`page.test.tsx`.

### §5 Security

Applying the `security` skill's confidence rule — this pass adds **no new input
surface** and removes two branches. Two things worth stating:

- **No new sink.** Line numbers are integers from the repo's own index; every
  new `href` is built by the existing `fileLineHref` → `githubBlobUrl`, which
  `encodeURIComponent`s each path segment. `LineRef` never receives a raw
  string href from anywhere else — do not give it one.
- **`document.querySelector("main")`** takes a **hardcoded literal** selector
  with no interpolation, and calls only `scrollTo` on the result — no
  `innerHTML`, no user-controlled selector, no `dangerouslySetInnerHTML`. It is
  a code-smell discussion (§3), not a security one.

---

## Steps

Each step is independently reviewable. Run `cd client && pnpm typecheck` before
moving on. All four steps are `client/`.

1. **[client] Fix 1 — collapse the two caller-count affordances into one** —
   in `BlastTab.tsx`'s `SymbolRow`: remove the `callers.length > 0 &&` guard on
   the count badge (`:322-324`) so it always renders; delete the
   `noDownstream` branch and its ternary (`:327-329`), leaving the caller list
   behind a plain `callers.length > 0 &&` guard. Delete the now-dead
   `noDownstream` entry from `BlastTab/styles.ts:97-101`. **Do not edit
   `messages/en/blast.json`.** (§1)
   Required skills: `react-best-practices` (conditional rendering without a
   dead `else`; no logic moved into JSX beyond the guard),
   `frontend-ui-architecture` (the change stays inside
   `_components/BlastTab/`; styles stay in the colocated `styles.ts`),
   `engineering-insights` (read `client/insights.md` first — the
   pre-built-i18n-scaffolding entry, 2026-08-05, is why the JSON key stays).
   Done when: `grep -rn "noDownstream" client/src` returns nothing (the key
   remains only in `messages/en/blast.json`), and a symbol with no callers
   renders `0 callers`.

2. **[client] Fixes 2 & 3 — line references always link to GitHub** — add the
   `LineRef` component and the `lineRefText` style per §0; convert the symbol's
   line (`:320`) and the caller's `file:line` (`:331-343`) to `LineRef` +
   `fileLineHref` per §2; remove `diffFilePaths` and `onJumpToFile` from
   `SymbolRow`'s props and from `FileGroup`'s call site (`:282-290`).
   **`FileRef`, `FileGroup`'s header and `EndpointRow` are not touched.** (§0,
   §2)
   Required skills: `frontend-ui-architecture` (`LineRef` is a sub-component
   extracted for readability and stays in the **same file** as its only
   consumer — placement-ladder rung 1; it is not promoted to `BlastTab/`'s own
   file, not to `pulls/_components/`, and certainly not to `@devdigest/ui`),
   `react-best-practices` (module-scope component declaration, not nested
   inside `SymbolRow`; props narrowed to what is actually read),
   `typescript-expert` (`symbol.line` is `number | null` — keep the explicit
   `!= null` guard, never `?? 0`, per `client/insights.md` 2026-07-30;
   `href?: string` matches `fileLineHref`'s `string | undefined`),
   `security` (every href still routed through `fileLineHref` → `githubBlobUrl`;
   no raw `href`),
   `next-best-practices` (`"use client"` at `:8` stays).
   Done when: `pnpm typecheck` passes; `BlastTab.tsx` contains exactly two
   `<FileRef` usages (the group header and the endpoint row) and exactly two
   `<LineRef` usages; `SymbolRow`'s signature no longer mentions
   `diffFilePaths`/`onJumpToFile`; `FileGroup`/`EndpointRow`/`BlastResult`/
   `BlastTab` still do.

3. **[client] Fix 4 — reset the shared scroll container on tab change** — the
   `React.useEffect(() => { document.querySelector("main")?.scrollTo({ top: 0 }); }, [tab])`
   from §3, placed next to `findingTarget`/`fileTarget` (`page.tsx:77-97`) and
   **above** the first early return at `:119`, with the comment explaining
   *why* it is needed (the single persistent `<main>`) so it doesn't read as a
   cargo-culted scroll hack. **No change to `AppFrame.tsx` or `DiffTab.tsx`.**
   (§3)
   Required skills: `react-best-practices` (rules of hooks — no hook below an
   early return; the effect's dep array is exactly `[tab]`; effects are the
   right tool for an imperative DOM side effect that no render can express),
   `frontend-ui-architecture` (`page.tsx` is the composition/route layer and the
   only component that outlives every tab — the same reasoning that put
   `findingTarget` there, `client/insights.md` 2026-08-05; the shared
   `vendor/ui` shell must not learn about this page's tabs),
   `next-best-practices` (client component, `"use client"` already at `:6`; the
   tab is still a `?tab=` query param, no new route segment),
   `engineering-insights` (`client/insights.md`'s two 2026-08-08 entries —
   constraint 10 — explain why the existing `DiffTab` poll is shaped the way it
   is and why a `smooth` scroll may appear not to move in the automation pane;
   read them before touching or doubting anything scroll-related).
   Done when: `git diff --stat -- client/src/vendor/` is empty; no hook is
   declared below `page.tsx:119`; switching from a scrolled "Files changed" to
   "Blast" starts at the top, and a Blast → jump-to-file still lands on the
   target file's card.

4. **[client] Tests** — `BlastTab.test.tsx` per §4 (a-new-case, c-extended,
   e-new; b and d unmodified); read `DiffTab.test.tsx` and confirm it needs no
   change. **Do not create `page.test.tsx`** (§4). (§4)
   Required skills: `react-testing-library` (`getByRole("link")` vs
   `getByRole("button")` is the substance of the Fix 2/3 assertions;
   `queryByText` for proving removed copy; the existing
   `NextIntlClientProvider` + `QueryClientProvider` wrappers and the `@/lib/api`
   mock at `:9-14` are reused as-is),
   `engineering-insights` (`client/insights.md` 2026-08-07 —
   default-parameter destructuring in `renderTab`, never `?? DEFAULT`; and
   2026-08-08 — `user-event` is not installed, use `fireEvent`),
   `typescript-expert` (the fixture is typed `PrBlastRadius`; no `as any`).
   Done when: `cd client && pnpm test` is green; test (e) fails if the
   `noDownstream` branch is restored; test (a)'s new case fails if the caller
   row is routed back through `FileRef`; tests (d) pass with a zero-line diff.

5. **[client] `insights.md` wrap-up** — append **at most one** dated
   (`2026-08-08`) entry under an **existing** heading, only if something
   substantial surfaced that a cold agent would otherwise re-investigate. The
   `MonoLink`-renders-a-button-not-text finding (§0) is a strong candidate for
   **Tool & Library Notes** or **Codebase Patterns** if it isn't already implied
   by the existing 2026-08-08 `MonoLink` entry (`insights.md:21`) — read that
   entry first and don't duplicate it. Append-only: never edit or delete an
   existing entry, never invent a heading, and write nothing if nothing
   substantial came up.
   Required skills: `engineering-insights` (the whole step).

---

## Skills the implementer must apply

- **`frontend-ui-architecture`** — steps 1, 2, 3. Everything stays inside
  `_components/BlastTab/` and `page.tsx`; `LineRef` is a same-file sub-component
  (placement ladder rung 1) with exactly one consumer, so it is **not**
  extracted anywhere; the shared `vendor/ui` shell and `components/diff-viewer/`
  layers stay untouched and domain-free.
- **`react-best-practices`** — steps 1, 2, 3. Rules of hooks (the `[tab]`
  effect above `page.tsx`'s early returns); a component declared at module
  scope, never inside another component's body; props narrowed to what is read;
  no dead `else` branch left behind.
- **`next-best-practices`** — steps 2, 3. `"use client"` already present on both
  touched files; no new route segment, no server component, no metadata or
  caching implication — the tab is still a query param.
- **`react-testing-library`** — step 4. Role-based queries are what make the
  link-vs-button assertions meaningful; reuse the existing provider wrappers and
  `@/lib/api` mock; `fireEvent` (constraint 11).
- **`typescript-expert`** — steps 2, 4. `symbol.line: number | null` handled
  with an explicit `!= null` guard, never `?? 0` on a displayed value
  (`client/insights.md` 2026-07-30); `href?: string` lines up with
  `fileLineHref`'s `string | undefined` under `strict`.
- **`security`** — step 2. No new sink: every href still goes through
  `fileLineHref` → `githubBlobUrl`'s per-segment encoding; the one DOM query is
  a hardcoded literal selector.
- **`engineering-insights`** — steps 1, 3, 4, 5. Read `client/insights.md`
  **before** touching anything (mandatory project convention). The entries that
  bite here: the pre-built-i18n rule (2026-08-05), the cross-tab-target
  placement rule (2026-08-05), the `?? DEFAULT`-in-a-test-helper trap
  (2026-08-07), the `MonoLink`-shape-vs-plan lesson (2026-08-08), and the two
  scroll/`rAF` entries (2026-08-08) that explain the shipped `DiffTab` poll.
- **`zod`, `drizzle-orm-patterns`, `postgresql-table-design`,
  `onion-architecture`, `fastify-best-practices`** — **not applicable.** No
  contract, schema, query, service, route or ring boundary changes; this plan
  does not open `server/`, `mcp/` or `reviewer-core/` at all. Listed so their
  absence is a decision, not an oversight.

## Verification

Module commands (from `client/CLAUDE.md`):

```sh
cd client && pnpm typecheck && pnpm test
cd client && pnpm build        # the tab is a client component; build catches nothing extra, but is cheap
```

Static guards:

```sh
# must print NOTHING
grep -rn "noDownstream" client/src/                       # style + JSX both gone (key stays in messages/)
grep -rn "querySelector" client/src/components/diff-viewer/
git diff --stat -- client/src/vendor/                     # AppFrame + MonoLink + contracts untouched
git diff --stat -- client/messages/                       # no i18n change in this plan
git diff --stat -- server/ mcp/ reviewer-core/ e2e/       # client-only
git diff --stat -- client/src/app/repos/*/pulls/*/_components/DiffTab/

# must still print exactly ONE hit
grep -rn "<main" client/src/                              # the querySelector in Fix 4 stays unambiguous

# must still be present
grep -n "noDownstream" client/messages/en/blast.json      # unused key deliberately kept
```

End-to-end check that proves the fixes work (`./scripts/dev.sh`, then an
indexed repo with a PR that changes a shared helper — the same setup `0005` §3
and `0006` describe):

1. **Caller count.** Open the Blast tab on a PR whose changed file has several
   symbols. Every symbol row shows a count — including `0 callers` for symbols
   with none — and the sentence "…no downstream callers found." appears
   **nowhere** on the page.
2. **Symbol line is a link.** Click a symbol's `line N` → a **new tab** opens
   `github.com/{owner}/{repo}/blob/{head_sha}/{path}#L{N}` and GitHub lands on
   that line. Repeat for a symbol whose file **is** in the diff — it must still
   open GitHub, not switch tabs.
3. **Caller line is a link, always.** Click a caller's `file:line` where the
   caller's file **is** part of this PR's diff → still a new GitHub tab at
   `#L{line}`, **no** tab switch. Repeat for an out-of-diff caller — identical
   behaviour. Then confirm the file-level references are unchanged: clicking the
   **file-group header** for an in-diff file still switches to "Files changed"
   and scrolls to that card, and an out-of-diff **endpoint** file still opens
   GitHub.
4. **Scroll reset.** On "Files changed", scroll to the very bottom of a long
   diff, then click straight to "Blast" (or "Overview", or "Agent runs") → the
   new tab renders **from the top**, not mid-page. Repeat in both directions and
   for every tab.
5. **Scroll reset does not break the jump.** From the Blast tab, click an
   in-diff file-group header → the page switches to "Files changed" **and**
   scrolls to that file's card, expanded (the `0006` behaviour, unregressed).
   Switch back to Blast and click the same header again → it re-scrolls (the
   nonce still works). If the scroll appears not to move when verifying through
   the browser-automation pane, read `client/insights.md`'s 2026-08-08 entry on
   non-composited tabs **before** concluding anything is broken.
6. **Nothing else regressed.** `0006`'s remaining E2E checks still hold: file
   grouping (one box per file), `top N%` per caller, and the degraded /
   partial / empty banners still render distinctly.

## Explicit note

Architecture and security review are **out of scope for the implementer** and
are handled by separate review agents/skills after implementation. Implement the
constraints and decisions this plan specifies — they are requirements, not
review findings — and do not re-litigate: the file-vs-line boundary (file
references branch, line references never do), the decision to leave `FileRef`
and both of its remaining call sites untouched, the decision to keep the unused
`noDownstream` i18n key while deleting its style, the plain
`document.querySelector("main")` in `page.tsx` instead of a ref/context
solution, or the decision not to create the app's first `page.test.tsx`. If
something in the repo contradicts this plan (a file that doesn't exist, a
component whose shape has changed, a second `<main>` element), **stop and
surface the discrepancy** instead of working around it — §0 is exactly that
process applied during planning.

## Open questions / assumptions

1. **`MonoLink` without `href` renders an inert `<button>`, not plain text** —
   surfaced and resolved in §0 (`MonoLink.tsx:47-58`). Flagged here because the
   task brief assumed otherwise twice; the resolution (`LineRef` with a text
   fallback) is decided, not open. This is the second time in three plans that a
   snippet assumed a `MonoLink` shape it didn't have — see
   `client/insights.md:21`.
2. **The brief's React effect-ordering rationale for Fix 4 is inverted** —
   effects run child-first, so `DiffTab`'s poll effect runs *before*
   `page.tsx`'s `[tab]` effect, not after. Surfaced in constraint 9. The fix is
   unaffected: the poll is `setTimeout`-deferred, so its scroll lands after the
   synchronous reset either way. Resolved, not open.
3. **`"1 callers"` is grammatically wrong and stays that way** — `callerCount`
   is a plain interpolation, not an ICU plural, and pluralizing it is explicitly
   out of scope. If it is later fixed, `messages/en/blast.json:14` and nothing
   else changes.
4. **`document.querySelector("main")` assumes exactly one `<main>` app-wide** —
   verified true today (constraint 7, one hit). If a second `<main>` is ever
   added (a nested layout, a portal, a new shell), Fix 4 silently scrolls the
   wrong container. Recorded as a known, accepted fragility, not a defect.
5. **The `[tab]` scroll-reset effect has no automated test** — constraint 14 /
   §4: `client/` has no page-level test harness at all, and creating one for a
   three-line effect is out of proportion. Covered by Verification step 4. If a
   `page.test.tsx` is ever introduced for another reason, `Element.prototype.
   scrollTo` will need a jsdom stub, the way `DiffTab.test.tsx:24-26` already
   stubs `scrollIntoView`.
6. **`BlastTab.tsx`'s remaining consumers of `diffFilePaths`/`onJumpToFile` are
   assumed to be only `FileGroup` (header) and `EndpointRow`** — verified by
   reading the file at HEAD. Grep before trimming `SymbolRow`'s props; if a
   third reader has appeared, stop and surface it.
