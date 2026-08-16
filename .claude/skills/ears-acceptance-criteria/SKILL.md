---
name: ears-acceptance-criteria
description: Writing and validating acceptance criteria in EARS (Easy Approach to Requirements Syntax) — the five requirement patterns, how to translate a vague ask into one testable statement, the AC identifier rules that plans and tests depend on, and a falsifiable checklist for judging whether an AC is well-formed. Use when authoring a spec's acceptance criteria, when binding plan tasks to criteria, or when checking that a criterion can actually be verified. Not for deciding how a requirement is implemented.
---

# EARS acceptance criteria

EARS (Alistair Mavin, Rolls-Royce, 2009) exists so that a requirement collapses
into **one testable statement with no ambiguity about trigger, state or
response**. Spec Driven Development uses it because a criterion written this way
can be bound to exactly one test.

The syntax is the easy half. The work is translating a vague ask into an
unambiguous statement — that is what most of this skill is about.

## The five patterns

`SHALL` is mandatory in every one of them. Not "should", not "must", not "will".

| Pattern | Form | Use when |
|---|---|---|
| **Ubiquitous** | The system SHALL `<response>`. | The requirement holds at all times, with no trigger. |
| **Event-driven** | WHEN `<trigger>`, the system SHALL `<response>`. | Something happens and the system reacts. |
| **State-driven** | WHILE `<state>`, the system SHALL `<response>`. | The requirement holds for the duration of a state. |
| **Unwanted behaviour** | IF `<condition>`, THEN the system SHALL `<response>`. | The unhappy path — failure, abuse, limit reached. |
| **Optional feature** | WHERE `<feature is present/enabled>`, the system SHALL `<response>`. | The requirement applies only to some configurations. |

Choosing between them is not cosmetic:

- A trigger is a **moment** (`WHEN`); a state is a **duration** (`WHILE`). If
  the requirement must hold for as long as something is true, `WHEN` is wrong —
  it only constrains the instant of transition.
- `IF…THEN` is for what you do **not** want to happen. Using it for a normal
  branch of the happy path hides the fact that nobody specified the other
  branch.
- `WHERE` is about configuration or capability, never about runtime state —
  that is `WHILE`.

## Translating a vague ask

Five failure modes cover almost everything you will meet. In each, the fix is
the same move: find the missing trigger, the missing state, or the missing
observable outcome.

**Unmeasurable quality word.** "fast", "responsive", "reliable", "intuitive".
→ Replace with a number and the conditions it holds under. If nobody knows the
number, that is a real open question — write the criterion with a placeholder
number and flag it, do not delete the requirement.

**Response with no trigger.** "Show a loading state."
→ Ask *while what?* and state what must **not** happen at the same time.
A negative half (`and SHALL NOT display a partial list`) is often the only part
that is actually testable.

**Failure hidden in prose.** "Handle the case where X is missing."
→ "Handle" is not an outcome. `IF X is missing, THEN the system SHALL <the
exact thing the user sees or gets>.`

**Two behaviours in one sentence.** Usually joined by "and", sometimes by a
comma.
→ Split into two criteria. One AC that fails for two different reasons cannot
be bound to one test, and its failure tells you nothing.

**Capability stated as a wish.** "Support multi-tenant setups."
→ `WHERE` plus an explicit boundary of what the support does *not* extend to.
A capability without a boundary is not verifiable.

## Identifiers are an API

`AC-1`, `AC-2`, … are referenced from plan tasks, traceability tables, test
names and review reports. Treat them as a public interface:

- **Never renumber.** Not to close a gap, not to reorder for readability.
- **Never reuse.** A retired criterion's number stays retired.
- **Never repurpose.** Editing `AC-3` to mean something else silently
  invalidates every task and test bound to it. Add `AC-9` instead and mark
  `AC-3` deprecated with a pointer.
- Numbering is per spec — `AC-1` only means something alongside its `SPEC-NN`.

## Validation checklist

Every one of these is falsifiable. An AC that fails any of them is not ready:

- [ ] Starts with one of the five patterns, or is a bare ubiquitous statement.
- [ ] Contains `SHALL` (uppercase).
- [ ] Exactly one behaviour — no "and" joining two responses.
- [ ] The trigger or state is observable from outside the system.
- [ ] The response is observable from outside the system. "The system SHALL
      correctly process X" is not — nothing can watch "correctly".
- [ ] No unmeasurable quality word (fast, easy, intuitive, properly,
      gracefully, seamlessly, robust, user-friendly).
- [ ] No implementation detail: no file, folder, layer, class, function,
      component, library, HTTP route, table or column name.
- [ ] You can name the kind of check that would prove it — unit, integration,
      e2e, or manual. If you cannot, the criterion is not testable yet.
- [ ] It does not restate another AC from a different angle.

## Anti-patterns

- **The compound AC.** "…SHALL validate the input and store the result and
  notify the user." Three criteria wearing one number.
- **The implementation AC.** "WHEN the request arrives, the service SHALL call
  the repository layer." Describes the mechanism, not the requirement; it will
  still pass after the behaviour breaks.
- **The tautology.** "WHEN the user saves, the system SHALL save." No new
  information.
- **The wish list entry.** "The system SHALL be secure." Not a criterion —
  security decomposes into specific ones (authorisation, rate limits, input
  handling) or belongs in non-functional requirements with numbers attached.
- **The buried assumption.** "WHEN the user opens the panel, the system SHALL
  show the cached result." Nobody specified caching anywhere else; a criterion
  is not the place to introduce a design decision.
