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

/** Seeded in this order; the agent links them at order 0, 1, 2. */
export const SEED_SKILLS: readonly SeedSkill[] = [
  TEST_COVERAGE_RUBRIC,
  EDGE_CASE_CHECKLIST,
  MOCK_DISCIPLINE,
];
