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

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes
<!-- written by a separate end-of-session wrap-up flow, not this skill -->

## Open Questions
