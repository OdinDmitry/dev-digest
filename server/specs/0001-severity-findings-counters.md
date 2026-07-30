# 0001 — Severity findings counters + click-to-filter (server)

## Why

The client needs a per-severity findings breakdown (CRITICAL/WARNING/
SUGGESTION counts) in two places — see [client spec
0001](../../client/specs/0001-severity-findings-counters.md) for the full
UI picture. Of the two, only the **PR list** needs a server change.

`GET /repos/:id/pulls` currently has this explicit comment
(`src/modules/pulls/routes.ts:114-117`):

> Latest-review SCORE per PR for the list's score ring. Computed on read
> from reviews (no FK denorm); the list is small, so one IN-query + JS
> grouping is cheap. (The per-severity FINDINGS breakdown is intentionally
> not surfaced on the list — findings live on the PR detail page.)

This spec **reverses that decision**: the list now needs the breakdown too,
for the new FINDINGS column.

The PR-detail aggregate counter does **not** need a new endpoint —
`GET /pulls/:id`'s reviews (via `usePrReviews` → `ReviewRecord.findings`)
already ship full `FindingRecord[]` per run, `severity` included, so the
client computes that counter itself.

Both hover popups (PR-list row, PR-detail timeline row) also need **no new
endpoint**: `GET /pulls/:id/reviews` (already backing `usePrReviews`)
already returns full finding detail (title, file, line, confidence,
severity, rationale). The PR-list popup calls this same endpoint lazily,
on hover, for the one PR row being hovered — not a bulk addition to the
list response. `findings_by_severity` below stays **counts-only**; it feeds
the badge/number, not the popup.

## What we decided

### `PrMeta` gets a new field

Add to `PrMeta` (`contracts/platform.ts`), computed the same way and in the
same place as `score`/`cost_usd` — from the **latest `kind: 'review'`
review** for the PR, not summed across every historical run:

```ts
findings_by_severity: z.object({
  critical: z.number().int(),
  warning: z.number().int(),
  suggestion: z.number().int(),
}).nullish(), // absent/null until the PR has a review, same as score
```

Dismissed findings (`dismissed_at` set) are excluded from every count —
mirrors the existing `blockers` computation used elsewhere for CRITICAL.

### Route change

`src/modules/pulls/routes.ts`, `GET /repos/:id/pulls` handler: the existing
IN-query building `latestReviewByPr` (lines ~120-133) already joins
`reviews`; extend it to also pull that review's findings (join
`findings`/whatever table backs `FindingRecord`, filtered to
`dismissed_at IS NULL`) and group-count by `severity` in the same JS pass
that currently just tracks first-seen-per-PR. Store the triplet in
`latestReviewByPr` alongside `score`/`costUsd`, then surface it on the
returned `PrMeta` objects.

Keep this within the same "list is small, one IN-query + JS grouping is
cheap" performance envelope already accepted for `score`/`cost_usd` — no new
endpoint, no N+1 per-PR queries.

### `RunSummary` — per-run breakdown (PR detail timeline row)

`RunSummary` (`contracts/trace.ts`) already carries `findings_count` and
`blockers` (blockers = undismissed CRITICAL). Add the remaining two buckets
for symmetry with the client's `SeverityCounts` component:

```ts
warning_count: z.number().int().nullable(),
suggestion_count: z.number().int().nullable(),
```

`blockers` is kept as-is and reused directly as the CRITICAL count (no
renamed/duplicate field) — the client's `SeverityCounts` component just
reads `{ critical: blockers, warning: warning_count, suggestion:
suggestion_count }`. Wherever the run-row denormalized counts are currently
written at run completion (the code path that sets `findings_count`/
`blockers` on the `agent_runs` row — confirm exact file during
implementation, likely `server/src/modules/reviews/repository/review.repo.ts`
or the run-executor's completion step) gets extended to also compute and
persist `warning_count`/`suggestion_count` the same way `blockers` is
computed today (undismissed findings of that severity).

### Vendored contracts

`platform.ts` and `trace.ts` must be edited identically in **both**
`client/src/vendor/shared/contracts/` and `server/src/vendor/shared/contracts/`
— they're copied, not npm-linked (root `CLAUDE.md`).

### Migration

`warning_count`/`suggestion_count` are new nullable integer columns on the
`agent_runs` (or wherever `blockers`/`findings_count` are stored) table —
straightforward additive migration via `pnpm db:generate` +
`pnpm db:migrate`, backfilled as `null` for historical rows (matches how
`cost_usd` handled its own backfill-null case per
`trace.ts`'s existing comment on `RunStats.cost_usd`).

## Out of scope

- No change to `GET /pulls/:id` (PR detail) — the aggregate counter there is
  client-computed from already-shipped review data.
- No new endpoints.
- No change to the `Severity` enum itself (`findings.ts`) — already exactly
  `CRITICAL | WARNING | SUGGESTION`.

## Once shipped

Fold the still-true parts into `server/CLAUDE.md` (`Where things live`) and
delete this file.
