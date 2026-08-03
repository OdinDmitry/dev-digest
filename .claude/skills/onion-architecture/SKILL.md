---
name: onion-architecture
description: "Onion Architecture for the backend packages (server/ and reviewer-core/) — decides WHICH RING code belongs to and which direction imports may point. Use this skill whenever backend work touches placement or dependency direction: adding a route, service, repository or adapter; creating a new module under server/src/modules/; wiring something into the DI container; deciding whether business logic goes in routes.ts, service.ts or repository.ts; introducing a new external tool (LLM, GitHub, git, search, embeddings) and needing a port; or asking 'can this file import drizzle/fastify?', 'where does this query belong?', 'should this be an adapter?'. Trigger it also when reviewing a backend diff that adds files, moves code between layers, or imports drizzle-orm/fastify/db-schema in a new place. Not for the Next.js client — that is frontend-ui-architecture."
version: 1.0.0
metadata:
  tags: architecture, onion, hexagonal, ports-and-adapters, backend, fastify, drizzle, dependency-direction, layering
  last-reviewed: 2026-08-03
---

# Onion Architecture (backend)

Answers one question: **which ring does this code belong to, and what may it import?**

Scope: `server/` and `reviewer-core/` only. The Next.js client is covered by
`frontend-ui-architecture`; `e2e/` is out of scope.

Scope boundary — this skill does not repeat what the sibling backend skills own:

| Question | Skill |
|----------|-------|
| Which ring does this belong to? What may it import? | **this skill** |
| How do I write this route/plugin/hook correctly? | `fastify-best-practices` |
| How do I write this query/schema/migration? | `drizzle-orm-patterns` |
| How should this table be designed? | `postgresql-table-design` |
| How should this schema be written? | `zod` |

Companion files — read when the question goes deeper than the rules below:

- `layers.md` — the five rings in full: what lives in each, naming, DTOs and mappers, module anatomy
- `tooling.md` — how Fastify, Drizzle, Zod, the DI container and Vitest are used *in service of* the rings
- `review-checklist.md` — what to check on a backend diff, and the known accepted violations
- `README.md` — every source behind these rules, tiered

---

## The one rule everything else derives from

**All coupling points inward. An outer ring may depend on any inner ring; an inner ring
must not know that the outer ring exists.**

The core is compiled, understood and tested without Fastify, without Drizzle, without
Postgres, without the network. When an outer tool must be called from inside, the *inner*
ring declares an interface (a port) and the *outer* ring implements it — the dependency
arrow is inverted, and the core still knows nothing but its own interface.

The practical test, applied to any file you are about to write: **list its imports. If any
of them names a technology, and this file is not an adapter, the file is in the wrong
ring** — or the import is.

---

## The five rings in this repository

From the centre outward. Each ring may import everything above it in this table, and
nothing below it.

| # | Ring | Lives in | May import |
|---|------|----------|------------|
| 0 | **Domain** | `reviewer-core/src/**`, `shared/contracts/**` (vendored as `src/vendor/shared/contracts`) | Zod, pure TS. Nothing else. |
| 1 | **Ports** | `shared/adapters.ts` (`LLMProvider`, `GitHubClient`, `GitClient`, `CodeIndex`, `Embedder`, `SecretsProvider`, `AuthProvider`) | ring 0 |
| 2 | **Application services** | `server/src/modules/<domain>/service.ts` (+ `helpers.ts`, `constants.ts`) | rings 0–1, and repository classes as described below |
| 3 | **Adapters** | `server/src/adapters/**`, `server/src/db/**`, `server/src/modules/<domain>/repository*.ts`, most of `server/src/platform/**` | rings 0–2 |
| 4 | **Delivery + composition root** | `server/src/modules/<domain>/routes.ts`, `modules/_shared/context.ts`, `app.ts`, `platform/container.ts` | everything |

Two consequences worth stating out loud, because they are the ones that get violated:

- **Ring 2 has no technology imports.** A `service.ts` that imports `fastify` has put HTTP
  in the core; a `service.ts` that imports `drizzle-orm` or `db/schema.js` has put SQL in
  the core. Both are bugs regardless of how convenient the shortcut was.
- **Ring 4 is not allowed to skip rings.** A route handler that runs a query has collapsed
  rings 2 and 3 into ring 4, and the use case now exists only inside an HTTP handler —
  untestable without a server, unreachable from a job or a CLI.

`reviewer-core` is the reference implementation of ring 0: no database, no GitHub, no
filesystem, and its single side effect goes through an injected `LLMProvider`. When you
are unsure what a pure core looks like, read that package.

