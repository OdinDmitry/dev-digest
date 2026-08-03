---
name: pr-self-review
description: "Self-review of the local changes before a pull request is opened. Run this whenever a PR is about to be created — `gh pr create`, 'open a PR', 'push this branch for review' — and whenever the user asks to check, audit or sanity-check what they are about to submit ('review my changes', 'am I ready to open a PR?', 'check the diff before I push'). It collects the branch diff plus the working tree, routes each changed file to the skills that actually govern it (UI files to the frontend skills, server files to the backend architecture skills, schema files to the Drizzle/Postgres skills, contracts to zod), and returns a graded report. One CRITICAL finding blocks the PR. A PreToolUse hook enforces this on `gh pr create`, so running the skill is what unblocks that command. Not for reviewing someone else's already-open PR — that is `/review`."
version: 1.0.0
metadata:
  tags: review, pre-pr, gate, diff, routing, self-review, quality
  last-reviewed: 2026-08-03
---

# PR self-review

Runs the repository's own skills against the change you are about to submit, and refuses
to let a PR open while a CRITICAL finding stands.

Scope boundary — this skill owns the *process*, never the rules:

| Question | Skill |
|----------|-------|
| What do I check, in what order, and what blocks the PR? | **this skill** |
| Is this import allowed / which ring is this? | `onion-architecture` |
| Where should this component live? | `frontend-ui-architecture` |
| Is this React/Next/Fastify/Drizzle/Zod code correct? | the respective skill |

Every finding must trace back to a rule some *other* skill owns. If you catch yourself
inventing a rule here, it belongs in the skill that covers that area — or nowhere.

Companion files:

- `routing.md` — read at step 2. Changed file → domain → which skills the reviewer reads.
- `severity.md` — read at step 3, and pass into every subagent prompt. The severity rubric,
  the closed list of CRITICAL triggers, and the anti-false-positive rules.
- `README.md` — why this skill is shaped the way it is; what it deliberately does not do.

---

## Step 1 — collect the diff

The change under review is *everything that would land in the PR, plus everything not
committed yet*.

```bash
BASE=$(git merge-base HEAD main)
git diff --name-status "$BASE"     # committed on this branch
git diff --name-status HEAD        # staged + unstaged
git status --porcelain             # untracked files
```

Union the three file lists and deduplicate. Drop paths that are never reviewable:
`server/clones/`, `e2e/test-results/`, `node_modules/`, `*.tsbuildinfo`, `.next/`, `dist/`.

Per-file content comes from `git diff "$BASE" -- <file>` (add `git diff HEAD -- <file>` when
the file also has uncommitted edits). Note the changed line ranges — step 4 needs them.

If the union is empty, report PASS with "no changes to review" and skip to step 6.

If `main` is not present locally, fall back to `origin/main`; if neither resolves, say so
and review `git diff HEAD` only — do not silently review nothing.

---

## Step 2 — classify

Read `routing.md` and assign every changed file to one or more domains. Two rules that are
easy to get wrong:

- A file can belong to several domains. `server/src/modules/repos/routes.ts` is both
  `backend-api` and (because it is a route) in scope for the cross-cutting `security` pass.
- **A domain with no changed files gets no subagent.** This is the whole point: a diff that
  touches only `client/` must never spend a subagent on `onion-architecture`, and a
  server-only diff must never load the React skills.

Write down the domain → files mapping before launching anything. It goes in the report.

---

## Step 3 — launch the reviewers

One `Explore` subagent per touched domain, at most 3 per message (batch if there are more).
`Explore` is read-only, which is what you want — a reviewer must not "helpfully" fix things.

Each subagent prompt must contain, in full:

1. The list of files in its domain, and the exact `git diff` command to read them.
2. The absolute paths of the skill files it is required to read, from `routing.md` — the
   `SKILL.md` plus the named companion files, nothing else.
3. The entire contents of `severity.md`. Do not paraphrase it and do not tell the agent to
   go read it — inline it, or the rubric drifts per agent.
4. The finding format below, with the instruction to return **only** findings in that format
   plus a one-line domain summary.

Required finding format:

