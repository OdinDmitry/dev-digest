# server/ — engineering insights

Covers `server/` including its `repo-intel` submodule (`src/modules/repo-intel/`)
— that submodule has no insights file of its own.

Append-only. Newest entry on top within each section. Never edit or delete
existing entries. Promote anything that becomes a standing rule into
[CLAUDE.md](CLAUDE.md) instead of leaving it here.

Entry test: if it'd be obvious to anyone reading the code, don't write it.
Each entry must be specific enough that a cold agent knows exactly what to
do without re-investigating.

## What Works

## What Doesn't Work

## Codebase Patterns

- **`src/modules/pulls/status.ts` already had `rollupSeverities`/`SeverityCounts` — pre-built, unit-tested, and unused** — while wiring `findings_by_severity` into `GET /repos/:id/pulls` for the severity-counters feature, found this exact pure tally function (CRITICAL/WARNING/SUGGESTION counts, ignoring unknown severities) already sitting in `status.ts` with its own passing tests in `pulls-status.test.ts`, despite the route itself carrying a comment that severity breakdown was "intentionally not surfaced." It predates any caller — a course-scaffold stub for a not-yet-built lesson exercise. Before writing new severity/rollup logic anywhere in the `pulls` module, check `status.ts` first; it's very likely already there and tested.

## Tool & Library Notes

- **`GET /repos/:id/pulls` and `GET /pulls/:id` do a LIVE synchronous GitHub API round-trip on every request** (via octokit, when a token is configured) — even for a repo whose token is expired/invalid or whose GitHub-side name doesn't exist (e.g. a seeded demo repo like `acme/payments-api`), the route still fires the real network call, gets a 404/403, and octokit's retry plugin adds further delay before falling back to persisted rows ("never fail the read" try/catch). Observed this taking 1-2s+ per request in local dev — sometimes much longer under GitHub secondary rate-limiting backoff — versus the near-instant `<10ms` of every other route. Not caused by any specific feature; it's an inherent cost of the always-try-to-sync design. If a page looks stuck on "Loading…" with no client console error, check the API's own request-completed timing in its logs before suspecting the frontend.
- **Zod `.default()` makes the field required in `z.infer`'s output type, not optional** — it only fills the value at actual `.parse()` time, but any code that builds a plain object literal typed against the inferred TS type (without going through `.parse()`) must supply the field, or TS errors. Bit us on `PrMeta.cost_usd`: since `PrDetail = PrMeta.extend({...})` (`src/vendor/shared/contracts/platform.ts`), switching it from `.nullish()` to `.nullable().default(null)` broke typecheck in `src/adapters/github/octokit.ts`, `src/adapters/mocks.ts`, and the DB-fallback path in `src/modules/pulls/routes.ts` — none of which construct `PrMeta`/`PrDetail` via `.parse()`, they return literals. Fix was to keep `PrMeta.cost_usd` as `.nullish()` (matches the existing `score` field) and reserve `.nullable().default(null)` for schemas that are actually re-parsed at read time (see Recurring Errors & Fixes below). Before adding `.default()` to any shared zod field, check whether the schema (or anything `.extend()`-ing it) is also used as a bare TS type for literals built outside `.parse()`.

## Recurring Errors & Fixes

- **`RunStats.cost_usd` needed `.nullable().default(null)`, not plain `.nullable()`** — `run_traces.trace` (`src/db/schema/runs.ts`) is a JSONB document persisted ONCE at run completion, so rows written before `cost_usd` existed literally lack the key (absent, not `null`). `RunTrace.parse()` on a legacy trace throws with `.nullable()` alone; `.nullable().default(null)` resolves a missing key to `null` instead. Applies to any field added later to `RunStats`/`RunSummary` (`src/vendor/shared/contracts/trace.ts`) that gets read back from a previously-persisted trace — use `.default()` there, not on `PrMeta`-like schemas that are recomputed fresh per request (see Tool & Library Notes above for why those differ).
- **After a schema revert, the live DB can still have the column** — `pnpm db:migrate` isn't undone by reverting `src/db/schema/*.ts` (e.g. via a branch switch or manual file transfer). Confirmed directly: `agent_runs.cost_usd` still existed in the running Postgres container (`docker exec devdigest-postgres psql -U devdigest -d devdigest -c '\d agent_runs'`, credentials from `docker exec devdigest-postgres env | grep POSTGRES`) even after `schema/runs.ts` on disk had no `costUsd` field. Drizzle doesn't complain about an unknown extra DB column, and `drizzle-kit generate` won't propose dropping it unless the migration snapshot metadata (`db/migrations/meta/`) also reflects the revert — check `\d <table>` directly if something seems off after a branch switch/rebase, don't trust `schema.ts` alone.
- **`db/migrate.ts`/`db/seed.ts` CLI-entrypoint check regresses easily to a Windows-broken form** — the correct check is `if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)` (commit `1361d98 fix(dev): fix Windows-broken db scripts`). If it ever reads `if (import.meta.url === \`file://${process.argv[1]}\`)` instead, `pnpm db:migrate`/`pnpm db:seed` silently no-op when run directly on Windows (backslashes + drive letter don't match a `file://` template literal). Seen reappear after a manual cross-branch file transfer that had nothing to do with these files — worth diffing both against HEAD specifically after any manual (non-git-native) file transfer on this repo.

## Session Notes
<!-- written by a separate end-of-session wrap-up flow, not this skill -->

## Open Questions
