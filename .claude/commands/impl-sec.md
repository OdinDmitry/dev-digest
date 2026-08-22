---
description: Run an approved Development Plan end to end — implement, architecture + security review, cover with tests, fix, verify. Same as /impl but includes security-reviewer in Phase 2.
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

This command is `/impl` **plus** `security-reviewer` in Phase 2 and security
findings in the fix loop. For the default chain without security review, use
[`impl.md`](impl.md).

---

## Spawn handoff format

During Phase 0 you read the plan once. **Extract** the blocks below and
**paste them verbatim** into each subagent spawn — subagents must not re-read
the full plan unless a task is ambiguous. Do not paste the whole plan into
spawn prompts.

### Implementer handoff (one per track in multi-agent mode)

```markdown
### Implementer handoff
Plan path: docs/plans/… (reference only — do not read in full)
Track: <heading or "all tasks">
Spec path: … (read-only background; do not open unless a task cites an AC verbatim)

## Shared contract
<copy from plan ## Shared contract, or "none" for single-agent>

## Your tasks
<verbatim Tn bullets for this track, owner: implementer only>

## Fast loop
<copy Verification → Fast loop bullets>

## Design paths
<paths or "none">

## Clarifications
<Phase 0 pass-through or "none">
```

Also include this line in every implementer spawn:

> Tasks marked `owner: test-writer` belong to `test-writer` and run after you;
> skip them and list them under "Handed to test-writer".

### Test-writer handoff (Phase 2)

```markdown
### Test-writer handoff
Plan path: … (reference only — do not read in full)

## Your tasks
<verbatim all owner: test-writer tasks from plan>

## Traceability rows
<only table rows for tests you must write>

## Design paths
<paths if UI feature, else "none">

## Fast loop
<copy Verification → Fast loop bullets>
```

### Architecture-reviewer and security-reviewer handoff

Baseline SHA, `git diff <baseline-sha>...` scope (plus untracked files if
any). No plan. Both reviewers get the same diff scope.

### Plan-verifier handoff

Plan path + spec path — **full read required** (unchanged).

### Implementer fix-mode handoff (Phase 3 / Phase 4 gaps)

Findings report (architecture, security, and/or test-writer defects), plan path
for reference only, instruction to fix exactly those findings and **not**
re-read the full plan unless a finding requires plan context.

---

## Phase 0 — intake

1. **Resolve the plan.** First positional argument is a path under
   `docs/plans/`. If it is missing or ambiguous, list the candidates and stop.
   Read the plan in full.
2. **Spec path and AC map.** Record the spec **path** from the plan header
   (`Spec: docs/specs/…`) or from `--spec`. Build the AC coverage map from
   the plan's `## Traceability` table only. Open the spec **only** if the plan
   has no Traceability table (legacy plan) — then read the spec once and note
   that in the run announcement.
3. **Designs.** Collect any paths given after `--designs` (a file or a folder;
   expand a folder with Glob). You do not open them — include paths in the
   implementer and test-writer handoff blocks.
4. **Extra requirements.** Any free text left in the invocation. Classify it
   before doing anything with it:
   - *Clarifies* a plan task (naming, copy, an ambiguity the plan left open) →
     pass through in `## Clarifications` of the implementer handoff.
   - *Adds or changes* scope — new behaviour, a different approach, a file the
     plan does not list → **stop the whole run**. Report which requirement
     falls outside the plan and tell the user to re-run
     `implementation-planner`. Never implement unplanned scope; that decision
     is the planner's, and taking it here silently detaches the code from the
     spec's acceptance criteria.
   When it is genuinely unclear which of the two it is, ask — one question,
   with your reading of it and a recommendation.
5. **Prepare handoff blocks.** From the plan you just read, compose every
   Implementer handoff (per track or one for single-agent) and the
   Test-writer handoff. You will paste these into spawns in Phases 1 and 2 —
   do not make subagents re-extract from the plan file.
6. **Baseline.** Record `git rev-parse HEAD` and `git status --short`. If the
   tree is already dirty, say what is uncommitted and ask whether to continue —
   the scope check in Phase 4 cannot separate your changes from pre-existing
   ones otherwise.
7. **Announce the run** before spawning anything: plan path, spec path (not
   necessarily opened), task count split by `owner:`, execution mode, modules
   touched, designs found, handoff blocks prepared (N implementer tracks +
   test-writer queue of M tasks), and the phases you will run. Keep it to a
   few lines.

## Phase 1 — implement

Read the plan's `Execution mode`.

- **single-agent** — one `implementer` spawn with one Implementer handoff
  block (`Track: all tasks`).
- **multi-agent** — one `implementer` per track, in parallel in a single
  message, but **only** after you have confirmed the tracks' file lists are
  actually disjoint. If they overlap, run them sequentially instead and say
  why. Run the plan's `### Integration` track last, alone, after every other
  track has reported. Each spawn gets its own Implementer handoff block.

**Gate before Phase 2.** Read each report's *Scope deviations / open items*.
If an implementer stopped on a plan/code mismatch, or left plan tasks
unfinished, do not spend a review or a test pass on incomplete work — report
and stop. Reviewing half-written code is a wasted call, and tests written
against it are worse than none.

