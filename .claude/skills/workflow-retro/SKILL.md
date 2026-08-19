---
name: workflow-retro
description: Produces a grounded retrospective of a multi-agent run — how many agents ran and in what order, the token split per agent, which files they duplicated, what they re-worked, and what the orchestration cost. Manual trigger only — never run this automatically at the end of a workflow; the user runs it by name when they want one. Default mode reads only what is already in the conversation (in-context); pass `deep` to also read every subagent's transcript from disk, needed because a subagent's own completion report does not include what its nested subagents cost. Output is a chat report plus one appended row in the shared `docs/retro/ledger.md` — never a new file per run, never a module's `insights.md`.
---

A workflow retro answers one question: **what would we change about the agent
chain before running it again?** Everything here exists to make that answer
falsifiable. A retro that says "the run went well, agents collaborated
effectively" is worse than no retro — it costs tokens and teaches nothing.

This is the meta level: how the *workflow* performed. Discoveries about the
*code* belong in a module's `insights.md` and are owned by the
`engineering-insights` skill. Never write to `insights.md` from here.

**Trigger.** Manual only. Nothing in this repo invokes this skill
automatically — no hook, no step in `/impl`, no agent definition calls it.
Run it because the user asked for a retro of the workflow that just finished,
never as a step you chain onto the end of one on your own initiative.

## Step 1 — pick a mode

- **Quick (default, no argument).** Use only what is already in this
  conversation: each `Agent` tool call's own completion report
  (`subagent_tokens`, description, whether it ran in background), and what you
  personally observed — launch order, blocking questions returned, user
  round-trips. No script runs, nothing is read from disk. This is a fast gut
  check: token totals, agent count, and launch order are solid, because the
  Agent tool reports them directly. Duplicated context, re-work, and the
  per-agent cache-write/cache-read shape are **not available** in this mode —
  they live inside each subagent's own tool-call log, which never enters the
  parent's context. Say so in the report rather than guessing.
- **Deep (invoke with `deep`).** Everything quick mode gives you, plus a
  script pass over every subagent's raw transcript on disk. Use it whenever
  the numbers need to be trustworthy, and always when the workflow nested
  subagents inside subagents — `subagent_tokens` on an `Agent` completion is
  that agent's own claim about itself, and it does not decompose into the
  four-way input/output/cache split, and it does not include what that
  agent's own child spawns cost. Only a transcript read on disk sees those.

The rest of this document is written for deep mode; where a step needs the
script, that is called out. In quick mode, skip straight to the parts of Step
6 you can support from context, then write the ledger row with the
unavailable fields marked as such — do not leave them blank without saying
why.

## Step 2 (deep mode) — get the telemetry, and never read a raw transcript

Agent transcripts are enormous: one `spec-creator` run in this repo measured
1.5 MB across 86 JSONL lines. Reading one into context to "see how it went"
costs more than the run you are analysing, and pushes out the context you need
to think. So the numbers come from a script:

```bash
python .claude/skills/workflow-retro/scripts/aggregate_run.py \
  --tasks-dir "<scratchpad-dir-with-'scratchpad'-replaced-by-'tasks'>" \
  --project-dir "$HOME/.claude/projects/<project-slug>" \
  --repo-root "$(pwd)"
```

Your scratchpad path is in your system prompt; the agent transcripts sit in a
`tasks/` directory beside it, one `<agentId>.output` per subagent. `--auto`
guesses both if you are unsure. The script prints only counts, names and paths
— never prompt text or model output — so its output is always safe to read in
full. Read it in full; do not pipe it through `head`.

It gives you, all measured: launch order, model, turns and duration per agent;
the four-way token split; a tool histogram; files read by more than one agent;
identical searches repeated across agents; files written by one agent and
rewritten by another; files re-read inside a single agent; every artifact
written, checked against the filesystem; and anomalies.

## Step 3 (deep mode) — reconcile every claim against the disk

**An agent's report is a claim; the filesystem is the evidence.** These come
apart more often than you would expect, in both directions.

The case that motivated this rule: an `implementation-planner` run in this repo
hit a session limit at the moment it was composing its report. Its transcript
was left 0 bytes and its task ended in `failed` — while both plan files it was
asked to produce sat complete on disk. A retro that trusted the report, or the
empty transcript, would have recorded "planning failed" and thrown away
finished work.

