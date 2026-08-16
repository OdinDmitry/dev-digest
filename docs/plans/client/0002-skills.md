# 0002 — Skills (client)

## Why

The Skills library needed a studio UI: a place to author/import reusable
prompt rules, attach them to agents in order, and — once mockups arrived for
the detail screen — a proper Config/Preview/Versions editor matching the
agent editor's layout, with line numbers in the body editor and a real
version-history-with-diff-and-restore view. Paired with [server spec
0002](../server/0002-skills.md) for the CRUD/import/versioning API
this UI drives.

This shipped in two passes: a first cut (grid of cards + a side preview pane,
create/import flows, the agent-editor Skills tab with drag-reorder) and a
redesign once mockups landed for the rail+tabs detail screen. This spec
covers the shipped end state, not the intermediate grid layout.

## What we decided

### Layout: rail + tabbed detail, mirroring the agent editor

`/skills` is a fixed 280px left rail (search + skill list) and a right detail
pane — the same skeleton as `client/src/app/agents/[id]/page.tsx`. `?id=`
holds the selection, `?tab=` the active detail tab
(`config | preview | versions`); one `navigate({id?, tab?})` helper in
`SkillsView` owns both params, so switching skill preserves the current tab.
Filtering never clears the selection, and nothing auto-selects the first
skill on load — an unselected-but-non-empty library shows a "pick a skill"
prompt using **pre-existing, previously-dead** i18n keys
(`page.selectPrompt.*`) that were already sitting in `skills.json` unused.

### Components

- `SkillListItem` (renamed from the grid-era `SkillCard`, `git mv`'d so
  history follows) — one rail row: sparkles icon, mono name, a library-level
  enabled `Toggle`, a 2-line description clamp, the type chip, a NEW source
  chip (icon+label pair — `manual→Edit`, `extracted→Wrench`,
  `community→Globe`, `imported_url→Link`), and a "N agents" footer from
  `GET /skills/stats`. The footer is gated on `!= null`, never `?? 0` — an
  in-flight stats request must not render a confident "0 agents".
- `SkillDetail` — header (icon + mono name + type chip + `vN` badge) + the
  three tabs, replacing the old `SkillPreviewPane` (deleted).
  - `ConfigTab` — a live form, no separate view/edit mode: name, description,
    type, then the body as `SkillBodyEditor`, an optional "what changed?"
    note field (shown **only while the body is dirty** — matches the
    server's silent-drop-on-non-body-save rule, so the UI never implies a
    note will be saved when it won't), the enabled toggle, evidence files,
    delete.
  - `PreviewTab` — the body rendered as markdown exactly as the agent
    receives it, in a bordered card.
  - `VersionsTab` — newest-first rows (note, or a computed `+added −removed
    lines` fallback, or "Initial version" for a note-less v1); the newest row
    gets a green `Current` pill; every other row gets `Restore`, and `Diff`
    **only when it has an older neighbour** (the oldest row has nothing to
    diff against — no fake "version 0"). `from`/`to` for a diff are always
    the two adjacent elements of the already-fetched desc-ordered list, never
    computed as `version - 1` (restore can make the sequence non-contiguous).

### `SkillBodyEditor` — line numbers, no syntax highlighting

A deliberate scope cut: numbers only, no highlighter, no new dependency. Built
as a raw `<textarea>` (not the kit's `Textarea`, which has no `style`/`ref`/
`onScroll` escape hatch) paired with a scroll-synced gutter `<div>`. The two
MUST share one `EDITOR_TEXT` style object, and `lineHeight` must be a **pixel
value** (`"20px"`), never a unitless multiplier — a unitless value rounds
independently for a block's line boxes vs. a textarea's, drifting visibly by
around line 40. `wrap="off"` + `white-space: pre` keeps one logical line ≡ one
visual row by construction, so the gutter is correct with zero measurement;
the cost is a horizontal scrollbar on long lines, accepted since skill bodies
are hand-wrapped markdown. A `File`-icon strip above it shows the filename
(`<name>.md`), an `unsaved` chip while the body is dirty, and a token count
via the existing `approxTokens` heuristic (advisory only, not billing).

### Version diff: a real line diff, reusing the diff-viewer's row rendering

`client/src/lib/diff-lines.ts` — a pure LCS-with-backtracking implementation
(prefix/suffix stripping, a capped `Int32Array` DP, `del` emitted before `add`
on a tie so a pure replacement reads as unified-diff convention expects).
`VersionDiffModal` renders its output through `lineRowFor`/`lineSignFor`,
newly exported from `components/diff-viewer`'s barrel (previously only
`DiffViewer` itself was public) — reused rather than copied, since their
whole value is that every add/del row in the app looks identical, and a copy
would only ever drift. `CodeLine` itself stays un-exported; it's coupled to
inline-comment machinery this modal doesn't want.

The server has its own line-count-only `lineDelta` (no backtracking, so no
full matrix) for the Versions-tab row summaries — deliberately duplicated,
not shared, and safe to duplicate: the LCS **length** is unique even when the
LCS **path** is not, so the two implementations can never disagree on the
counts no matter how each ties-break.

### Markdown actually renders styled, everywhere

`Markdown.tsx`'s `className="dd-md"` wrapper had no matching CSS rule
anywhere — combined with Tailwind Preflight and this app's own
`h1,h2,h3,h4,p{margin:0}` reset, every rendered skill body (and every other
`<Markdown>` consumer) showed `## Heading` and `- item` as flat, unstyled
body text. Fixed once, app-wide, with a `.dd-md` block in
`vendor/ui/styles.css` that re-establishes heading sizes/weights/margins and
list markers/indentation, plus `li>p{margin:0}` (react-markdown wraps loose
list items in `<p>`, which would otherwise inherit `Markdown.tsx`'s own `p`
override and blow list spacing apart).

### New hooks (`lib/hooks/skills.ts`)

`useSkillStats`, `useSkillVersions`, `useSkillVersion(skillId, version)`,
`useRestoreSkillVersion` — plus `UpdateSkillInput.patch` widened with an
optional `note`. `useSkill(id)` (single-skill fetch) is intentionally left
**unused**: `useSkills()` already returns full bodies, so wiring it in would
double requests for data already in hand.

## Out of scope

- Evals/Stats tabs and a "Run on evals" button — not built; the detail pane
  is exactly `Config | Preview | Versions`.
- Per-skill pull/accept percentages on the rail footer — only "N agents"
  (see server spec's Out of scope for why the other two aren't derivable).
- Real syntax highlighting, a CodeMirror/Monaco dependency, pixel-perfect
  scroll-sync testing (jsdom has no layout — tests assert the handler is
  wired, not that scrolling visually lines up).

## Once shipped

Implemented, tested (`SkillsView.test.tsx`, `SkillBodyEditor.test.tsx`,
`VersionsTab.test.tsx`, `diff-lines.test.ts`, `drag-list.test.ts`) and
click-verified live against the running app (create → edit → save → v2 with
note → Diff shows correct +/− lines → Restore appends v4, history intact).
Fold the still-true parts into `client/CLAUDE.md` (`Where things live`) when
convenient; this spec is being kept rather than deleted per explicit request,
as the record of what was decided and why.
