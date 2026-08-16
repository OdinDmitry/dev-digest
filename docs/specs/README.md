# docs/specs — Spec Driven Development specs

**What** we are building and **why** — never *how*. Written by the
`spec-creator` agent before any code exists, then consumed by
`implementation-planner`, which turns a spec into a plan under
[../plans/](../plans/README.md).

A spec may describe workflows, module-to-module communication and the shape of
a contract. It must not name files, folders, layers, functions, libraries or
DB columns — those are the planner's job. If a section can only be written by
deciding *where code lives*, it does not belong here.

## Layout

```
docs/specs/
  <module>/SPEC-NN-<slug>.md        module = client | server | reviewer-core | mcp | e2e
  cross/SPEC-NN-<slug>.md           spans more than one module
  <module>/_design/SPEC-NN-<slug>/  design mockups (png/jpg) for that spec
```

`NN` is a single repo-wide sequence — `SPEC-01` exists exactly once, whichever
folder it sits in — so a spec can be cited by ID alone.

Note: `e2e/specs/` in the e2e package is something else entirely (the
`*.flow.json` files the runner executes, hardcoded in `e2e/run.ts`). e2e
feature specs live here, under `docs/specs/e2e/`.

## Template

```markdown
# SPEC-NN: <feature name>

Status: draft | approved | implemented
Modules: <client, server, …>
Supersedes: <SPEC-NN, if this replaces an earlier decision — else "—">
Superseded by: <SPEC-MM, filled in when a later spec replaces this one — else "—">
Design refs: <paths under _design/, or "—">

## Problem & why
## Goals / Non-goals            <- explicit boundaries; what we are NOT doing
## User stories
## Workflow & module interaction  <- mermaid; who calls whom, in what order
## Contracts (shape only)       <- fields and meaning, not types/files/endpoints
## Acceptance criteria (EARS)   <- AC-1, AC-2, … one testable statement each
## Edge cases
## Non-functional requirements  <- perf / security / a11y, only if relevant
## Inputs and provenance        <- where each input comes from (tags below)
## Untrusted inputs             <- foreign text? -> handle as data, never commands
## Traceability                 <- AC-N -> how it gets verified
## Open questions               <- [NEEDS CLARIFICATION: …]
```

**Size.** One spec covers one user-visible capability; 5–15 acceptance criteria
is typical and 25 is the point at which it should have been two specs. Length
is a separate signal: past ~600 lines with fewer than 25 criteria, the document
is padded rather than oversized — the fix is cutting, not splitting.

## Acceptance criteria: EARS

Every `AC-N` is one testable statement — no ambiguity about trigger, state or
response. Five patterns (`SHALL` is mandatory in all of them):

| Pattern | Form | Example |
|---|---|---|
| Ubiquitous | The system SHALL … | The system SHALL log every authentication attempt. |
| Event-driven | WHEN <trigger>, the system SHALL … | WHEN the user submits the login form, the system SHALL verify the credentials with the auth provider. |
| State-driven | WHILE <state>, the system SHALL … | WHILE a sync is running, the system SHALL show a progress indicator that cannot be dismissed. |
| Unwanted behaviour | IF <condition>, THEN the system SHALL … | IF credential validation fails 3 times within 60 seconds, THEN the system SHALL lock the account for 15 minutes. |
| Optional feature | WHERE <feature is enabled>, the system SHALL … | WHERE MFA is enabled, the system SHALL require a TOTP code after the password. |

Rejected as acceptance criteria: "fast", "user-friendly", "properly",
"handles errors", "should" instead of `SHALL`, or two behaviours in one AC.

The full rules — how to translate a vague ask into one of these patterns, and
the checklist for judging whether a criterion is well-formed — live in the
[`ears-acceptance-criteria`](../../.claude/skills/ears-acceptance-criteria/SKILL.md)
skill, which is preloaded into `spec-creator` and `implementation-planner`.

**`AC-N` identifiers are an API.** Plan tasks, traceability tables, test names
and review reports point at them. Never renumber, reuse or repurpose one: a
retired criterion is marked deprecated with a pointer, and a changed
requirement gets a new number.

## Inputs and provenance

Each input carries one tag saying where it comes from — this is what makes the
cost and the determinism of a feature visible before it is built:

| Tag | Meaning |
|---|---|
| `[reused: L03 intent]` | an already-produced result is reused, nothing new is computed |
| `[deterministic: repo-intel]` | a fact computed by code, no LLM involved |
| `[new: 1 LLM call]` | needs a new model call (state how many) |

## Lifecycle

`draft` — written by `spec-creator`, may still carry `[NEEDS CLARIFICATION]`,
and may be revised freely.
`approved` — a human flipped it; only then may a plan be written against it.
`implemented` — the plan shipped and `plan-verifier` passed.

**Approved and implemented specs are frozen.** Once a plan is bound to a
spec's acceptance criteria, editing it in place silently invalidates tasks and
tests. A changed requirement gets a **new** spec carrying `Supersedes: SPEC-NN`,
and the old one gets `Superseded by: SPEC-MM` in its header — that reciprocal
line is the only permitted edit to a non-draft spec.

Once implemented, fold anything still true into the owning module's
`CLAUDE.md`/`docs/` and archive or delete the spec.
