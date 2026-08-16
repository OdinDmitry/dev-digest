# Retro: Project Context — spec → plan chain — 2026-08-16

Session: `2b728059-99cf-4ea9-a0e2-0bd562fbf364`
Agents: 2 workflow agents (`spec-creator`, `implementation-planner`) · Deliverables:
`docs/specs/cross/SPEC-01-project-context.md` (22,658 B, `Status: approved`),
`docs/plans/2026-08-16-project-context-browse-attach.md` (43,124 B),
`docs/plans/2026-08-16-project-context-run-injection.md` (29,409 B)
Outcome: completed with failures

## Measured

| # | agent | model | turns | dur | input | output | cache create | cache read | cost |
|---|-------|-------|-------|-----|-------|--------|--------------|------------|------|
| 1 | spec-creator | claude-opus-5 | 47 | 15.3m | 3,535 | 45,067 | 750,051 | 2,811,457 | $7.24 |
| 2 | implementation-planner | — | 0 | — | 0 | 0 | 0 | 0 | ? |

Cost: **$7.24** at Anthropic list prices, and every word of that qualifier
matters. It covers one agent — the planner's spend is unmeasurable, and the main
agent's tokens are not in these transcripts, so the session as a whole cost
more. Cache writes are priced at the 5-minute-TTL multiplier because the
transcript does not record which TTL was requested; 1-hour caching would cost
more. And on a subscription plan nothing is billed per token at all, so read
this as the size of the work rather than money that changed hands.

The shape of that figure is worth more than its total: $4.69 of it is cache
*creation* and only $1.41 is cache *reads*. Writes are the expensive half here,
which is the cost consequence of the two-run structure noted below.

Tool histogram, `spec-creator`: `Read×17, Edit×6, Glob×3, Grep×2, Write×1` = 29
calls, matching the 18 + 11 `tool_uses` the Agent tool reported across its two
runs. That match confirms the single transcript covers both the initial run and
the resumed one.

Row 2 is empty because the transcript is 0 bytes, not because the agent did
nothing — see Reconciliation. A third 0-byte transcript in `tasks/` belongs to
the `skill-creator` invocation that was still active during this retro and is
not a workflow agent.

The four figures above are raw per-message sums. They are a different quantity
from the `subagent_tokens` the Agent tool reported on completion (96,748 for the
first `spec-creator` run, 122,348 for the resumed one) — neither number should be
presented as the other.

Launch order: 1 → 2, both `run_in_background: true`, strictly sequential — the
planner was not spawned until the spec was approved. `spec-creator` ran twice:
once to write the draft, once resumed via `SendMessage` to close open questions.
Orchestration: 9 user round-trips, 0 blocking questions returned by any agent.

## Reconciliation

- `spec-creator` — claimed `SPEC-01-project-context.md`; exists at 22,658 bytes.
  Match.
- `implementation-planner` — task status `failed` (session limit), transcript
  0 bytes, telemetry says "wrote nothing". **Both plan files exist on disk,
  complete, at 43,124 and 29,409 bytes**, with a coherent two-part split, full
  traceability tables covering AC-1…AC-28 exactly once, and populated
  assumptions sections. The agent died while composing its report, after its
  deliverables were written.

This is the failure mode the reconciliation step exists for: three independent
signals — task status, transcript, and telemetry — all said the planning failed,
and all three were wrong about the thing that mattered.

## Duplicated context

Unmeasurable this run, not zero. The script reports "none" for files read by
more than one agent and for repeated searches, but with only one agent
producing a readable transcript there is nothing to intersect. Treat these two
lenses as unavailable rather than clean until a run completes with two or more
live transcripts.

## Re-work

Between subagents: none measurable.

Between the main agent and a subagent: 6 `Edit` calls were applied to the
planner's two output files after it finished — the `U9` seeding constraint, the
`AC-28` traceability row, the note beneath it, both `Open questions` sections,
and the added measurement step in plan 1's Verification. The script did not
surface any of this, because it only aggregates `tasks/*.output` and never
attributes the main agent's own writes. Counted from this session's tool calls,
not from the script.

## Observations

- **The pre-spawn question round removed the blocking-question round-trip.**
  `spec-creator` is built to return up to five blocking questions and write
  nothing when a blocking unknown remains; it returned zero and wrote the file
  on its first pass (measured: 0 blocking questions, file written in run 1).
  Four decisions — document source, read-only scope, metrics scope, token
  semantics — were resolved with the user before the agent was spawned
  (inferred cause).
- **`spec-creator` used its own output as working memory.** It read
  `SPEC-01-project-context.md` ×4 within the run (measured). Combined with
  `Edit×6` against `Write×1`, the pattern is write-once-then-revise rather than
  compose-then-emit (inferred).
- **Context reuse was healthy.** `cache_read` 2,811,457 against `cache_creation`
  750,051 is a 3.7:1 ratio (measured) — the agent's context was largely reused
  across turns rather than rebuilt.
- **Resuming the agent was not free.** 750,051 cache-creation tokens is large
  next to a 22.6 KB deliverable; a resumed agent re-primes its context before
  it can act (inferred from the two-run structure and the single transcript).
- **The planner's report was the only copy of its reasoning.** Why it split into
  two plans, why `AC-11` moved to part 2, and what it assumed all existed only
  in the report that died. Recovering them took 5 further reads of the plan
  files by the main agent (measured from this session's tool calls).
- **One accepted assumption was a real defect.** The planner recorded the
  seeded run trace as an assumption with a fallback, rather than checking it:
  `04-pr-findings.flow.json` opens the Agent runs tab on the same PR #482 and
  depends on the newest run being open by default, so a newly seeded run would
  have changed what that flow sees (verified by reading the flow file).

## Recommendations

- **`aggregate_run.py` should carry the main agent as row 0.** Its writes and
  edits are invisible today, which hid 6 post-hoc edits to planner output in
  this very run — the largest single piece of re-work here, entirely unmeasured.
  Until that lands, the "Re-work" section of any retro is only about subagents.
- **`implementation-planner` should write its rationale into the plan file, not
  only into its report.** A short section covering why the work was split, what
  it assumed, and what it wants checked would have survived the agent's death
  intact. Its report is currently a single point of failure for everything that
  is not a task list.
- **`implementation-planner` should verify assumptions that touch existing test
  fixtures, rather than record them.** The e2e seeding collision was checkable
  in one read of `e2e/specs/04-pr-findings.flow.json`. Assumptions about files
  the agent can open are worth resolving; assumptions about the user's intent
  are not.
- **Consider passing decisions to `spec-creator` up front rather than resuming
  it.** This run paid for two context primings (750k cache-creation tokens) to
  deliver one 22.6 KB spec. Whether one longer initial prompt is cheaper is
  worth measuring on the next spec, not assumed.

## Nothing notable

Files read by two or more agents, identical searches repeated across agents, and
re-work between subagents: all unmeasurable this run — only one agent left a
readable transcript. No agent returned an empty report, and no agent produced
zero artifacts once the filesystem was consulted.
