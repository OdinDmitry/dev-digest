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
task to an acceptance criterion and a test:

```
- [ ] T1 analyzeRepo: stack, structure, routes  → AC-1 → test_facts
```

Files numbered `000N-*.md` predate this convention — they were written when
plans lived in a root `specs/` folder and no spec layer existed. Left as-is;
new plans use the dated naming.

## Lifecycle

Once a plan ships, fold anything still true into the owning module's
`CLAUDE.md`/`docs/`, then archive or delete the plan file.
