# specs/ — Development Plans

Cross-module Development Plans produced by the `planner` agent before
implementation begins — plans that span more than one package (`server`,
`client`, `reviewer-core`, `e2e`). A plan that is scoped to a single module
belongs in that module's own `specs/` instead
([server/specs](../server/specs/README.md),
[client/specs](../client/specs/README.md)).

One file per plan (`0001-<slug>.md`, …), consumed by the `implementer` agent
as its single source of truth for that task. Once a plan ships, fold
anything still true into the relevant module's `CLAUDE.md`/`docs/` and
archive or delete the plan file. Empty for now.
