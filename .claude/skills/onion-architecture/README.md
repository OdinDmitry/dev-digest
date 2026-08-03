# onion-architecture

**Version 1.0.0** · researched and written 2026-08-03

A skill about **which ring backend code belongs to** — the dependency direction between
domain, ports, application services, adapters and delivery in `server/` and
`reviewer-core/`. Placement and coupling only; deliberately no guidance on how to write a
good route, query or schema.

Scope is the two backend packages. The Next.js client is covered by
`frontend-ui-architecture`; `e2e/` is out of scope.

## Files

| File | Contents |
|------|----------|
| [SKILL.md](SKILL.md) | The dependency rule, the five rings mapped onto this repo, import rules, module anatomy, service dependencies, ports, side effects, accepted violations, quick decision table |
| [layers.md](layers.md) | Each ring in full: what lives there, naming, DTO/contract/row separation, vertical slices vs horizontal rings, extended placement table |
| [tooling.md](tooling.md) | Fastify, Drizzle, Zod, the DI container and Vitest — used in service of the rings |
| [review-checklist.md](review-checklist.md) | What to check on a backend diff, fast greps with their expected baseline, how to word a finding |

## Relationship to sibling skills

| Question | Skill |
|----------|-------|
| Which ring does this belong to? What may it import? | **this one** |
| How do I write this route/plugin/hook correctly? | `fastify-best-practices` |
| How do I write this query/schema/migration? | `drizzle-orm-patterns` |
| How should this table be designed? | `postgresql-table-design` |
| How should this Zod schema be written? | `zod` |
| Where does frontend code live? | `frontend-ui-architecture` |

## Decisions taken when writing this skill

Three points were decided rather than hedged, because a skill that presents both sides
gives no guidance:

- **Scope is `server/` + `reviewer-core/`.** The rings are described in terms of the paths
  that exist today, not as a generic template.
- **`Container` in services is a documented exception, not a refactor.** The four existing
  services keep it; new services take explicit dependencies. Rewriting them now would be a
  large breaking change for an architectural purity that the container's
  `ContainerOverrides` already partially buys back in tests.
- **Enforcement is by review.** No `dependency-cruiser` config and no `pnpm arch` script
  were added. `dependency-cruiser` is already a dependency of `server/` (it powers the
  `DepCruiseGraph` repo-intel adapter), so automating this later costs a config file and a
  script — but four modules currently violate the no-skipped-rings rule, so any config
  would have to land with either a fix or an allowlist. That is its own piece of work.

Where the ecosystem disagrees, this skill follows Graça over Palermo on one point: **ports
are declared by the application layer, not by domain entities**. That matches where
`shared/adapters.ts` already sits and keeps domain types free of persistence concepts.

## Sources

### Tier A — the architecture itself

- [The Onion Architecture, part 1](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/) — Jeffrey Palermo, 2008. The original. Layers, and "all coupling is toward the centre". Parts [2](http://jeffreypalermo.com/blog/the-onion-architecture-part-2/), [3](http://jeffreypalermo.com/blog/the-onion-architecture-part-3/) and [4 (four years on)](http://jeffreypalermo.com/blog/onion-architecture-part-4-after-four-years/) add the tenets: inner layers define interfaces, outer layers implement them, and the core compiles and runs separately from infrastructure.
- [Onion Architecture](https://herbertograca.com/2017/09/21/onion-architecture/) — Herberto Graça, *The Software Architecture Chronicles*. How Onion relates to Ports & Adapters and Clean Architecture, and the argument that application services should own the port interfaces. Source of the placement decision noted above.
- [Onion Architecture: Going Beyond Layers](https://blog.ndepend.com/onion-architecture-layers/) — NDepend. Useful on what the layer metaphor does and does not buy you.
- [Hexagonal architecture — overview and best practices](https://tsh.io/blog/hexagonal-architecture) — TSH. Ports as domain-defined interfaces, adapters as concrete implementations.
- [Ports and Adapters, explained with two real codebases](https://saadh393.github.io/blog/adapter-port-architecture-two-cases) — the operative rule stated plainly: files inside the application may import ports but never adapters.

### Tier B — TypeScript / Node implementations

- [Domain-Driven Hexagon](https://github.com/Sairyss/domain-driven-hexagon) — the most complete TypeScript reference. Modules as vertical slices with layers inside, ports/adapters, application services per use case, DTOs and mappers, and the rule that modules communicate through a narrow surface rather than direct imports. ([DEV writeup](https://dev.to/sairyss/domain-driven-hexagon-18g5).) Its CQRS and base-class machinery is heavier than this repo needs — the module/layer structure and the boundary rules are what was taken.
- [Clean Node.js Architecture](https://khalilstemmler.com/articles/enterprise-typescript-nodejs/clean-nodejs-architecture/) — Khalil Stemmler. Policy vs detail, "code can only point inwards", and the testing consequence: domain code is trivial to test because it has zero external dependencies.

### Tier C — tool-specific

- [Drizzle ORM Best Practices](https://www.paulserban.eu/blog/post/drizzle-orm-best-practices-principles-patterns-and-real-world-case-studies/) — Paul Serban. Repository methods in domain language, transaction control inverted to the caller, "API types, business logic types, and database row types should be distinct", and never returning query builders. The backbone of the Drizzle section in `tooling.md`.
- [Fastify — Encapsulation](https://fastify.dev/docs/latest/Reference/Encapsulation/) and [Decorators](https://fastify.dev/docs/latest/Reference/Decorators/) — the encapsulation context, and how `fastify-plugin` deliberately breaks it.
- [The hitchhiker's guide to plugins](https://fastify.dev/docs/latest/Guides/Plugins-Guide/) — Fastify docs.
- [Fastify plugins as building blocks for a backend Node.js API](https://snyk.io/blog/fastify-plugins-for-backend-node-js-api/) — Snyk. The plugin system read as a lightweight DI mechanism instead of singletons and globals.
- [Zod — Basics](https://zod.dev/basics) — `parse` returns a strongly-typed value; validate at API boundaries in both directions.

### Tier D — enforcement, if we automate it later

- [Dependency Cruiser: Restrict Imports in JavaScript](https://spin.atomicobject.com/dependency-cruiser-imports/) — Atomic Object. Rule syntax for forbidding cross-layer imports.
- [Taking frontend architecture serious with dependency-cruiser](https://xebia.com/blog/taking-frontend-architecture-serious-with-dependency-cruiser/) — Xebia. Rollout on an existing codebase, and the ESLint-vs-cruiser trade-off (instant feedback vs CI gate).
- [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries) — the alternative, if ESLint is ever introduced. There is currently no ESLint config in this repository.

## Changelog

- **1.0.0** (2026-08-03) — initial version. Rings mapped onto the current tree; accepted
  violations recorded as of commit `b2d056f`.
