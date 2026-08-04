---
name: flake-radar
description: Use when a diff adds or changes tests that touch time, ordering, shared state, the network or randomness. Report the specific source of non-determinism and the deterministic substitute.
type: rubric
---

## flake-radar

A flaky test is worse than no test: it trains the team to re-run CI instead of
reading it. Read every added or changed test for a reason it could fail on a run
where nothing changed, and name that reason.

**Time** — `Date.now()`, `new Date()` or a real timer inside the assertion path;
a timeout racing real work; an assertion on elapsed duration; anything that
behaves differently near midnight, across a DST boundary, or in a timezone other
than the test machine's. Substitute: inject the clock, or freeze it.

**Ordering** — asserting on the order of `Object.keys`, a `Set`, a `Map` built
from concurrent writes, a `Promise.all` result mapped back by index, or rows
from a query with no `ORDER BY`. Substitute: sort before asserting, or assert on
membership rather than sequence.

**Shared state** — a module-level array, cache, counter or singleton mutated by
one test and read by another; a database row a sibling test also writes; an
`afterEach` that cleans up only on the happy path. Substitute: build fixtures
per test and clean up in a `finally`.

**Network and subprocesses** — a real HTTP call, a git clone, or a spawned binary
in a unit test. These fail on a plane and hang in CI. Substitute: the adapter
interface the codebase already defines for that boundary.

**Randomness** — `Math.random()`, a generated uuid or a random port reaching an
assertion. Substitute: a seeded generator, or assert on the shape rather than the
value.

**Concurrency** — `await` inside a loop that the code under test runs in
parallel; two tests sharing a port or a temp directory; an assertion that runs
before an unawaited promise settles.

Report one finding per distinct source, cite the exact line, and give the
deterministic substitute. Severity: a test that can fail on unchanged code is a
WARNING; one that can also pass on broken code (a race that hides the assertion)
is CRITICAL.
