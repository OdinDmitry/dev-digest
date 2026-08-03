# The tools, in service of the rings

How each backend tool is used so that the dependency direction survives contact with it.
This file is about *architecture with* these tools — how to write a good route, query or
schema belongs to `fastify-best-practices`, `drizzle-orm-patterns` and `zod`.

---

## Fastify — the delivery adapter

Fastify occupies ring 4 and must not be visible from anywhere else.

**A plugin per domain is the boundary.** Each `modules/<name>/routes.ts` exports one
autoloaded plugin. Fastify's encapsulation context means a plugin inherits from its parents
but stays isolated from its siblings — so a hook, decorator or schema registered inside one
domain does not silently affect another. Reach for `fastify-plugin` only when something
genuinely must escape upward into the parent context; wrapping a domain plugin with it
deletes the isolation that makes modules independent.

**The container arrives by decorator.** `app.decorate('container', container)` in `app.ts`
is the DI seam: Fastify's decorator system is the lightweight injection mechanism, and it
is why no module needs a singleton or a module-level `new`. Route files read
`app.container` and construct their service from it. Nothing else constructs adapters.

**Handlers stay thin.** The four steps from `layers.md` — schema, context, one service call,
map to DTO. Concretely:

```ts
// ring 4 — no rules, no queries, no assembly
app.post('/pulls/:id/review', { schema: { params: IdParams } }, async (req) => {
  const ctx = await getContext(container, req);
  return service.runReview(ctx, req.params.id, req.body);
});
```

**Validation is declarative.** Schemas go in the route's `schema:` option via
`fastify-type-provider-zod` — never `Schema.parse(req.body)` inside the handler body. The
declarative form makes the contract part of the route definition (and serialisable), while
a hand-rolled parse hides it in imperative code and drifts from the response type.

**Hooks are cross-cutting only** — auth, tenancy, logging, rate limits. A hook containing a
business rule is a use case that no job or CLI can ever reach.

**Errors travel as types, not status codes.** Services throw `NotFoundError`; a single
error handler maps `AppError` subclasses to responses. A service that knows the number 404
knows about HTTP.

---

## Drizzle — the persistence adapter

Drizzle is powerful precisely because it is thin and close to SQL, which is exactly why it
must stay behind the repository boundary: its types and its query builder are the database's
shape, not the domain's.

**Repository methods speak the domain.** `findPendingRunsFor(workspaceId)`, not
`selectRunsWhereStatus('pending')`. The rename is not cosmetic — it is what lets the query
change without every caller changing.

**Never return a query builder.** Returning `db.select().from(...)` for the caller to
refine hands Drizzle's API to ring 2 and makes the boundary decorative. Return resolved
data.

**Three type families, kept separate.** Row types (`$inferSelect`, `db/rows.ts`) are
internal to the repository; contracts (`@devdigest/shared`) are what rings 0–2 speak; DTOs
are what the API returns. The row→contract mapping happens in the repository or in a pure
mapper in `helpers.ts`. This is the single most common leak in ORM-backed codebases, and
the one accepted violation in this repo (`AgentRow` in `reviews/service.ts`) is an instance
of it.

**Transactions belong to the service, not the repository.** A use case that writes through
two repositories must be able to wrap both. So the transaction handle is opened by ring 2
and passed *into* repository methods:

```ts
// ring 2 — the use case owns the boundary
await this.db.transaction(async (tx) => {
  await this.reviews.insertReview(review, tx);
  await this.runs.markComplete(runId, tx);
});

// ring 3 — accepts an optional executor, defaults to the pool
async insertReview(review: Review, tx: Executor = this.db) { … }
```

A repository that opens its own transaction per method cannot participate in a larger one,
and the alternative — a repository method that performs the whole multi-aggregate use case —
is business logic in ring 3. Note that a service holding a `db` handle purely to open a
transaction is the one legitimate reason for ring 2 to see it; it must not run queries with
it.