```
- severity: CRITICAL | WARNING | SUGGESTION
  category: bug | security | perf | style | test | architecture
  file: <repo-relative path>
  lines: <start>-<end>
  title: <one line>
  why: <the consequence — what breaks, what becomes untestable, what leaks>
  fix: <the concrete move, not the principle>
  skill: <which skill's rule this is>
```

Tell each agent explicitly: report nothing outside its own domain. Overlap is resolved in
step 4, not by agents second-guessing each other.

---

## Step 4 — ground and merge

Two passes over the collected findings, both mechanical:

**Grounding.** Drop any finding whose `file` is not in the changed-file list, or whose
`lines` do not intersect a changed line range from step 1. This mirrors `groundFindings` in
[reviewer-core/src/grounding.ts](../../../reviewer-core/src/grounding.ts) — a self-review
that comments on code the PR does not touch is noise, and it is the failure mode that makes
people stop running the gate. Do not import that code; apply the same rule by hand.

**Dedup.** Same `file` + overlapping line range + same underlying rule → keep one, the
higher severity. Two different rules on the same line both stand.

Then sort: CRITICAL, WARNING, SUGGESTION; within a severity, by file path.

---

## Step 5 — report

Print to chat and write the same text to `.claude/.pr-self-review/last-report.md`.

Severity markers match the review engine's `SEV_EMOJI` in
[reviewer-core/src/output/to-review.ts](../../../reviewer-core/src/output/to-review.ts):
🔴 CRITICAL · 🟡 WARNING · 🔵 SUGGESTION.

```markdown
# PR self-review — BLOCKED (2 critical)

Base: <sha> (merge-base with main) · 14 files · 4 domains

| Domain | Files | Skills applied |
|--------|-------|----------------|
| backend-api | 6 | onion-architecture, fastify-best-practices |
| ...

## 🔴 CRITICAL

### server/src/modules/repos/service.ts:12-12 — drizzle-orm imported into ring 2
**Why:** …
**Fix:** …
**Rule:** onion-architecture

## 🟡 WARNING
…
```

Keep `why` and `fix` to a sentence or two each. Word findings the way
[onion-architecture/review-checklist.md](../onion-architecture/review-checklist.md#how-to-word-a-finding)
prescribes: name the consequence and the concrete move, not the principle.

---

## Step 6 — the gate

**Any CRITICAL → the PR does not open.** Do not run `gh pr create`, do not write the state
token. List the blockers, offer to fix them, and say that re-running this skill is what
lifts the gate.

**Zero CRITICAL → PASS.** Write the token that the hook checks:

```bash
mkdir -p .claude/.pr-self-review
HEAD_SHA=$(git rev-parse HEAD)
DIRTY=$( { git diff HEAD; git status --porcelain; } | sha256sum | cut -d' ' -f1 )
cat > .claude/.pr-self-review/state.json <<EOF
{
  "branch": "$(git rev-parse --abbrev-ref HEAD)",
  "head": "$HEAD_SHA",
  "dirty": "$DIRTY",
  "verdict": "pass",
  "at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
```

WARNING and SUGGESTION findings never block — they are printed and left to the author's
judgement. Resist the urge to promote one to CRITICAL because it feels important: the
CRITICAL list in `severity.md` is closed, and a gate people cannot predict is a gate people
route around.

The token is bound to the *content* of the tree, not to the branch. Any new commit, amend or
edit after a PASS invalidates it, and the next `gh pr create` is blocked again until the
skill re-runs. That is intentional — a review of an older tree is not a review of this PR.

---

## The hook

[scripts/pr-self-review-gate.sh](../../../scripts/pr-self-review-gate.sh), wired as a
`PreToolUse` hook on `Bash` in [.claude/settings.json](../../settings.json). It inspects the
command, ignores everything that is not `gh pr create`, recomputes the token above, and
exits 2 with an explanation when it does not match a recorded pass.

The hook is a tripwire, not the review. It cannot tell a good diff from a bad one — it only
knows whether *this exact tree* has been reviewed. Never edit `state.json` by hand to get
past it; that is the same as not reviewing.
