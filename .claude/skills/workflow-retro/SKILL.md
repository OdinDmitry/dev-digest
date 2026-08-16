---
name: workflow-retro
description: Produces a grounded retrospective of a multi-agent run — how many agents ran and in what order, the four-way token split per agent, which files they duplicated, what they re-worked, and what the orchestration cost. Use this whenever a multi-agent workflow finishes (a `/impl` run, a spec→plan→implement chain, any session that spawned two or more subagents), and whenever the user asks how a run went, what it cost, why it was slow or expensive, where the tokens went, or how the agents could be improved. Reads telemetry from transcripts on disk — never interviews the agents. Writes to docs/retro/, never to any module's insights.md.
---

A workflow retro answers one question: **what would we change about the agent
chain before running it again?** Everything here exists to make that answer
falsifiable. A retro that says "the run went well, agents collaborated
effectively" is worse than no retro — it costs tokens and teaches nothing.

This is the meta level: how the *workflow* performed. Discoveries about the
*code* belong in a module's `insights.md` and are owned by the
`engineering-insights` skill. Never write to `insights.md` from here.

## Step 1 — get the telemetry, and never read a raw transcript

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

## Step 2 — reconcile every claim against the disk

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

## Step 3 — separate what you measured from what you inferred

This is the discipline the whole document rests on. Token counts, tool
histograms, launch order and file overlap are **measured** — the script read
them. "The agent struggled with X", "the spec was ambiguous", "this context was
redundant" are **inferred** — you are reading intent out of behaviour, and you
can be wrong.

Both belong in the report. Mixing them does not: an inference dressed as a
measurement is how a retro becomes confidently misleading. Keep them in
separate sections, and attach the evidence to every inference.

- ❌ "`spec-creator` found the mockups confusing." — you cannot see confusion.
- ✅ "`spec-creator` re-read `SPEC-01-project-context.md` ×4 within one run
  (measured). It was revising a draft it had just written, which suggests the
  file is being used as working memory rather than an output (inferred)."

## Step 4 — the evidence rule

**Every claim cites a number or a file path.** A finding you cannot attach one
to is a hunch; drop it rather than softening it into "the agents may possibly
have somewhat duplicated effort". Vague findings are worse than absent ones —
they survive into the next retro and accumulate into folklore.

When a run genuinely has nothing notable, say so in one line and stop. Three
agents that each did their job at reasonable cost is a fine outcome and needs
no paragraphs. Padding a retro to look thorough is the specific failure mode
this skill exists to prevent.

## Step 5 — what is actually worth looking for

Run these lenses over the script output. Report the ones that fire; say
"nothing" for the ones that do not — silence is ambiguous.

**Cost shape.** Never report one "tokens" number. Report the four-way split,
and read the cache columns: `cache_read` far above `cache_creation` means
context was reused across turns, which is healthy and cheap. The reverse means
the agent's context was rebuilt repeatedly — that is the actionable signal, and
it usually traces to a prompt that grows mid-run or a preloaded file that
changes. Note explicitly that these raw sums are a different quantity from the
`subagent_tokens` figure the Agent tool reports on completion; presenting one
as the other misstates the cost by an order of magnitude.

**Money.** The script also prices the run at Anthropic list rates and prints its
own caveats — carry those caveats into the report rather than quoting the
dollar figure bare. Three of them change how the number should be read: it is
list price, not necessarily anyone's bill (on a subscription plan there is no
per-token charge at all, so the figure measures the size of the work); cache
writes are priced at the 5-minute-TTL multiplier because the transcript does not
record the TTL, so 1-hour caching costs more than stated; and the main agent's
own tokens are not in these transcripts, so the session as a whole cost more
than the total. An agent whose model is not in the price table reads as `?` —
never as free. Prices are a dated snapshot in the script; if the number will be
used for a real decision, re-check them before quoting it.

**Duplicated context.** Files two or more agents each read independently. Each
one is a candidate for preloading into the agent definition, or for being
passed in the spawn prompt instead of rediscovered. Same for identical `Grep`
patterns run by different agents.

**Re-work.** A file written by one agent and rewritten by a later one. Sometimes
that is the design (implementer then test-writer); sometimes it means the first
agent's output did not survive contact with the second, which is a prompt
problem worth naming.

**Re-reading within one agent.** The same file opened repeatedly in a single run
usually means it is being used as scratch memory, or that the agent lost track
of what it already knew.

**Orchestration, not just agents.** Count the blocking questions that came back
to the user, the user round-trips, and the work the main agent did that a
subagent had already done. A chain that is efficient per-agent but takes six
user round-trips is not efficient. Note where a question could have been
answered from the codebase instead of asked.

**Silence and failure.** Agents that produced no artifacts, ended in `failed`,
or returned a report with no findings. Say what happened and what it cost.

## Step 6 — write the report

Path: `docs/retro/YYYY-MM-DD-<workflow-slug>.md`, taking the date from the
session context, never from file mtimes. Create `docs/retro/` if missing.

The schema is fixed so that two retros can be read side by side and a trend can
be seen — keep the headings exactly as below even when a section is empty.

```markdown
# Retro: <workflow name> — YYYY-MM-DD

Session: <session id>
Agents: <n>  ·  Deliverables: <paths produced>
Outcome: completed | completed with failures | abandoned

## Measured

| # | agent | model | turns | dur | input | output | cache create | cache read | cost |
|---|-------|-------|-------|-----|-------|--------|--------------|------------|------|

Launch order: <1 → 2 → 3, noting which ran in background/parallel>
Orchestration: <n> user round-trips, <n> blocking questions returned
Cost: <total> at list price, <what it excludes and why it is not a bill>

## Reconciliation
<claim vs disk for each agent; "all reports matched the filesystem" if so>

## Duplicated context
## Re-work
## Observations
<inferred, each with its evidence>

## Recommendations
<concrete, addressed to a named agent or skill definition>

## Nothing notable
<the lenses that fired empty — one line, so a later reader knows they were run>
```

## Step 7 — recommend, do not rewrite

Findings are phrased as concrete proposals about a named agent or skill
definition, and that is where this skill stops. Do not edit `.claude/agents/*.md`
or any skill file as part of a retro: the retro is evidence, and changing the
thing you just measured in the same breath removes the user's chance to
disagree with the diagnosis.

- ❌ "Improve agent prompts to reduce redundancy."
- ✅ "`spec-creator` and `implementation-planner` each read
  `docs/specs/README.md` and all four mockups independently (measured, files
  read by 2+ agents). Consider preloading the README into `spec-creator` via
  its `skills:` frontmatter, and passing the mockup paths in the planner's
  spawn prompt so it does not glob for them."

Finish with a short summary in chat — the outcome, the total cost, and the one
or two recommendations worth acting on. The file holds the detail; the chat
message is what the user actually reads.
