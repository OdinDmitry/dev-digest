# 0001 — Severity findings counters + click-to-filter (client)

## Why

Two places on the PR pages currently show findings only as a flat count
("6 findings" / a tab badge), with no breakdown by severity and no way to
narrow the view to just the findings that matter right now. The ask: show a
severity breakdown — "3 CRITICAL · 5 WARNING · 2 SUGGESTION" — in both
places, and let clicking a severity filter the findings shown to just that
level.

Investigation confirmed neither surface exists in any form today:
- `PRRow.tsx` renders 7 columns (pullRequest, author, size, score, status,
  cost, updated) — no findings column at all.
- `RunHistory.tsx` (PR detail → Agent runs timeline) shows one plain text
  line per run ("N findings · N blockers") — no per-severity breakdown.

This is a from-scratch build, paired with [server spec
0001](../server/0001-severity-findings-counters.md) for the one
place the client needs new API data (the PR list).

## What we decided

### Where the counters live

1. **PR list** (`/repos/:repoId/pulls`) — a new **FINDINGS** column, one
   severity-counts readout per row, between SCORE and STATUS (matches the
   mockup's column order).
2. **PR detail** (`/repos/:repoId/pulls/:number`, "Agent runs" tab) —
   two counters:
   - Per-run: a severity-counts readout on each `RunHistory` timeline row
     (that run's findings only).
   - Page-level aggregate: one counter above "Review runs"
     (`FindingsTab.tsx`) that reflects the whole PR and, on click, filters
     every open `ReviewRunAccordion`/`FindingsPanel` at once.

### Data scope (what counts as "the" counters)

- **PR list & PR-detail aggregate**: scoped to the **latest review only**
  (same "latest review" semantics `score`/`cost_usd` already use — see
  server spec). Not a sum across every historical run: re-running an agent
  would otherwise double-count the same still-open issue.
- **Per-run row** (timeline): always that single run's own findings — no
  scope question, the data's already on `RunSummary`.
- **Dismissed findings are excluded** from every counter, mirroring the
  existing `blockers` computation (`ReviewRunAccordion.tsx:56`,
  `!f.dismissed_at`).

### Filter interaction

- **Single-select toggle**: clicking a severity shows only that severity;
  clicking the same severity again clears the filter back to "all". No
  multi-select.
- PR list: filters which PR *rows* remain visible (a row's badge reflects
  its latest review; filtering by e.g. CRITICAL hides PRs whose latest
  review has zero CRITICAL findings).
- PR detail aggregate: filters findings **inside every accordion** — doesn't
  hide runs, just narrows each run's `FindingsPanel` to the selected
  severity (a run with none of that severity shows its own empty state).
- Per-run row counters (timeline) are **display-only**, not click targets —
  clicking a severity there would be ambiguous (filter just that run's panel
  below, or the page aggregate?). Only the page-level aggregate counter and
  the PR-list column are clickable.

### Components

- One small reusable presentational component, `SeverityCounts` (icons +
  counts; severity → icon/color mapping already exists implicitly via
  `VERDICT_COLOR`-style token usage — reuse `var(--crit)`/`var(--warn)`/
  existing suggestion token, don't invent new colors). Takes counts +
  optional `selected`/`onSelect` for the clickable variant, optional hover
  popover slot.
- Colocated under `client/src/app/repos/[repoId]/pulls/_components/` (list)
  with the pr-detail usage importing it via a relative path — not promoted
  to `@devdigest/ui`, since it's specific to this findings/severity domain,
  not a generic UI primitive.
- PR list: wire into `PRRow.tsx` + `constants.ts` (`GRID`, `COLUMN_KEYS`) +
  `prReview.json` i18n key `list.columns.findings`. Filter state lives in
  the list page (`page.tsx`), alongside the existing status-filter chips.
  `PRRow` also owns the popup's hover state and calls
  `usePrReviews(pr.id, { enabled: hovered })` (see Hover popup below) to
  lazily fetch that row's findings only while hovered.
- PR detail: wire into `RunHistory.tsx` (per-run, display-only) and
  `FindingsTab.tsx` (aggregate + filter). Filter state (`selectedSeverity`)
  lives in `FindingsTab`, threaded down into `FindingsPanel` as a new prop;
  `FindingsPanel/helpers.ts`'s `visibleFindings()` gets a `severity` filter
  parameter alongside its existing `hideLow` one. `FindingsTab` also passes
  each run's matched `ReviewRecord.findings` (by `run_id`) down into
  `RunHistory` so its per-row popup has data without a new fetch.

### Hover popup

Both the PR-list FINDINGS cell and the per-run timeline row get a hover
popup listing the actual findings (title, file:line, confidence, category
badge, first line of rationale — matching the mockup). The page-level
aggregate counter (`FindingsTab`) does not need its own popup — it only
needs to be clickable, and its underlying findings are already fully
visible in the accordions below it.

**This is not free presentational sugar for the PR list** — `PrMeta.
findings_by_severity` is counts-only (see server spec), so the list's hover
popup cannot be built from data already on the row. Data source per
placement:

- **PR list row popup**: lazily fetched on hover, reusing the existing
  `GET /pulls/:id/reviews` endpoint/hook (`usePrReviews`, already used on
  the PR detail page) — not a new endpoint. `usePrReviews` gains an
  `{ enabled }` option so `PRRow` can call
  `usePrReviews(pr.id, { enabled: hovered })`: the query only fires once
  the row is actually hovered (small ~150ms debounce on the hover-start so a
  fast mouse pass over the table doesn't fire a fetch per row), and
  react-query's cache means re-hovering the same row after the first fetch
  is instant. Popup shows the **latest review's** findings — same scope as
  the badge itself, so the counts and the popup contents always agree.
- **Timeline per-run row popup**: no fetch needed at all — `FindingsTab`
  already holds `usePrReviews(prId)` for the whole PR (used today to build
  `allFindings`/`lethalTrifecta`). Match `ReviewRecord.run_id` to the
  `RunSummary.run_id` of the hovered timeline row and pass that review's
  `findings` into `RunHistory` as a prop; purely a wiring change, no new
  network call.

## Out of scope

- No changes to `FindingCard`, `VerdictBanner`, or the Overview tab.
- No multi-select, no persisting the filter choice (resets on navigation).
- No new `@devdigest/ui` primitive — stays a route-local component unless a
  third consumer shows up later.

## Once shipped

Fold the still-true parts into `client/CLAUDE.md` (`Where things live`) and
delete this file.