So: for every agent, compare what its report claims against the `Artifacts`
section of the script output. Missing file behind a confident report, and
finished file behind a failed status, are both findings. An empty transcript is
not evidence that nothing happened.

## Step 4 — separate what you measured from what you inferred

This is the discipline the whole report rests on, in either mode. Token
counts, tool histograms, launch order and file overlap are **measured** — the
script (deep) or the Agent tool's own report (quick) produced them directly.
"The agent struggled with X", "the spec was ambiguous", "this context was
redundant" are **inferred** — you are reading intent out of behaviour, and you
can be wrong.

Both belong in the report. Mixing them does not: an inference dressed as a
measurement is how a retro becomes confidently misleading. Keep them apart,
and attach the evidence to every inference.

- ❌ "`spec-creator` found the mockups confusing." — you cannot see confusion.
- ✅ "`spec-creator` re-read `SPEC-01-project-context.md` ×4 within one run
  (measured, deep mode). It was revising a draft it had just written, which
  suggests the file is being used as working memory rather than an output
  (inferred)."

## Step 5 — the evidence rule

**Every claim cites a number or a file path.** A finding you cannot attach one
to is a hunch; drop it rather than softening it into "the agents may possibly
have somewhat duplicated effort". Vague findings are worse than absent ones —
they survive into the next retro and accumulate into folklore.

When a run genuinely has nothing notable, say so in one line and stop. Three
agents that each did their job at reasonable cost is a fine outcome and needs
no paragraphs. Padding a retro to look thorough is the specific failure mode
this skill exists to prevent.

## Step 6 — what is actually worth looking for

Run these lenses over what you have. Report the ones that fire; say "nothing"
for the ones that do not — silence is ambiguous. Lenses marked (deep only)
need the script's per-agent tool log and cannot be supported from quick mode.

**Cost shape (deep only for the four-way split; quick mode has `subagent_tokens`
totals only).** Never report one "tokens" number when you have the split.
Read the cache columns: `cache_read` far above `cache_creation` means context
was reused across turns, which is healthy and cheap. The reverse means the
agent's context was rebuilt repeatedly — that is the actionable signal, and it
usually traces to a prompt that grows mid-run or a preloaded file that
changes. Note explicitly that the script's raw sums are a different quantity
from the `subagent_tokens` figure the Agent tool reports on completion;
presenting one as the other misstates the cost by an order of magnitude.

**Money (deep only).** The script prices the run at Anthropic list rates and
prints its own caveats — carry those caveats into the report rather than
quoting the dollar figure bare. Three of them change how the number should be
read: it is list price, not necessarily anyone's bill (on a subscription plan
there is no per-token charge at all, so the figure measures the size of the
work); cache writes are priced at the 5-minute-TTL multiplier because the
transcript does not record the TTL, so 1-hour caching costs more than stated;
and the main agent's own tokens are not in these transcripts, so the session
as a whole cost more than the total. An agent whose model is not in the price
table reads as `?` — never as free. Prices are a dated snapshot in the
script; if the number will be used for a real decision, re-check them before
quoting it.

**Duplicated context (deep only).** Files two or more agents each read
independently. Each one is a candidate for preloading into the agent
definition, or for being passed in the spawn prompt instead of rediscovered.
Same for identical `Grep` patterns run by different agents. This is the lens
most worth escalating to a concrete action: *"preload `<file>` into `<agent>`'s
frontmatter"* is directly actionable.

**Re-work (deep only).** A file written by one agent and rewritten by a later
one. Sometimes that is the design (implementer then test-writer); sometimes it
means the first agent's output did not survive contact with the second, which
is a prompt problem worth naming.

**Re-reading within one agent (deep only).** The same file opened repeatedly
in a single run usually means it is being used as scratch memory, or that the
agent lost track of what it already knew.

**Orchestration, not just agents (both modes).** Count the blocking questions
that came back to the user, the user round-trips, and the work the main agent
did that a subagent had already done. A chain that is efficient per-agent but
takes six user round-trips is not efficient. Note where a question could have
been answered from the codebase instead of asked. If several agents were
active at once, note whether concurrency itself was the cost driver — an
overloaded role handling too much in one spawn is a split-the-role finding,
not a token finding.

