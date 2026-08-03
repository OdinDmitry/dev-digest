# Review checklist

Enforcement for this skill is by review — there is no `dependency-cruiser` config and no
`pnpm arch` script (see the end of `tooling.md`). This is the list to run your eye down on
any backend diff touching `server/` or `reviewer-core/`.

Ordered by how often each one actually catches something.

---

## 1. Read the imports first

Before reading what a changed file *does*, read what it imports. Almost every ring
violation is visible in the import block alone.

- [ ] `service.ts` imports no `fastify`, no `drizzle-orm`, no `db/schema.js`.
- [ ] `routes.ts` imports no `drizzle-orm` and no `db/schema.js`.
- [ ] A vendor SDK (`octokit`, `simple-git`, `openai`, `@anthropic-ai/sdk`,
      `@ast-grep/napi`, `@vscode/ripgrep`) appears only under `adapters/<name>/`.
- [ ] `reviewer-core/**` imports nothing but Zod, contracts and its own modules — no `pg`,
      no `fs`, no `node:fs`, no HTTP client.
- [ ] Nothing outside `platform/container.ts` constructs a concrete adapter (`new
      OctokitGitHubClient(...)`, `new OpenAIProvider(...)`).

## 2. Row types stopping at the boundary

- [ ] No `db/rows.js` import in a `service.ts` or `routes.ts`.
- [ ] No `typeof t.<table>.$inferSelect` in a public service signature.
- [ ] A new API field is added to the contract in `shared/contracts` and mapped in
      `helpers.ts` — not passed through by widening a row type.
- [ ] Vendored copies re-synced if `shared/` changed (`*/src/vendor/shared/`).

## 3. No skipped rings

- [ ] A new module has `routes.ts` **and** `service.ts` **and** `repository.ts` — not
      routes alone.
- [ ] The new endpoint's logic is reachable without HTTP: could a job call the same service
      method?
- [ ] No new query added inside `pulls`/`polling`/`settings`/`workspace` `routes.ts` — those
      files are grandfathered, not a pattern to extend.
- [ ] A business rule (a permission check, a state transition, "is this allowed") is in
      `service.ts`, not in a handler or a hook.

## 4. Dependencies and ports

- [ ] A **new** service takes an explicit deps interface or `Pick<Container, …>` — not
      `container: Container`. (Existing four are grandfathered.)
- [ ] Field and parameter types are ports (`GitHubClient`), not implementations
      (`OctokitGitHubClient`).
- [ ] A new port is named for the capability, not the vendor, and its methods do not mirror
      the SDK one-for-one.
- [ ] A new port has: interface in `shared/adapters.ts`, impl in `adapters/`, wiring in
      `container.ts`, mock in `adapters/mocks.ts`. All four, or it is half-wired.
- [ ] No new interface with exactly one implementation and one caller that no service uses.

## 5. Side effects in the right ring

- [ ] Multi-write use cases open the transaction in the service and pass the handle into
      repository methods.
- [ ] A repository method does not perform a whole multi-aggregate use case.
- [ ] Driver/SDK errors are translated to `platform/errors.ts` types at the adapter or
      repository boundary — no Postgres error codes or Octokit errors reaching a service.
- [ ] Secrets read through `SecretsProvider`, not `process.env`, outside
      `adapters/secrets/local.ts` and `platform/config.ts`.
- [ ] A job handler's body is a service method, registered from the service.

## 6. Tests match the rings

- [ ] DB-backed tests use the `*.it.test.ts` suffix; everything else stays hermetic.
- [ ] New service tests run against `adapters/mocks.ts` with no database. If that was not
      possible, ask what leaked into ring 2 rather than adding a container to the test.
- [ ] A new adapter has an integration test asserting the port's contract, not the SDK's.

---

## Fast greps

Not a substitute for reading the diff, but they surface the common leaks quickly. Run from
`server/`:

```bash
rg -l "drizzle-orm|db/schema" src/modules --glob '!**/repository*'
```

```bash
rg -n "from 'fastify'" src --glob '!src/modules/*/routes.ts' --glob '!src/app.ts'
```

```bash
rg -n "db/rows" src/modules/*/service.ts src/modules/*/routes.ts
```

```bash
rg -n "constructor\(private container: Container\)" src/modules
```

Expected current output (baseline as of `b2d056f`) — anything beyond this is new and worth
a comment:

1. The four grandfathered route files (`pulls`, `polling`, `settings`, `workspace`);
   `settings/feature-models.ts`, which runs a query outside a repository; the row-type
   parameters in `repos/helpers.ts`, `reviews/diff-loader.ts` and `reviews/run-executor.ts`;
   and `_shared/schemas.ts`, which is a false positive — the match is in a comment.
2. `modules/_shared/context.ts` and `modules/index.ts` — both legitimate ring 4.
3. `reviews/service.ts`.
4. All four existing services.

---

## How to word a finding

Point at the ring, not at taste. "This query in `routes.ts` puts persistence in ring 4 — it
makes the use case unreachable from a job and untestable without a server; move it to
`repository.ts` behind a service method" lands better, and is more actionable, than "please
use the repository pattern".

If a violation is deliberate and justified, it belongs in the accepted-violations list in
`SKILL.md` with the reason — not as a silent exception that the next reader will copy.