---

## Import rules, concretely

These are the checks worth running by eye on every backend diff. `review-checklist.md`
has the full list; these four catch most of it.

| Import | Allowed only in |
|--------|-----------------|
| `fastify`, `fastify-type-provider-zod`, `@fastify/*` | `routes.ts`, `app.ts`, `modules/index.ts`, `modules/_shared/context.ts` |
| `drizzle-orm`, `../../db/schema.js` | `db/**`, `modules/*/repository.ts`, `modules/*/repository/*.ts` |
| `db/rows.js`, `typeof table.$inferSelect` | `db/**` and repositories — **never crosses into `service.ts` or `routes.ts`** |
| `octokit`, `simple-git`, `openai`, `@anthropic-ai/sdk`, `@ast-grep/napi`, `@vscode/ripgrep` | `adapters/<name>/*` only, behind the matching port |

The fourth row is the one that keeps future tool swaps cheap: every one of those SDKs is
already hidden behind an interface in `shared/adapters.ts`, and a service that imports the
SDK directly silently deletes that guarantee.

---

## Module anatomy

A domain module under `server/src/modules/<name>/` is a **vertical slice that still has
horizontal rings inside it**. The canonical file set:

```
modules/<name>/
├── routes.ts        # ring 4 — one Fastify plugin: parse → call service → return DTO
├── service.ts       # ring 2 — the use cases; no HTTP, no SQL
├── repository.ts    # ring 3 — the only file in the module that touches the DB
├── helpers.ts       # ring 2 — pure transforms (row→DTO mappers, parsing, formatting)
└── constants.ts     # ring 2 — literals: job kinds, secret keys, limits
```

Split `repository.ts` into a `repository/` folder of per-aggregate files when it outgrows
one file — `modules/reviews/` already does this and keeps the class as the composing
facade, which is the pattern to copy.

**A module consisting only of `routes.ts` is not a module.** If the slice is genuinely
trivial — one read query, no rules — it still gets a `service.ts` and a `repository.ts`;
they are short, and the next requirement lands in the right place instead of growing
inside an HTTP handler. Four current modules (`pulls`, `polling`, `settings`, `workspace`)
predate this rule and violate it; see the accepted-violations section below.

New modules must also be registered the same way as the existing ones — a Fastify plugin
per domain, autoloaded — not mounted ad hoc from `app.ts`.

---

## Dependencies of a service

**New services take explicit dependencies. Existing ones keep taking `Container`.**

This is a deliberate, documented split. The four current services (`reviews`, `repos`,
`agents`, `repo-intel`) are constructed as `new XService(container)` and read whatever they
need off it. That is a service locator: the constructor signature says nothing about what
the service actually uses, the inner ring holds a reference to the composition root, and a
unit test has to build a whole container to exercise one method. It works, it is not worth
a breaking refactor right now, and it is grandfathered.

Everything written from now on declares what it needs:

```ts
// ring 2 — the dependency list *is* the documentation
export interface PullServiceDeps {
  repo: PullRepository;
  github: GitHubClient;      // the port, never OctokitGitHubClient
}

export class PullService {
  constructor(private deps: PullServiceDeps) {}
}
```

`Pick<Container, 'github' | 'secrets'>` is an acceptable shorthand for the interface when
the deps are all container-provided. What is not acceptable is `container: Container`.

The wiring stays where it already is: `platform/container.ts` is the **composition root**,
the one place allowed to name concrete adapter classes, and `app.ts` decorates the instance
onto Fastify. Nothing else constructs an adapter.

Repositories are ring-3 driven adapters, but a service may depend on the **concrete
repository class** rather than an interface. Extract an interface only when a second
implementation genuinely appears. The rule that matters is not the interface — it is that
repository methods speak the domain's language and return contract types, so the service
never learns which database is underneath.

---

## What crosses each boundary

Data changes shape as it moves inward and outward. Three distinct type families, and they
are not interchangeable:

- **Row types** (`db/rows.ts`, `$inferSelect`) — the shape of a table. Die at the
  repository boundary.
- **Contracts** (`@devdigest/shared`, Zod) — the shape of the domain and of the API. The
  language rings 0–2 speak, and the format on the wire.
- **DTOs** (`ReviewDto`, `reviewToDto` in `modules/reviews/helpers.ts`) — the response
  shape when it differs from the contract. Built by pure mappers in `helpers.ts`.

