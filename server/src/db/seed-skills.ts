import type { SkillType } from '@devdigest/shared';

/**
 * Built-in skills used by the seed (L02).
 *
 * A skill is TEXT ONLY — it has no tools and no execution path. Its body is
 * inserted verbatim into the assembled prompt's `## Skills / rules` section, in
 * the order the agent's Skills tab defines.
 *
 * `description` is the skill's INTERFACE: it is written directively ("Use when
 * …") because it is what a reader — and the agent — uses to decide whether the
 * skill applies. These three are seeded as the worked example of that style.
 *
 * The bodies deliberately carry the concrete checklists that
 * TEST_QUALITY_REVIEWER_PROMPT leaves out, so the same agent run with its skills
 * off demonstrably misses what it catches with them on.
 */

export interface SeedSkill {
  name: string;
  description: string;
  type: SkillType;
  body: string;
}

const TEST_COVERAGE_RUBRIC: SeedSkill = {
  name: 'test-coverage-rubric',
  description:
    'Use when a diff adds or changes tests, or changes a function with branching logic. Enumerate every branch of the changed code and report the ones no test exercises, naming the branch.',
  type: 'rubric',
  body: `## test-coverage-rubric

For every function this diff adds or changes, list its branches BEFORE reading
the tests, then check each one off against the assertions the diff actually adds.

Enumerate a branch for each of:
- Each arm of every \`if\` / \`else if\` / \`else\`, ternary, and \`switch\` case
  (including the default / fall-through arm).
- Each short-circuit in a \`&&\` / \`||\` / \`??\` chain that can change the result.
- Each \`catch\` block, and each early \`return\` / \`throw\` guard.
- Each optional parameter or defaulted value, taken and not taken.
- For a loop: the zero-iteration case and the many-iteration case.

Report a finding when a branch has no test that reaches it. Name the branch by
file, line and condition — "the \`retries === 0\` arm at src/queue.ts:41 is never
exercised", never "coverage is incomplete".

A test only counts as exercising a branch if it ASSERTS on the result of taking
it. A test that runs the branch and then only asserts "did not throw" leaves it
uncovered; say so.

Severity: an unexercised error path, security decision, or data-writing branch
is CRITICAL. An unexercised branch on a cold or cosmetic path is a WARNING.`,
};

const EDGE_CASE_CHECKLIST: SeedSkill = {
  name: 'edge-case-checklist',
  description:
    'Use when a diff tests a function that takes collections, numbers, strings, dates or external input. Walk this checklist and report the boundary inputs the tests never pass in.',
  type: 'rubric',
  body: `## edge-case-checklist

Walk this checklist against every input of every function the diff changes, and
report the specific boundary values no test passes in.

**Collections** — empty array/map/set; exactly one element; duplicates; the
element that matches nothing; ordering when the input is unordered.

**Numbers** — zero; negative; the exact boundary of every comparison (if the code
says \`> limit\`, both \`limit\` and \`limit + 1\`); overflow of a counter; \`NaN\`
from a failed parse; floating-point money.

**Strings** — empty; whitespace-only; a value that needs escaping in whatever
sink it reaches; non-ASCII and multi-byte characters; a value longer than any
column, buffer or budget it is written to.

**Absence** — \`null\` vs \`undefined\` vs missing key vs empty string, wherever the
code distinguishes them. Explicitly check any use of \`||\` where \`??\` was meant:
if \`0\` or \`''\` is a legitimate value, the falsy default is a bug and the test
that would have caught it is the one passing \`0\`.

**Time and order** — the same input arriving twice; two operations racing; a
timestamp exactly on a boundary; a timezone other than the test machine's.

**Failure** — the dependency returns an error; the dependency times out; the
dependency returns a well-formed but unexpected shape.

Report one finding per genuinely missing case, and state the input you would
pass and what the assertion should be. Do not report a case the code cannot
reach — check the type and the guards first.`,
};

const MOCK_DISCIPLINE: SeedSkill = {
  name: 'mock-discipline',
  description:
    'Use when a diff adds tests that substitute dependencies. Flag mocks that make the test assert on its own setup instead of on real behaviour.',
  type: 'convention',
  body: `## mock-discipline

Substitute the things this codebase substitutes: adapters at the process
boundary (GitHub, LLM providers, git, ripgrep, the clock, randomness). Everything
inside the boundary — pure helpers, mappers, validators, the module under test's
own collaborators — should run for real.

Flag a test when:
- It mocks the very function it claims to test, so the assertion only proves the
  mock was configured.
- Its assertions are entirely \`expect(mock).toHaveBeenCalledWith(…)\` with no
  assertion on a returned value or an observable effect. Verifying a call is
  fine as a supplement; it is not evidence the behaviour is correct.
- The mock's return value is a shape the real dependency can never produce, so
  the test passes on data that will never occur in production.
- Mock setup is longer than the behaviour under test — a signal the unit is
  reaching through too many layers and the test is pinning the wiring, not the
  logic.
- A pure function is mocked. There is no reason to; use the real one.
- A mock is defined but its behaviour is never varied across tests — the happy
  path is the only path that exists.

Do NOT flag: substituting a network call, the system clock, \`Math.random\`, or a
database in a unit test. Those are the boundary and mocking them is correct.

Severity: a test whose assertions are entirely about mocks, for behaviour that
carries real risk, is CRITICAL — the suite is green on untested code. Excess
mocking that still leaves a real assertion in place is a WARNING.`,
};

