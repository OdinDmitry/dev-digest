# docs/plans — Development Plans

**How** we build something. Produced by the `implementation-planner` agent
from a spec in [../specs/](../specs/README.md), consumed by `implementer` as
its single source of truth for that task, then checked by `plan-verifier`.

A plan names exact files, layers, patterns and skills — the implementation
detail a spec deliberately leaves out. If you are looking for *what* we are
building and *why*, that is a spec, not a plan.

## Layout

```
docs/plans/
  YYYY-MM-DD-<feature-slug>.md      cross-module plans
  <module>/YYYY-MM-DD-<slug>.md     single-module plans (client, server, …)
```

Every plan states the spec it implements (`Spec: docs/specs/…`) and maps each
task to an owner, an acceptance criterion and a test:

```
- [ ] T1 analyzeRepo: stack, structure, routes — owner: `implementer`  → AC-1 → test_facts
- [ ] T2 test_facts — owner: `test-writer`                             → AC-1 → test_facts
```

`owner:` is `implementer` (implementation code) or `test-writer` (every new
test file — `implementer` authors none). A test named in the traceability
table that does not exist yet needs its own `test-writer` task, or the
criterion ships unproven.

`## Verification` is split in two: a **Fast loop** (`pnpm typecheck` +
`pnpm test:unit --reporter=dot`) run per step by `implementer` and
`test-writer`, and a **Full** block — including the Docker-backed
`pnpm test:integration` — run once at the end by `plan-verifier`.

Files numbered `000N-*.md` predate this convention — they were written when
plans lived in a root `specs/` folder and no spec layer existed. Left as-is;
new plans use the dated naming.

## Lifecycle

Once a plan ships, fold anything still true into the owning module's
`CLAUDE.md`/`docs/`, then archive or delete the plan file.
