# pr-self-review — rationale

## Why this exists

The repository has 13 skills. All of them are loaded *at the agent's discretion*, from their
`description`. That works while you are writing code and asking questions; it does nothing
at the moment it matters most, when a branch turns into a pull request. The onion rules, the
frontend placement rules, the contract-sync gotcha and the OWASP list were all sitting in
files that nothing obliged anyone to open.

CI does not close that gap either. The five workflows in `.github/workflows/` run
`typecheck` and tests. There is no linter in any package and no `dependency-cruiser` — an
architectural regression passes CI green.

So this skill is the missing step: at PR time, take the diff, work out which skills actually
govern each changed file, and apply them.

## Design decisions

**Routing instead of "read everything".** A server-only diff must not spend a subagent on
React rules, and a UI diff must not load `onion-architecture`. Beyond cost, an irrelevant
skill in context is an active source of false positives. `routing.md` is the map, and its
globs deliberately mirror the `paths:` filters already used by the CI workflows.

**Parallel read-only subagents.** One `Explore` agent per touched domain, each with a clean
context and only its own skills. A single-pass review with all 13 skills in one window
degrades badly once the diff is more than a few files. `Explore` is read-only on purpose:
a reviewer that can edit will start "fixing" things mid-review.

**The CRITICAL list is closed.** Nine triggers in `severity.md`, no discretion to add a
tenth mid-review. A blocking gate has to be predictable — the first time it blocks on
something the author considers a matter of taste, they start looking for the bypass. Every
trigger is either a documented repo invariant (do-not-touch migrations, vendor re-sync,
secrets chokepoint) or something that provably breaks CI or production.

**Severity vocabulary borrowed, not invented.** `CRITICAL | WARNING | SUGGESTION` and the
`bug | security | perf | style | test` categories come from
`shared/contracts/findings.ts`, the same contract the product's own review engine emits. One
extra category, `architecture`, exists only in this skill — the contract has no slot for
ring/placement findings, and inventing one there would mean touching a contract that ships
to the client.

**Grounding, copied as a rule.** Findings that do not intersect a changed line are dropped,
the same way `reviewer-core/src/grounding.ts` drops ungrounded model findings. Applied as an
instruction, not by importing the code — this skill runs no build step.

**A content-bound token, not a flag.** The gate's `state.json` records a hash of the tree
(`HEAD` + `git diff HEAD` + `git status --porcelain`). Any commit or edit after a PASS
invalidates it. A per-branch or per-session flag would let one review at the start of the
day authorise everything that follows.

## What it deliberately does not do

- **No `typecheck`, no tests.** The gate blocks on findings only; CI owns the rest. Adding
  them would make the pre-PR step slow enough that people avoid it.
- **No rules of its own.** Every finding cites the skill that owns the rule. If a needed
  rule does not exist anywhere, that is a gap in the relevant skill, and the fix goes there.
- **No reviewing of open PRs.** That is `/review`. This one only ever looks at local state.
- **No auto-fixing.** It reports and blocks. The author decides what to change.

## Known limitations

- `security/SKILL.md` targets React + Express + MongoDB + JWT, not this stack.
  `routing.md` narrows it to the stack-independent sections; a Fastify/Drizzle-native
  security skill would be the better long-term fix.
- The vendor-sync check compares `server/src/vendor/shared/**` against
  `client/src/vendor/shared/**` only. If a third vendored copy appears, the check needs
  updating.
- The hook fires on `gh pr create` as issued through the agent's Bash tool. A PR opened in
  the GitHub web UI, or `gh` run in a terminal outside Claude Code, bypasses it. A native
  `pre-push` hook would close that hole and was left out of scope.
- `main` is assumed to be the base branch. A PR targeting something else needs the base
  passed in manually at step 1.