/** Seeded in this order; the Test Quality Reviewer links them at order 0, 1, 2. */
export const SEED_SKILLS: readonly SeedSkill[] = [
  TEST_COVERAGE_RUBRIC,
  EDGE_CASE_CHECKLIST,
  MOCK_DISCIPLINE,
];

/**
 * L02 (second half) — the Conventions Extractor lesson's worked example of a
 * hand-authored agent + skills, matching the same "prompt holds role/output
 * conventions, skills hold the concrete rules" split as the Test Quality
 * Reviewer above. See `API_CONTRACT_REVIEWER_PROMPT` (seed-prompts.ts).
 */

const BREAKING_CHANGE: SeedSkill = {
  name: 'breaking-change',
  description:
    'Use when a diff changes or removes a route, an exported function signature, or any public field external callers depend on. Flag anything that breaks an existing caller with no compatible fallback in place.',
  type: 'convention',
  body: `## breaking-change

A change is breaking when an existing, unmodified caller would get a
different result (or an error) after the diff ships than before it. Check
every changed public surface — HTTP routes, exported functions/types, DB
columns other services read — against this list:

- A route, exported function, or field is **renamed or removed** with
  nothing left in its place for existing callers.
- A **required** parameter, field, or route segment is added — every
  existing caller that doesn't send it now fails.
- A field's **type is narrowed or changed** (e.g. \`string\` → \`'a' | 'b'\`,
  \`number\` → \`string\`) — a caller that accepted the old range breaks on the
  values it no longer covers.
- A **status code's meaning changes** for the same condition (e.g. a route
  that returned 200 with an empty array now returns 404 for "not found").
- An **enum's accepted values shrink**, or a previously-accepted input is
  now rejected.

**Bad** — renaming a response field in place, in one commit, with no
transition:
\`\`\`ts
// before: { full_name: string }
// after:  { fullName: string }   ← existing callers reading full_name break silently
\`\`\`

**Good** — add the new shape alongside the old one, deprecate the old field
(see \`deprecation-policy\`), remove it only in a major-bumped release:
\`\`\`ts
{ full_name: string, fullName: string }  // both present during the transition
\`\`\`

Report a finding for every breaking change the diff introduces, naming the
exact caller-visible difference (not "the API changed"). Severity: a
breaking change with no deprecation path and no version bump is CRITICAL; a
breaking change that IS versioned/flagged correctly (see \`semver-discipline\`)
is at most a WARNING, to confirm the bump actually happened.`,
};

const RESPONSE_SCHEMA: SeedSkill = {
  name: 'response-schema',
  description:
    "Use when a diff changes what a route or function returns — fields added, removed, renamed, retyped, or whose nullability/required-ness changed. Diff the response shape field by field, not just the route's happy path.",
  type: 'convention',
  body: `## response-schema

For every response shape (HTTP handler return, exported function's return
type) the diff touches, compare the OLD shape to the NEW one field by field —
not just "does it still compile", since a widened/narrowed type or a changed
nullability compiles fine on both sides while still breaking every consumer
of the old contract.

Flag:
- A field **present before is now absent or renamed** — this IS a
  \`breaking-change\`, cross-reference that skill.
- A field that was **always present becomes optional or nullable** — a
  caller that did \`response.score.toFixed(2)\` now throws on \`null\`.
- A field that was **optional/nullable becomes required/non-null** — a
  caller that omitted it, or checked for \`null\`, now gets a value shape it
  never validated against.
- An **array's item shape changes** without the array itself being replaced —
  every consumer iterating it breaks the same way for every item.
- A **numeric field changes precision or unit** silently (cents → dollars,
  ms → s) — same type, same nullability, wrong value.

**Bad** — widening a field's nullability with no version bump or caller
audit:
\`\`\`ts
// before
export const Score = z.object({ score: z.number() });
// after — a null score now reaches every existing caller unannounced
export const Score = z.object({ score: z.number().nullable() });
\`\`\`

**Good** — ship the nullable variant as a NEW field, or gate it behind a
version/flag, so existing callers keep receiving the non-null shape they
were built against:
\`\`\`ts
export const Score = z.object({ score: z.number(), score_v2: z.number().nullable() });
\`\`\`

Report one finding per field whose shape changed in a caller-visible way,
naming the field and the old vs. new type/nullability. Severity: a
required-to-optional or type-narrowing change with no compensating
deprecation/versioning is CRITICAL; a purely additive field (new, optional,
doesn't touch existing ones) is not a finding at all.`,
};

