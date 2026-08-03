---
name: engineering-insights
description: Reads and writes the current module's insights.md, the append-only log of non-obvious engineering discoveries. Read the relevant module's insights.md before starting work there or answering questions about it, so past learnings aren't rediscovered. Append new entries proactively during the session when you find a working fix, failed approach, codebase pattern, tool/library quirk, or recurring error+fix, plus one check at session end for anything substantial not yet logged. Do NOT log anything already recorded, anything obvious from the code, vague generalities, or force an entry when nothing substantial came up.
---

- Map the file/topic you're working on to its module (`client/`, `server/` —
  including its `repo-intel` submodule —, `reviewer-core/`, `e2e/`). Read
  that module's `insights.md` before making changes or answering questions
  about it.
- `insights.md` has fixed `##` sections — append under the exact matching
  existing header, never a new/renamed heading or loose text, after
  checking it isn't already covered there:
  - **What Works** — an approach or fix that was tried and succeeded
  - **What Doesn't Work** — an approach that was tried and failed, and why
  - **Codebase Patterns** — a project-specific convention or architectural
    decision, not obvious from reading the code alone
  - **Tool & Library Notes** — a quirk, limit, or gotcha in a dependency
  - **Recurring Errors & Fixes** — an error seen more than once, and its fix
  - **Open Questions** — something unresolved that needs future investigation
- Entry test: if it'd be obvious to anyone reading the code, don't write
  it. Name the concrete trigger, the concrete fix/decision, and why —
  enough for a cold agent to act without re-investigating.
  - ❌ Bad: "Promises can be tricky." — noise, not a lesson.
  - ✅ Good: "`Promise.all()` on the ingest pipeline times out after 30
    items — use `Promise.allSettled()` with batches of 10 for this module."
- Prefix every new entry with its date before the bold trigger phrase, in
  `YYYY-MM-DD` italics: `- _2026-08-03_ — **trigger phrase** — rest of
  entry.` Take the date from the current session context (today's date),
  never guess it from file mtimes or commit history.
- At session end, do one more pass: append anything substantial that
  surfaced and isn't yet logged; if nothing substantial came up, write
  nothing.
- Append-only: add new entries, never edit or rewrite existing ones. Skip
  `Session Notes` — that section belongs to a separate wrap-up flow.
