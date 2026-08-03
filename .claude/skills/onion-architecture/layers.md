# The rings in full

Read this when `SKILL.md`'s table is not enough to place a specific file — or when a slice
does not obviously fit the standard module anatomy.

---

## Ring 0 — Domain

**Where:** `reviewer-core/src/**`, `shared/contracts/**` (vendored into each package as
`src/vendor/shared/contracts`).

**What belongs here:** the rules that would still be true if the product had no HTTP API
and no database. In this repository that is: prompt assembly, the grounding gate, structured
LLM output parsing and repair, map-reduce over a large diff, the verdict/score model, and
the Zod contracts describing `Review`, `Finding`, `Verdict`, `RunEvent`.

**What may it import:** Zod, and pure TypeScript. That is the entire list.

**The purity rule stated exactly:** no database, no network, no filesystem, no clock-driven
behaviour you cannot inject. `reviewer-core`'s single side effect is an LLM call through an
injected `LLMProvider` — the package receives the provider, it never constructs one.
`llm/openrouter.ts` lives inside the package but is an adapter implementing the port, and
is exported for the composition root to wire; core logic imports the interface.

**Why it is worth defending:** this is the package that a future CI runner reuses without
carrying Fastify and Postgres with it. Every technology import added here costs that.

**Tests:** hermetic, stubbed `LLMProvider`. If a test here needs a container, something has
moved into the wrong ring.

---

## Ring 1 — Ports

**Where:** `shared/adapters.ts`.

**What belongs here:** the interfaces through which the core reaches the outside world —
`LLMProvider`, `Embedder`, `GitHubClient`, `GitClient`, `CodeIndex`, `AuthProvider`,
`SecretsProvider`, plus their payload types (`CompletionRequest`, `UnifiedDiff`,
`CodeMatch`, …).

**The naming rule:** a port is named for the capability, not the vendor. `GitHubClient`,
not `OctokitWrapper`; `CodeIndex`, not `RipgrepSearch`. If the interface's method names
mirror an SDK's method names one-for-one, it is a wrapper rather than a port, and swapping
the tool will still break every caller.

**Where ports live, and why here:** strictly, the inner ring should own its ports. In this
repository they sit in the shared contracts package, which is *copied* into every package
rather than published — so the core still compiles standalone and no dependency arrow
points outward. This is the pragmatic placement described in Herberto Graça's treatment
(ports declared by the application layer, not the domain entities). It is fine; do not
"fix" it by moving interfaces next to their implementations, which would invert the arrow
for real.

**The vendoring gotcha:** `shared/` is copied into `*/src/vendor/shared/`, not npm-linked.
A port change must be re-synced by hand into each vendor copy or the packages disagree at
the type level.

---

## Ring 2 — Application services

**Where:** `modules/<domain>/service.ts`, plus `helpers.ts` and `constants.ts`.

**What belongs here:** use cases. "Add a repo", "run a review", "act on a finding",
"reap stale runs". A service orchestrates: it fetches through repositories and ports, calls
into ring 0 for the actual reasoning, decides what is allowed, sequences the writes, and
returns contract types.

**What does not belong here:**

- HTTP — no `FastifyRequest`, no status codes, no header handling. A service throws
  `NotFoundError`; mapping that to 404 is ring 4's job.
- SQL — no `drizzle-orm`, no `db/schema.js`, no `container.db`. If you need a query that
  does not exist, add a repository method.
- Concrete adapters — depend on `GitHubClient`, never on `OctokitGitHubClient`.
- Row types — `AgentRow`/`FindingRow` in a service signature means the table shape is now
  part of the use case's contract.

**Size guidance:** when a service outgrows one file, split by use case into siblings and
keep the class as the public surface — `modules/reviews/` does exactly this with
`run-executor.ts`, `findings.ts`, `diff-loader.ts`. Splitting by "type of thing" instead of
by use case just spreads one flow across more files.

**`helpers.ts`** holds pure functions only: `parseRepoUrl`, `withGitHubToken`,
`reviewToDto`, `findingRowToDto`. Pure means: same input, same output, no I/O, trivially
testable. It is the natural home for row→DTO mapping, which is why mapping never needs to
happen in a route.