The mapping row→contract/DTO belongs to the repository or to `helpers.ts`, never to the
route. See `layers.md` for the full table and `tooling.md` for how Zod contracts double as
the anti-corruption layer against GitHub and LLM payloads.

---

## Ports: when to add one

Add a port when the core needs an effect the outside world performs. The sequence, in this
order:

1. Define the interface in `shared/adapters.ts` — in domain vocabulary, describing the
   *capability*, not the SDK. Re-sync the vendored copies (`*/src/vendor/shared`) — they
   are copied, not linked.
2. Implement it in `server/src/adapters/<name>/<impl>.ts`. The SDK import appears here and
   nowhere else.
3. Wire it in `platform/container.ts`.
4. Add the mock in `adapters/mocks.ts` so ring 0–2 tests stay hermetic.

If a capability is used in exactly one adapter and never called from a service, it does not
need a port — do not add an interface with a single implementation and a single caller
just to have one. Onion asks for inverted dependencies at the boundary, not for an
interface per class.

---

## Where the side effects go

- **Transactions** are owned by the service, not the repository. The service opens the
  transaction and passes the handle into repository methods, so one use case can span
  several repositories atomically. Details in `tooling.md`.
- **Jobs** (`platform/jobs.ts`): the handler is registered by the service, and its body is
  a service method. A job is another way to enter a use case — like HTTP — so it must not
  contain logic that HTTP cannot also reach.
- **Errors**: adapters and repositories translate driver/SDK failures into
  `platform/errors.ts` types (`AppError`, `NotFoundError`, `ValidationError`,
  `ExternalServiceError`, `ConfigError`). A Postgres error code or an Octokit error must
  not reach a service — that is the persistence layer leaking through a different door.
- **Secrets** go through `SecretsProvider`, never `process.env` in a service — the single
  read chokepoint is `adapters/secrets/local.ts`.

---

## Testing follows the rings

The rings are what make the test split cheap, and the split is already in place:

- Rings 0–2 — hermetic unit tests against `adapters/mocks.ts`. No database, no network.
  If a service cannot be tested this way, it has a technology dependency it should not have.
- Ring 3 — integration tests, `*.it.test.ts` suffix (this drives the unit/integration split
  in CI). Real Postgres via testcontainers; real adapter, contract-level assertions.
- Ring 4 — thin. A route with nothing but parse/delegate/map needs little of its own.

---

## Accepted violations (do not "fix" these silently)

Known and deliberately grandfathered. Do not extend them; do not clean them up as a
drive-by inside an unrelated change either — each is its own piece of work.

1. **`pulls`, `polling`, `settings`, `workspace` run Drizzle queries inside `routes.ts`.**
   Ring 4 reaching ring 3 directly — none of these four modules has a repository at all, and
   `settings/feature-models.ts` queries outside a repository for the same reason. New
   modules must not copy this. When you touch one of these files substantially, extracting
   the query into a repository plus a service method is the right move — as a deliberate
   change, not a silent one.
2. **The four existing services take `Container`.** Grandfathered, as described above.
   New services take explicit deps.
3. **Row types appear in ring-2 signatures in the `reviews` and `repos` modules.**
   `AgentRow` in `reviews/service.ts` and `run-executor.ts`; `typeof schema.repos.$inferSelect`
   as a parameter type in `run-executor.ts`, `diff-loader.ts` and `repos/helpers.ts`.
   Replace with contract types when that code is next reworked — and do not add new ones.

This skill currently describes the rules only — there is no `dependency-cruiser` config
and no `pnpm arch` script wired up, so enforcement is by review. `review-checklist.md` is
what to run your eye down; the tooling to automate it later is noted in `README.md`.

---

## Quick decision table

| Situation | Ring | File |
|-----------|------|------|
| Validating and shaping an HTTP request | 4 | `routes.ts`, via the zod `schema:` option |
| Deciding *whether* something may happen | 2 | `service.ts` |
| A SQL query, in any form | 3 | `repository.ts` |
| Calling GitHub / an LLM / git / ripgrep | 3, behind a ring-1 port | `adapters/<name>/*` |
| Turning a row into an API shape | 2 | `helpers.ts` (pure) |
| Prompt assembly, grounding, diff reasoning | 0 | `reviewer-core/src/**` |
| A Zod contract shared with the client | 0 | `shared/contracts/**` + re-sync vendor copies |
| Constructing an adapter | 4 | `platform/container.ts`, nowhere else |
| A job handler's body | 2 | `service.ts` (registered from the service) |
| A literal: job kind, secret key, limit | 2 | `constants.ts` |
