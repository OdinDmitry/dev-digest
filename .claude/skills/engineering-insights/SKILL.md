---
name: engineering-insights
description: Reads and writes the current module's insights.md, the append-only log of non-obvious engineering discoveries. Read the relevant module's insights.md before starting work there or answering questions about it, so past learnings aren't rediscovered. Append new entries proactively during the session when you find a working fix, failed approach, codebase pattern, tool/library quirk, or recurring error+fix, plus one check at session end for anything substantial not yet logged. Do NOT log anything already recorded, anything obvious from the code, vague generalities, or force an entry when nothing substantial came up.
---

# Engineering Insights

`insights.md` exists so a discovery is made once per module, not once per
agent. Every entry should save a future cold agent the re-investigation you
just did — that is the bar for whether something belongs here at all.

## Where to read and write

Map the file/topic you're working on to its module and read that module's
`insights.md` before making changes or answering questions about it:
`client/`, `server/` (including its `repo-intel` submodule), `reviewer-core/`,
`e2e/`, `mcp/`.

If a module has no `insights.md` yet, create it with this intro and the six
fixed headings below (plus an empty `## Session Notes`, owned by a separate
wrap-up flow — see Rules):

```markdown
# <module>/ — engineering insights

Append-only. Newest entry on top within each section. Never edit or delete
existing entries. Promote anything that becomes a standing rule into
`CLAUDE.md` instead of leaving it here.

Entry test: if it'd be obvious to anyone reading the code, don't write it.
Each entry must be specific enough that a cold agent knows exactly what to
do without re-investigating.
```

## Writing an entry

`insights.md` has fixed `##` sections — append under the exact matching
existing header, never a new/renamed heading or loose text, after checking
it isn't already covered there:

- **What Works** — an approach or fix that was tried and succeeded
- **What Doesn't Work** — an approach that was tried and failed, and why
- **Codebase Patterns** — a project-specific convention or architectural
  decision, not obvious from reading the code alone
- **Tool & Library Notes** — a quirk, limit, or gotcha in a dependency
- **Recurring Errors & Fixes** — an error seen more than once, and its fix
- **Open Questions** — something unresolved that needs future investigation

New entries go **at the top of their section**, not the bottom — the person
scanning this file wants the newest thinking first, and an old entry a new
one supersedes should read as history right below it, not buried under
everything that came after.

Entry test: if it'd be obvious to anyone reading the code, don't write it.
Name the concrete trigger, the concrete fix/decision, and why — enough for a
cold agent to act without re-investigating.

- ❌ Bad: "Promises can be tricky." — noise, not a lesson.
- ✅ Good: "`Promise.all()` on the ingest pipeline times out after 30
  items — use `Promise.allSettled()` with batches of 10 for this module."

Prefix every new entry with its date before the bold trigger phrase, in
`YYYY-MM-DD` italics: `- _2026-08-03_ — **trigger phrase** — rest of entry.`
Take the date from the current session context (today's date), never guess
it from file mtimes or commit history.

## When to append

Proactively during the session, the moment you have one: a working fix, a
failed approach, a codebase pattern, a tool/library quirk, or a recurring
error+fix. At session end, do one more pass — append anything substantial
that surfaced and isn't yet logged; if nothing substantial came up, write
nothing rather than padding the file to look thorough.

Do not log: anything already recorded here, anything obvious from reading
the code, vague generalities, or an entry forced when nothing substantial
actually came up.

## Rules

- **Append-only.** Add new entries, never edit or rewrite an existing one —
  even a superseded entry stays as a record of what was true before. When a
  new finding invalidates an old one, add a new entry that says so
  explicitly (e.g. "Superseded by `<reason>`: ..., the `<date>` entry above
  described the state before this fix") — never go back and edit the
  original entry to match.
- **Skip `Session Notes`.** That section belongs to a separate end-of-session
  wrap-up flow, not this skill.
- **Promote standing rules to `CLAUDE.md`.** If an entry stops being "a
  thing that was learned" and becomes "a thing everyone doing this kind of
  work must always do," it belongs in the module's `CLAUDE.md`, not buried
  in an append-only log nobody re-reads in full. Leaving it here only is how
  a real rule gets rediscovered the hard way next quarter.