**Driver errors are translated here.** A unique-violation error code becomes a
`ValidationError`; a missing row becomes `NotFoundError`. Postgres error codes must not
reach a service.

**Migrations are not run on boot** — `pnpm db:migrate`. Schema files live one per domain in
`db/schema/`, and the unused future-lesson tables stay as they are.

---

## Zod — the language of the boundaries

Zod plays two architectural roles, and it is worth naming both.

**1. The shared contract.** `shared/contracts` defines `Review`, `Finding`, `Verdict`,
`RunEvent` once, and every package derives its types from them. This is what lets a service
return a domain object that the client already understands with no translation layer, and
what makes ring 0 typed without any framework.

**2. The anti-corruption layer.** Everything entering the system is untrusted and
differently-shaped: HTTP bodies, GitHub API payloads, and — most importantly — LLM output.
Parsing at the edge means the inside deals in known types only:

- HTTP → the route's `schema:` option.
- GitHub → the adapter parses the payload into the port's declared types; the raw Octokit
  response never travels inward.
- LLM → `reviewer-core`'s `toJsonSchema()` / `extractJson()` / `parseWithRepair()`, then
  `groundFindings()` as the semantic gate on top of the structural one. A model response is
  the least trustworthy input in the system, and it gets both.

**Parse once, at the edge.** A schema re-parsed in ring 2 means ring 2 does not trust its
caller, which means the boundary is unclear. Deeper in, types are already guaranteed.

Contracts live in ring 0 and are **copied** into each package's `src/vendor/shared` — a
contract change must be re-synced into every vendor copy by hand.

---

## The DI container — the composition root

`platform/container.ts` is the only file that names concrete adapter classes. Everything
else asks for an interface.

```ts
// ring 4 — the wiring, and only the wiring
this.llm = config.llmProvider === 'anthropic'
  ? new AnthropicProvider(secrets)
  : new OpenAIProvider(secrets);
```

**It stays a wiring file.** Provider selection driven by config is wiring; a rule about
*when* a review may run is not, and belongs in a service. The container is also where
`ContainerOverrides` lets tests substitute mocks wholesale — which only works as long as
nothing constructs its own adapters behind the container's back.

**Services declare their needs** (see `SKILL.md`): new services take an explicit deps
interface or `Pick<Container, …>`; the four existing ones keep taking `Container` as a
documented exception.

**Ports, not implementations, in type positions.** `private github: GitHubClient` — a field
typed `OctokitGitHubClient` is the dependency arrow pointing outward again, in a place that
type-checks perfectly.

---

## Vitest — testing along the rings

The ring a piece of code lives in determines how it is tested, and the split already exists
in the repo:

| Ring | Test style | Suffix |
|------|-----------|--------|
| 0 — domain | pure, stubbed `LLMProvider` | `*.test.ts` |
| 1–2 — ports, services | hermetic, `adapters/mocks.ts` | `*.test.ts` |
| 3 — adapters, repositories | real Postgres via testcontainers | `*.it.test.ts` |
| 4 — routes | thin; a smoke test per plugin at most | either |

**The suffix is load-bearing** — `*.it.test.ts` drives the unit/integration split in CI, so
anything DB-backed must use it and everything else must stay hermetic.

**A service that cannot be tested without a database is a design signal**, not a testing
problem: it means a query, an SDK call or a container reference got into ring 2. The fix is
to move it out, not to make the test heavier.

---

## dependency-cruiser — available, deliberately not wired

`dependency-cruiser` is already a runtime dependency of `server/` — it powers the
`DepCruiseGraph` adapter for repo-intel, not architecture checks. That means adding layer
enforcement later would need no new dependency, only a config and a script.

Right now this skill **describes** the rules; enforcement is by review
(`review-checklist.md`). If we automate it later, note that four modules currently violate
rule 1 in `SKILL.md`, so any config lands together with either a fix or an explicit
allowlist. Sources for both tooling options are in `README.md`.
