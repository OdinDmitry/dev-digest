# client/ — engineering insights

Append-only. Newest entry on top within each section. Never edit or delete
existing entries. Promote anything that becomes a standing rule into
[CLAUDE.md](CLAUDE.md) instead of leaving it here.

Entry test: if it'd be obvious to anyone reading the code, don't write it.
Each entry must be specific enough that a cold agent knows exactly what to
do without re-investigating.

## What Works

## What Doesn't Work

- **`?? 0` before summing two nullable numeric inputs hides "missing" as "zero"** — `RunCostBadge`'s detailed variant (`src/components/run-cost/RunCostBadge.tsx`) computed `(tokensIn ?? 0) + (tokensOut ?? 0)` and displayed "0 tok" for runs with no recorded token data, indistinguishable from a run that genuinely used zero tokens. Fix: check both inputs for `null`/`undefined` explicitly (`tokensIn != null && tokensOut != null ? tokensIn + tokensOut : null`) and render a placeholder (`"—"`) when either is absent, rather than defaulting to 0 before the null-check. Applies to any display code combining nullable numeric fields — `?? 0` is fine for arithmetic accumulators that get used further, wrong for anything rendered straight to the user.

## Codebase Patterns

- **A component shared between the PR-list route and the PR-detail (`[number]`) route lives under `pulls/_components/`, not `@devdigest/ui`** — `SeverityCounts` (severity readout used by both `PRRow` in the list and `RunHistory`/`FindingsTab` on the detail page) is colocated at `pulls/_components/SeverityCounts/`, imported from the detail side via a relative path up through `[number]/_components/` (e.g. `../../../_components/SeverityCounts` from `pulls/[number]/_components/RunHistory/`). Kept out of `@devdigest/ui` deliberately since it's specific to the findings/severity domain, not a generic UI primitive — promote it there only if a third, unrelated consumer shows up.
- **A TanStack Query hook can be made "fetch only while hovered" by adding an `{ enabled }` option, reusing the SAME hook/endpoint another page already calls** — `usePrReviews(prId, { enabled })` (`src/lib/hooks/reviews.ts`) is the same hook the PR-detail page already uses for its full findings list; `PRRow` on the PR-list page calls it too, gated on `enabled: popupHover`, to lazily fetch one row's findings only when its FINDINGS-column popup is actually hovered — no separate lazy-fetch hook needed, and react-query's cache makes re-hovering the same row instant after the first fetch.

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes
<!-- written by a separate end-of-session wrap-up flow, not this skill -->

## Open Questions
