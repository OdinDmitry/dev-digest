---
description: Run an approved Development Plan end to end — implement, review, cover with tests, fix, verify. Takes the plan path, plus optional design mockups and extra requirements.
argument-hint: <plan-path> [--designs <path…>] [--spec <path>] [extra requirements…]
---

Execute the Development Plan below through the full implementation chain, as
the orchestrator. You are the only agent here that can spawn subagents — they
cannot spawn each other, so every handoff goes through you.

Invocation: `$ARGUMENTS`

## What this command is not

`spec-creator` and `implementation-planner` are **out of scope** — they are run
by hand, before this command, and reviewed by a human. If no plan exists yet,
stop and say so; do not write one, and do not implement from a spec directly.

---

## Phase 0 — intake

1. **Resolve the plan.** First positional argument is a path under
   `docs/plans/`. If it is missing or ambiguous, list the candidates and stop.
   Read the plan in full.
2. **Read the spec** the plan names (`Spec: docs/specs/…`), or the one passed
   as `--spec`. You need its `AC-N` list to judge coverage later. If the plan
   names no spec, note it and continue.
3. **Designs.** Collect any paths given after `--designs` (a file or a folder;
   expand a folder with Glob). You do not open them — you pass the paths to
   `implementer`, which reads them itself.
4. **Extra requirements.** Any free text left in the invocation. Classify it
   before doing anything with it:
   - *Clarifies* a plan task (naming, copy, an ambiguity the plan left open) →
     pass through to `implementer` verbatim as context.
   - *Adds or changes* scope — new behaviour, a different approach, a file the
     plan does not list → **stop the whole run**. Report which requirement
     falls outside the plan and tell the user to re-run
     `implementation-planner`. Never implement unplanned scope; that decision
     is the planner's, and taking it here silently detaches the code from the
     spec's acceptance criteria.
   When it is genuinely unclear which of the two it is, ask — one question,
   with your reading of it and a recommendation.
5. **Baseline.** Record `git rev-parse HEAD` and `git status --short`. If the
   tree is already dirty, say what is uncommitted and ask whether to continue —
   the scope check in Phase 4 cannot separate your changes from pre-existing
   ones otherwise.
6. **Announce the run** before spawning anything: plan path, task count split
   by `owner:`, execution mode, modules touched, designs found, and the phases
   you will run. Keep it to a few lines.

## Phase 1 — implement

Read the plan's `Execution mode`.

- **single-agent** — one `implementer`.
- **multi-agent** — one `implementer` per track, in parallel in a single
  message, but **only** after you have confirmed the tracks' file lists are
  actually disjoint. If they overlap, run them sequentially instead and say
  why. Run the plan's `### Integration` track last, alone, after every other
  track has reported.

Each `implementer` gets: the plan path, its track (if any), the design paths,
any pass-through clarifications from Phase 0, and this line —

> Tasks marked `owner: test-writer` belong to `test-writer` and run after you;
> skip them and list them under "Handed to test-writer".

**Gate before Phase 2.** Read each report's *Scope deviations / open items*.
If an implementer stopped on a plan/code mismatch, or left plan tasks
unfinished, do not spend a review or a test pass on incomplete work — report
and stop. Reviewing half-written code is a wasted call, and tests written
against it are worse than none.

## Phase 2 — review and cover, in parallel

Spawn both in a single message. They are safe together: `architecture-reviewer`
is read-only, and `test-writer` touches only test files, so their writes cannot
collide.

- **`architecture-reviewer`** — scoped to this run's diff
  (`git diff <baseline-sha>...` plus untracked files), not the whole repo.
- **`test-writer`** — the plan path, plus the design paths if the feature has a
  UI. Its work list is the plan's `## Traceability` table: every `AC-N` row
  names the test that proves it, and every one of those that does not exist yet
  is a test it writes.

## Phase 3 — one fix loop, fed by both reports

Two kinds of signal arrive, and they go into the **same** `implementer` fix-mode
call — one call per iteration, not one per report:

1. **Architecture findings**, by grade:
   - **CRITICAL** — must be fixed.
   - **WARNING** — fix, unless fixing it would change behaviour the plan
     specified; then report it instead.
   - **SUGGESTION** — never fix here. Pass it to the final report untouched.
     Acting on suggestions is how a fix loop turns into an unplanned refactor.
2. **Implementation bugs `test-writer` found.** It stops rather than editing
   implementation code, so a report saying a test fails because the code is
   wrong is a real defect — send it to the fixer with the failing test named.

Send both to `implementer` in **fix mode**: the plan path, the findings, and
the instruction to fix exactly those and nothing else.

After the fixes:

- Re-review **only the files the fix touched**, not the original diff. A
  re-review of unchanged code buys nothing.
- If a fix moved, renamed, or changed the signature of anything a new test
  imports, re-run `test-writer` **scoped to the affected test files only** — it
  owns those files, and `implementer` must not repair them itself.

**Cap: 2 fix iterations.** If findings of the same grade survive both, stop
looping and escalate to the user with the remaining findings and what was
tried. A third automatic pass on a finding two rounds of fixes did not close
means the plan or the finding is wrong, and that is a human call.

## Phase 4 — verify

Spawn `plan-verifier` with the plan path. Tests exist by now, so it can give an
honest verdict on the whole traceability table — that is the reason it runs
last. It executes the plan's **Full** verification block itself; do not run
those commands yourself first, duplicating them is pure cost.

If it reports gaps against correctness or a stated plan requirement: one more
fix-mode pass — `implementer` for implementation gaps, `test-writer` for
missing or unconvincing tests — then re-verify **once**. Still failing → stop
and escalate. If it reports a gap in the *plan itself*, do not patch around it;
that goes back to `implementation-planner`, by hand.

## Phase 5 — report

```markdown
## Run
<plan path> — <n> tasks, mode <single|multi>, baseline <sha>

## Implemented
- [module] <files> — <tasks>

## Tests
- <n> written, <n> already existed — every AC covered | uncovered: AC-<n>, …

## Architecture review
- <n> findings — <n> fixed over <n> iteration(s), <n> escalated
- Unfixed: <grade> <title> — <file:line> — why it was left

## Verification
- <command> — pass/fail
- Gaps: none | <list>

## Left open
- Suggestions not acted on: <list>
- Anything escalated, and what it is waiting on

## Not done by this command
- Security review — run `/security-review`
- Docs — run `doc-writer` if the feature needs more than a CLAUDE.md line
- `pr-self-review` before `gh pr create` (a hook enforces this)
```

Report faithfully: a failed command is reported with its output, an escalated
finding is named, and any `AC-N` that ended the run without a passing test is
listed under Tests. Do not describe the run as complete while anything above is
outstanding.

## Cost discipline

Eleven subagent calls is a normal upper bound for a mid-sized plan (1–3
implementers, 2 in the review/cover phase, 1–2 fixes, 1–2 re-checks, 1–2
verifies). If you find yourself about to exceed that, stop and ask instead — a
chain that keeps looping is a signal about the plan, not a reason to keep
spending.
