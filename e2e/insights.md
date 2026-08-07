# e2e/ — engineering insights

Append-only. Newest entry on top within each section. Never edit or delete
existing entries. Promote anything that becomes a standing rule into
[CLAUDE.md](CLAUDE.md) instead of leaving it here.

Entry test: if it'd be obvious to anyone reading the code, don't write it.
Each entry must be specific enough that a cold agent knows exactly what to
do without re-investigating.

## What Works

- _2026-08-07_ — **`run.ts` now resolves the native `agent-browser` executable itself, so the Windows `AGENT_BROWSER_BIN` workaround below (2026-08-05) is no longer needed** — `resolveBin()` returns `AGENT_BROWSER_BIN` when set, the plain name on POSIX (unchanged), and on win32 walks `PATH` for a real `agent-browser.exe` first, then falls back to reading npm's generated `agent-browser.cmd` shim and extracting the `.exe` path out of its `"%~dp0…" %*` line. `execFile` then spawns that binary directly. Deliberately NOT `shell: true`: that also fixes the spawn, but concatenates argv unescaped (Node `DEP0190`), and flow steps pass arbitrary text (`find text …`, assertion strings) that contains spaces and quotes — so it would have traded a hard failure for silent mis-parsing of specific steps. When nothing resolves, it returns the plain name so the failure stays the familiar "is agent-browser installed?" `ENOENT`. Verified with a full `./scripts/e2e.sh`: 9/9 flows green on Windows, first time the suite has run here.

## What Doesn't Work

## Codebase Patterns

## Tool & Library Notes

- _2026-08-05_ — **A globally `npm i -g agent-browser`-installed CLI cannot be spawned by name on Windows via `run.ts`'s `execFile` — neither the extensionless shim nor the `.cmd` shim works, only the native `.exe` does** — `npm`'s Windows global-bin install produces THREE files (`agent-browser` bare — a POSIX shell script, useless to `CreateProcess`, → `spawn ... ENOENT`; `agent-browser.cmd` — a batch shim `%~dp0node_modules\agent-browser\bin\agent-browser-win32-x64.exe %*`, which Node's `execFile`/`spawn` refuses to run without `shell: true` since the Node CVE-2024-27980 fix, → `spawn EINVAL`; `agent-browser.ps1`, not directly executable either). The actual native binary is one directory deeper: `<npm prefix>/node_modules/agent-browser/bin/agent-browser-win32-x64.exe` — point `run.ts`'s `AGENT_BROWSER_BIN` env var directly at that `.exe` (e.g. `AGENT_BROWSER_BIN="$(npm config get prefix)/node_modules/agent-browser/bin/agent-browser-win32-x64.exe" ./scripts/e2e.sh`) and it runs with no further changes. `npm config get prefix` gives the install root (`node_modules/agent-browser/bin/` under it).

## Recurring Errors & Fixes

- _2026-08-05_ — **A `find text ... click` on the PR-list row with no preceding `wait --text` for that same text is an intermittent race, not a reliable click** — `GET /repos/:id/pulls` does a live synchronous GitHub round-trip per request (documented in `server/insights.md`, sometimes 1-2s+), so the row's title may not be in the DOM yet the instant `find` runs, even though the URL has already changed to `/pulls`. `02-repo-pulls-detail.flow.json` already had a `wait --text "Add rate limiting to public API endpoints"` step before its click and never failed; `04-pr-findings.flow.json` and `05-pr-diff.flow.json` were missing it and failed intermittently (confirmed: fixing one exposed the same latent race in the other on the very next run, then both stabilized once fixed) — 3 consecutive full runs green after adding the wait to all three PR-list-opening flows. Any NEW flow that opens a PR from `/pulls` must `wait --text <PR title>` immediately before the `find ... click`, never click right after `wait --url /pulls`.
- _2026-08-05_ — **Opening a Skill card lands on its Config tab (name/description/type), not Preview — the skill's `body` markdown only renders after an explicit tab switch** — `08-skills.flow.json` expected `body` text ("Enumerate a branch for each of", from `TEST_COVERAGE_RUBRIC.body` in `server/src/db/seed-skills.ts`) to appear right after clicking the skill card, but that text lives in the `PreviewTab`, and `SkillDetail.tsx` defaults to the `config` tab. Fixed by adding `["find", "role", "button", "click", "--name", "Preview"]` before the `wait --text` assertion, same "Tabs kit renders plain buttons, not role=tab" pattern already used for the Agents-editor Skills tab in `09-agent-skills.flow.json`. Any flow asserting on a skill's `body` (as opposed to its `description`, which IS visible on Config) needs this same tab switch.

## Session Notes
<!-- written by a separate end-of-session wrap-up flow, not this skill -->

## Open Questions
