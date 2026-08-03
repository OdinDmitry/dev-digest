# client/ — engineering insights

Append-only. Newest entry on top within each section. Never edit or delete
existing entries. Promote anything that becomes a standing rule into
[CLAUDE.md](CLAUDE.md) instead of leaving it here.

Entry test: if it'd be obvious to anyone reading the code, don't write it.
Each entry must be specific enough that a cold agent knows exactly what to
do without re-investigating.

## What Works

## What Doesn't Work

- _2026-07-30_ — **Portaling a hover-popup to `<body>` (to escape an ancestor's `overflow: hidden`) breaks the usual "parent `onMouseEnter`/`onMouseLeave`" hover pattern** — once the popup is `createPortal`'d out to `document.body`, it's no longer a DOM descendant of the trigger, so an instant `setHovering(false)` on the trigger's `onMouseLeave` unmounts the popup before the mouse has actually reached it (the browser's leave-before-enter event ordering means the popup can vanish mid-transition, with no element left to catch its `mouseenter`). Adding matching `onMouseEnter`/`onMouseLeave` to the popup itself is necessary but NOT sufficient. Fix: debounce the close (`setTimeout(~120ms)` in the leave handler) and cancel it from either element's `onMouseEnter` — see `SeverityCounts.tsx`. Any future portaled hover-UI in this app needs the same debounce, not just mirrored handlers.
- _2026-07-30_ — **When a server aggregation's SEMANTICS change, grep the client for every independent re-derivation of the same metric** — changed the PR-list route's findings/cost aggregation from "latest review overall" to "latest review per agent, summed" (see server `insights.md`), but two client-side spots independently re-derived "the findings for this PR" from raw review data: `PRRow`'s hover-popup content and `FindingsTab`'s page-level aggregate counter. Both still used the OLD single-latest-review logic, so the popup showed "No findings" while the (now-correct) badge count showed real numbers — a real user-visible bug from touching only the server side of a semantic change. Fixed by extracting one shared `latestReviewPerAgent()` helper (`pulls/helpers.ts`) and using it in both places instead of leaving each to reimplement the same "which review(s) count" logic.
- _2026-07-30_ — **`?? 0` before summing two nullable numeric inputs hides "missing" as "zero"** — `RunCostBadge`'s detailed variant (`src/components/run-cost/RunCostBadge.tsx`) computed `(tokensIn ?? 0) + (tokensOut ?? 0)` and displayed "0 tok" for runs with no recorded token data, indistinguishable from a run that genuinely used zero tokens. Fix: check both inputs for `null`/`undefined` explicitly (`tokensIn != null && tokensOut != null ? tokensIn + tokensOut : null`) and render a placeholder (`"—"`) when either is absent, rather than defaulting to 0 before the null-check. Applies to any display code combining nullable numeric fields — `?? 0` is fine for arithmetic accumulators that get used further, wrong for anything rendered straight to the user.

## Codebase Patterns

- _2026-07-30_ — **A component shared between the PR-list route and the PR-detail (`[number]`) route lives under `pulls/_components/`, not `@devdigest/ui`** — `SeverityCounts` (severity readout used by both `PRRow` in the list and `RunHistory`/`FindingsTab` on the detail page) is colocated at `pulls/_components/SeverityCounts/`, imported from the detail side via a relative path up through `[number]/_components/` (e.g. `../../../_components/SeverityCounts` from `pulls/[number]/_components/RunHistory/`). Kept out of `@devdigest/ui` deliberately since it's specific to the findings/severity domain, not a generic UI primitive — promote it there only if a third, unrelated consumer shows up.
- _2026-07-30_ — **A TanStack Query hook can be made "fetch only while hovered" by adding an `{ enabled }` option, reusing the SAME hook/endpoint another page already calls** — `usePrReviews(prId, { enabled })` (`src/lib/hooks/reviews.ts`) is the same hook the PR-detail page already uses for its full findings list; `PRRow` on the PR-list page calls it too, gated on `enabled: popupHover`, to lazily fetch one row's findings only when its FINDINGS-column popup is actually hovered — no separate lazy-fetch hook needed, and react-query's cache makes re-hovering the same row instant after the first fetch.

## Tool & Library Notes

- _2026-07-30_ — **Setting only `overflowY: "auto"` on a fixed-width box lets unbreakable text force a horizontal scrollbar** — per the CSS overflow spec, when one axis is set to something other than `visible` and the other is left at the default `visible`, the `visible` one computes to `auto` too. `SeverityCounts`' popup (`overflowY: "auto"`, `maxWidth: 360`, no explicit `overflowX`) grew a horizontal scrollbar whenever a finding's file path (no spaces to wrap on) was long. Fix: set `overflowX: "hidden"` explicitly as a hard backstop, AND add `overflowWrap: "anywhere"` / `wordBreak: "break-word"` / `flexWrap: "wrap"` to the row holding the path so it actually wraps instead of being invisibly clipped. Overflow-hidden alone would silently cut the text off — both halves of the fix are needed.

## Recurring Errors & Fixes

## Session Notes
<!-- written by a separate end-of-session wrap-up flow, not this skill -->

## Open Questions