## Phase 2 — review and cover, in parallel

Spawn all three in a single message. They are safe together:
`architecture-reviewer` and `security-reviewer` are both read-only, and
`test-writer` touches only test files, so their writes cannot collide.

- **`architecture-reviewer`** — paste the reviewer handoff (baseline SHA +
  diff scope), not the plan.
- **`security-reviewer`** — same diff scope as architecture-reviewer. It is a
  repo-agent, not the `/security-review` skill or the DB-stored in-product
  reviewer — a Claude Code subagent producing plain-text findings.
- **`test-writer`** — paste the **Test-writer handoff** block prepared in
  Phase 0. Do not tell it to re-read the full plan or scan Traceability
  itself.

## Phase 3 — one fix loop, fed by all reports

Three kinds of signal arrive, and they go into the **same** `implementer`
fix-mode call — one call per iteration, not one per report:

1. **Architecture findings**, by grade:
   - **CRITICAL** — must be fixed.
   - **WARNING** — fix, unless fixing it would change behaviour the plan
     specified; then report it instead.
   - **SUGGESTION** — never fix here. Pass it to the final report untouched.
     Acting on suggestions is how a fix loop turns into an unplanned refactor.
2. **Security findings**, by the same three-grade rule as architecture
   findings above — `security-reviewer` uses this repo's identical
   `CRITICAL`/`WARNING`/`SUGGESTION` scale, not the preloaded skill's
   four-level one, precisely so this gate applies unchanged. A `CRITICAL`
   security finding is never left for the final report; it blocks the same
   way an unfixed architecture `CRITICAL` does.
3. **Implementation bugs `test-writer` found.** It stops rather than editing
   implementation code, so a report saying a test fails because the code is
   wrong is a real defect — send it to the fixer with the failing test named.

Send all three via the **Implementer fix-mode handoff** — combined findings
list, plan path for reference, instruction to fix exactly those and not
re-read the full plan.

After the fixes:

- Re-run `architecture-reviewer` and `security-reviewer` on **only the files
  the fix touched**, not the original diff. A re-review of unchanged code
  buys nothing.
- If a fix moved, renamed, or changed the signature of anything a new test
  imports, re-run `test-writer` **scoped to the affected test files only** — it
  owns those files, and `implementer` must not repair them itself.

**Cap: 2 fix iterations.** If findings of the same grade survive both, stop
looping and escalate to the user with the remaining findings and what was
tried. A third automatic pass on a finding two rounds of fixes did not close
means the plan or the finding is wrong, and that is a human call.

## Phase 4 — verify

Spawn `plan-verifier` with the plan-verifier handoff (plan path + spec path).
Tests exist by now, so it can give an honest verdict on the whole traceability
table — that is the reason it runs last. It executes the plan's **Full**
verification block itself; do not run those commands yourself first,
duplicating them is pure cost.

If it reports gaps against correctness or a stated plan requirement: one more
fix-mode pass — `implementer` for implementation gaps, `test-writer` for
missing or unconvincing tests — then re-verify **once**. Still failing → stop
and escalate. If it reports a gap in the *plan itself*, do not patch around it;
that goes back to `implementation-planner`, by hand.

**Manual steps in the Full block.** No agent in this chain can drive a browser,
so a Verification bullet reading "run `./scripts/dev.sh`, open …, click …,
confirm …" did not happen — whatever the verifier's report implies. Handle it
explicitly:

- If the plan touches a UI entry point and the repo has an e2e flow covering
  it, run `./scripts/e2e.sh` yourself and report the real result. That is
  automated evidence; a manual bullet is not.
- Collect every remaining manual bullet verbatim into **Verification →
  Not performed** in your report, one line each.
- If any `AC-N`'s only evidence is one of those bullets, it is **uncovered**.
  List it under Tests as uncovered and say so in plain words. Do not describe
  the run as complete, and do not let "plan-verifier reported no gaps" stand in
  for a check nobody ran.

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

## Security review
- <n> findings — <n> fixed over <n> iteration(s), <n> escalated
- Unfixed: <grade> <title> — <file:line> — why it was left

## Verification
- <command> — pass/fail
- Not performed: <manual/browser bullet, verbatim> — needs a human
- Gaps: none | <list>

## Left open
- Suggestions not acted on: <list>
- Anything escalated, and what it is waiting on

## Not done by this command
- A deeper, out-of-diff security audit — `security-reviewer` only sees this
  run's diff; run the `/security-review` skill for a broader pass
- Docs — run `doc-writer` if the feature needs more than a CLAUDE.md line
- `pr-self-review` before `gh pr create` (a hook enforces this)
```

Report faithfully: a failed command is reported with its output, an escalated
finding is named, and any `AC-N` that ended the run without a passing test —
including one whose only evidence was a manual step nobody ran — is listed
under Tests as uncovered. Do not describe the run as complete while anything
above is outstanding.

## Cost discipline

Twelve subagent calls is a normal upper bound for a mid-sized plan (1–3
implementers, 3 in the review/cover phase, 1–2 fixes, 1–2 re-checks, 1–2
verifies). If you find yourself about to exceed that, stop and ask instead — a
chain that keeps looping is a signal about the plan, not a reason to keep
spending.