**Silence and failure (both modes).** Agents that produced no artifacts,
ended in `failed`, or returned a report with no findings. Say what happened
and what it cost.

## Step 7 — write the ledger row, not a new file

Every run appends **one row** to the single shared ledger at
`docs/retro/ledger.md`. This skill does not create a new dated file per run —
if you are about to write `docs/retro/YYYY-MM-DD-<slug>.md`, stop; that is the
old behavior and it is exactly what made the ledger useless for spotting a
trend, since every run's numbers lived in a different file nobody diffed
against the last one.

If `docs/retro/ledger.md` does not exist, create it with this header, then add
the first row. If it exists, append a row with `Edit` — never rewrite the file,
and never reorder or delete an existing row:

```markdown
# Workflow Retro Ledger

One row per manually-run retro, newest at the bottom. Full reasoning and
evidence live in the chat response at run time — this file exists to compare
runs against each other, not to reproduce a report. `n/a (quick)` means the
run used quick mode and the field needs deep mode to populate.

| date | workflow | mode | agents | outcome | cost (list) | cache read:create | dup files | rework files | top action |
|------|----------|------|--------|---------|--------------|--------------------|-----------|--------------|------------|
```

Column rules:
- **date** — from session context, never a file mtime.
- **workflow** — short slug, e.g. `spec-creator→implementation-planner`.
- **mode** — `quick` or `deep`.
- **agents** — subagent count, main agent excluded.
- **outcome** — `completed` | `completed with failures` | `abandoned`.
- **cost** — deep mode's total at list price, with `(N unpriced)` if any agent's
  model wasn't in the price table; `n/a (quick)` otherwise.
- **cache read:create** — the ratio from Step 6's cost-shape lens; `n/a (quick)`
  otherwise.
- **dup files / rework files** — counts from Step 6's deep-only lenses;
  `n/a (quick)` otherwise.
- **top action** — the single highest-value recommendation from Step 8, as one
  short clause a reader can act on without more context (e.g. *"preload
  `docs/specs/README.md` into `spec-creator`"*, or *"split `implementer`'s role
  — it owned both migration and API changes this run"*). One clause, not a
  list; the fuller reasoning stays in chat.

Keep every row's own reasoning where it belongs: the chat message you send
this same turn is the full report (Steps 3–6, findings, evidence). The ledger
row is the compressed trace of it, not a replacement for it — if a finding
needs a file path to be credible, that citation goes in chat, and only the
one-line consequence goes in the ledger.

## Step 8 — recommend, do not rewrite

Findings are phrased as concrete proposals about a named agent or skill
definition, and that is where this skill stops. Do not edit `.claude/agents/*.md`
or any skill file as part of a retro: the retro is evidence, and changing the
thing you just measured in the same breath removes the user's chance to
disagree with the diagnosis.

Favor recommendations that fall into one of these shapes — they are the ones
a reader can act on immediately, and they map directly onto the Step 6 lenses:

- **Remove duplicated context.** A file two or more agents each discovered
  independently (Step 6, duplicated context) — name the file and the agents.
- **Preload a shared file.** Same signal, phrased as the fix — add it to an
  agent's `skills:`/frontmatter preload list, or pass it in the spawn prompt,
  instead of leaving it to be rediscovered.
- **Split an overloaded role, or reduce concurrency.** One agent doing
  distinguishable jobs in a single spawn, or several agents contending for the
  same file/resource at once (Step 6, orchestration lens).

Other recommendation shapes are fine when the evidence points elsewhere — these
three are the common cases worth naming explicitly, not an exhaustive list.

- ❌ "Improve agent prompts to reduce redundancy."
- ✅ "`spec-creator` and `implementation-planner` each read
  `docs/specs/README.md` and all four mockups independently (measured, files
  read by 2+ agents). Consider preloading the README into `spec-creator` via
  its `skills:` frontmatter, and passing the mockup paths in the planner's
  spawn prompt so it does not glob for them."

Finish with a short summary in chat — the outcome, the total cost (or "not
measured — quick mode" if applicable), and the one or two recommendations
worth acting on — followed by confirmation that the ledger row was appended
and where. The chat message holds the detail; the ledger holds the trend.