const SEMVER_DISCIPLINE: SeedSkill = {
  name: 'semver-discipline',
  description:
    "Use when a diff changes any public API surface and you need to judge which version bump it demands. Name the bump the change actually requires, and flag it when the PR's own version change (or changelog) doesn't match.",
  type: 'convention',
  body: `## semver-discipline

Classify every public-API change in the diff into exactly one bucket, then
check the PR's actual version bump / changelog entry against it:

- **PATCH** — internal fix with no observable shape change: same endpoints,
  same fields, same types, same required-ness. Behavior corrected, contract
  unchanged.
- **MINOR** — purely additive and backward-compatible: a new optional field,
  a new endpoint, a new optional query parameter, a new enum value a caller
  can safely ignore if it doesn't know about it yet.
- **MAJOR** — anything an existing, unmodified caller can observe as a
  break: a removed/renamed field or endpoint, a field that became required,
  a narrowed type, a changed status code or error shape, a shrunk enum.
  Cross-reference \`breaking-change\`/\`response-schema\` for the concrete
  patterns.

**Bad** — a new REQUIRED request field shipped as a minor/patch bump:
\`\`\`ts
// v1.4.1 (patch) adds a REQUIRED field — every existing caller now gets a 400
export const CreateOrder = z.object({ sku: z.string(), warehouseId: z.string() });
\`\`\`
This needed a MAJOR bump (or the field needed to be optional).

**Good** — the same field shipped optional in a minor release, made
required only in the next major with a migration note:
\`\`\`ts
// v1.5.0 (minor): warehouseId optional, defaults to the primary warehouse
export const CreateOrder = z.object({ sku: z.string(), warehouseId: z.string().optional() });
\`\`\`

Report a finding whenever the diff's actual version/changelog bump is lower
than what the change demands (a breaking change shipped as minor/patch).
Don't flag a correctly-major-bumped breaking change — that's the classifier
working, not a defect. Severity: a breaking change shipped as patch or minor
is CRITICAL (it will surprise every caller pinned to that range); an
ambiguous case worth a human's judgment call is a WARNING.`,
};

const DEPRECATION_POLICY: SeedSkill = {
  name: 'deprecation-policy',
  description:
    'Use when a diff removes a field, endpoint, or parameter outright instead of deprecating it first. Flag any silent removal and require a documented deprecation window before it disappears.',
  type: 'convention',
  body: `## deprecation-policy

A public field, endpoint, or parameter that's no longer wanted gets
deprecated BEFORE it gets removed — never both in the same diff. Check every
removal in the diff for a prior deprecation step:

- Was it marked deprecated first (doc comment, \`deprecated: true\` in the
  schema, a response header, an OpenAPI/changelog entry) in an EARLIER,
  already-shipped change — not this same diff?
- Did the deprecated period actually have TIME to be observed by callers (at
  least one release), not just a comment added and removed in the same PR?
- Is there a stated removal target (a version, a date, or "after usage hits
  zero") rather than an open-ended "eventually"?
- For a removed field: is the OLD field still populated (dual-write/dual-read)
  during the deprecation window, or does the deprecation notice appear
  alongside the field already being silently unpopulated?

**Bad** — deleting a route outright in one commit, no prior notice:
\`\`\`ts
// This PR: route existed and worked yesterday, gone today.
app.delete('/pulls/:id/legacy-report', ...) // ← removed, no deprecation ever existed
\`\`\`

**Good** — mark it deprecated first (a real, shipped, observable step), keep
it functional through the window, remove only once the diff can point back
at that prior deprecation:
\`\`\`ts
/** @deprecated since v2.3 — use GET /pulls/:id/report instead. Removed in v3.0. */
app.get('/pulls/:id/legacy-report', ...)
\`\`\`

Report a finding for any removal in the diff with no prior deprecation step
to point to. Severity: removing something with live callers and zero notice
is CRITICAL; removing something already properly deprecated and past its
stated window is not a finding — that's the policy working as intended.`,
};

/** Seeded in this order; the API Contract Reviewer links them at order 0-3. */
export const API_CONTRACT_SKILLS: readonly SeedSkill[] = [
  BREAKING_CHANGE,
  RESPONSE_SCHEMA,
  SEMVER_DISCIPLINE,
  DEPRECATION_POLICY,
];