**`constants.ts`** holds the literals that both the service and its callers must agree on —
job kinds (`CLONE_JOB_KIND`, `INDEX_JOB_KIND`), secret keys, limits. A string literal
duplicated across two modules is a constant that has not been extracted yet; a constant
imported across modules is fine when it is genuinely one concept (`repos/service.ts`
importing `repo-intel`'s job kinds to enqueue work is the existing, acceptable pattern).

---

## Ring 3 — Adapters

Three distinct kinds of adapter live in this ring. All of them are *driven*: the
application calls them, never the reverse.

### Repositories — `modules/<domain>/repository.ts`

The only files in a module allowed to touch the database. Rules:

- **Method names are domain operations, not database operations.** `workspaceIdFor(repoId)`
  and `updateClonePath(repoId, path)` — not `selectWhere(...)` or `updateColumns(...)`.
  Paul Serban's formulation: prefer `activateAccount` to `updateColumns`.
- **Return contract types or narrow projections; never Drizzle query builders.** Returning
  a builder makes the caller's behaviour depend on Drizzle's API and defeats the boundary
  entirely.
- **Accept a transaction handle** when the caller needs atomicity across repositories — see
  `tooling.md`.
- **Translate driver errors** into `platform/errors.ts` types at this boundary.
- Row types are the repository's internal vocabulary. They may appear in its own signatures
  where the module already does so, but they must not be re-exported into ring 2 as the
  primary shape of a use case's input or output.

Split into `repository/<aggregate>.repo.ts` when it grows, composing them behind the class,
as `modules/reviews/` does.

### Infrastructure adapters — `src/adapters/<name>/*`

One folder per port, implementations inside: `github/octokit.ts`, `git/simple-git.ts`,
`llm/openai.ts`, `llm/anthropic.ts`, `codeindex/ripgrep.ts`, `embedder/openai.ts`,
`secrets/local.ts`, `auth/local.ts`, `depgraph/`, `astgrep/`, `tokenizer/`.

The vendor SDK import appears **only** here. An adapter's job is to satisfy the port's
contract and absorb everything vendor-specific: pagination, retries, error shapes, rate
limit headers, payload translation. `adapters/mocks.ts` holds the test doubles and is part
of the same ring.

### Platform — `src/platform/*`

Cross-cutting infrastructure: `jobs.ts` (queue), `sse.ts` (event bus), `config.ts` (env),
`resilience.ts`, `run-logger.ts`, `price-book.ts`, `model-router.ts`. Services may use
these; nothing here may reach back into a specific module's internals.

`platform/errors.ts` is the exception to the ring assignment — it is a shared vocabulary
consumed by every ring, and depends on nothing. Treat it as ring 0-adjacent.

---

## Ring 4 — Delivery and composition root

**Where:** `modules/<domain>/routes.ts`, `modules/_shared/context.ts`, `app.ts`,
`platform/container.ts`.

**A route handler does four things and nothing else:**

1. declare its zod `params`/`body`/`response` schemas (via `fastify-type-provider-zod`);
2. resolve tenancy through `getContext(container, req)` — so workspace scoping is never
   forgotten;
3. call one service method;
4. map the result to the response DTO.

Any `if` that encodes a business rule, any loop that assembles domain state, and any query
belongs one ring in. The honest test: **could this use case be triggered by a job or a CLI
without copying code?** If not, it is stranded in the HTTP layer.

**`container.ts` is the composition root** — the single place that knows concrete classes,
reads config to choose between adapters (`OpenAIProvider` vs `AnthropicProvider` vs
`OpenRouterProvider`), and holds the wiring. It legitimately imports from every ring; that
is what a composition root is for, and it is why it must stay a wiring file and never
acquire logic of its own.

---

## Vertical slices and horizontal rings

The two are not in conflict, and the repository already uses both: `modules/<domain>/` is a
vertical slice (a bounded context — one domain's routes, use cases and persistence
together), and inside it the files are the horizontal rings. This is the same structure the
Domain-Driven Hexagon reference uses: modules first, layers inside them.

**Cross-module rules:**

- Prefer not to import another module's `service.ts` from a service. It couples two slices
  and makes the call graph hard to follow.
- The existing acceptable form of cross-module work is **enqueueing a job** — `repos`
  enqueues `repo-intel`'s index job by its constant, rather than calling the indexer
  directly. Job kinds and constants are the narrow public surface of a module.
- Two modules needing the same query is a signal the aggregate is in the wrong module, not
  a reason to reach into a foreign repository.

---

## Where new things go — extended table

| You are adding | Ring | Location |
|----------------|------|----------|
| A new REST endpoint on an existing domain | 4 | that module's `routes.ts` |
| A new domain entirely | all | new `modules/<name>/` with the full file set |
| A business rule / permission check | 2 | `service.ts` |
| A query the service needs | 3 | `repository.ts` |
| A new table | 3 | `db/schema/<domain>.ts` + generated migration |
| A field on an API response | 0 → 2 | contract in `shared/contracts` (re-sync vendor), mapper in `helpers.ts` |
| A new external tool | 1 + 3 + 4 | port in `shared/adapters.ts`, impl in `adapters/<name>/`, wiring in `container.ts`, mock in `adapters/mocks.ts` |
| A background job | 2 + 3 | handler body in `service.ts`, registration via `platform/jobs.ts`, kind in `constants.ts` |
| Retry/timeout/backoff policy | 3 | `platform/resilience.ts` or the adapter |
| Prompt text or grounding logic | 0 | `reviewer-core/src/**` (or `src/prompts/` for built-in agent prompts) |
| A pure transform used by one module | 2 | that module's `helpers.ts` |
| A pure transform used by two modules | 2 | promote only when the second consumer is real, not anticipated |
