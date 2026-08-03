---
name: frontend-ui-architecture
description: "Frontend UI architecture and code organization for React + Next.js + TypeScript — decides WHERE code lives, not how fast it runs. Use this skill whenever a question involves folder structure, project structure, where to put a component/hook/constant/type/util/business logic, how to split a feature, feature or module boundaries, import/dependency rules, barrel files, naming conventions, or App Router organization (route groups, private folders, colocation). Trigger it even when the user just asks 'where should this go?', 'is this the right place for X?', 'how do I structure this?', or is creating a new feature/module/page from scratch — placement decisions are cheap to get right up front and expensive to undo later. Also use when reviewing a diff that adds new files or moves code between folders."
version: 1.0.0
metadata:
  tags: architecture, code-organization, folder-structure, react, nextjs, typescript, boundaries, colocation
  last-reviewed: 2026-08-03
---

# Frontend UI Architecture

Answers one question: **where does this code belong?**

Scope boundary — this skill deliberately does not repeat what the sibling skills own:

| Question | Skill |
|----------|-------|
| Where does this file/component/constant/type/logic live? | **this skill** |
| Is this component/hook written correctly? Anti-patterns? | `react-best-practices` |
| How do RSC/caching/metadata/images actually work? | `next-best-practices` |
| Where do tests live and how are they written? | `react-testing-library` |

Companion files — read them when the question goes deeper than the rules below:

- `structure.md` — canonical folder layouts, the full placement table, naming conventions
- `nextjs.md` — App Router: `app/` vs `features/`, route groups, private folders, `'use client'` placement, Server Actions
- `enforcement.md` — copy-pasteable ESLint + dependency-cruiser configs that make these rules real
- `README.md` — every source behind these rules, tiered

---

## The one rule everything else derives from

**Put code as close to its only consumer as possible. Move it outward only when a second, unrelated consumer actually appears.**

Almost every structural mistake is a violation of this in one of two directions:

- *Premature extraction* — a helper used by one form lands in global `utils/`, so now a
  reader has to go find it, and nobody can tell whether it's safe to change.
- *Failure to extract* — a component used by four features stays inside one of them, so
  the other three import across a boundary and the feature can no longer be deleted or
  moved on its own.

Both are cheap to fix early and expensive later. When in doubt, keep it local: moving code
outward is a mechanical refactor, while untangling a premature abstraction means unpicking
every consumer that grew around it.

---

## Placement ladder

Apply in order. Stop at the first rung that fits — do not skip ahead "because it might be
reused later."

1. **Same file** — used once, inside one component. Constants, types, small pure helpers,
   and reducers all belong at module scope in the file that uses them (above the
   component, not inside it — a function redefined every render is a new identity every
   render).
2. **Sibling file in the same folder** — the component's own `use-x.ts`, `utils.ts`,
   `types.ts`, `constants.ts`. Still private to that component.
3. **Feature folder** — `src/features/<domain>/`. Used by several things inside one
   business domain. This is where most non-trivial code ends up.
4. **Shared layer** — `src/components/ui/`, `src/lib/`, `src/utils/`, `src/config/`,
   `src/types/`. Reserved for code that is genuinely domain-agnostic. A file here must not
   know your domain vocabulary; if it mentions `invoice` or `subscription`, it belongs on
   rung 3.
5. **Separate package** — only in a monorepo, only with two real consuming apps.

The test for promoting a file from rung 3 to rung 4 is not "could this be reused" — it's
"is this being used by a second feature *right now*, and is it free of domain concepts".

---

## Structure: feature-first, not file-type-first

Group by **what the code is about**, not by what kind of file it is. A reader opening
`src/` should be able to tell what the product does.

```
src/
├── app/                    # Next.js routes: composition + routing only
├── features/               # ~everything real lives here
│   └── <domain>/
│       ├── api/            # requests, query/mutation hooks, DTO → domain mapping
│       ├── components/     # UI owned by this domain
│       ├── hooks/          # orchestration: state + effects + reactions
│       ├── model/          # framework-free business rules, stores, schemas
│       ├── constants.ts
│       ├── types.ts
│       ├── utils.ts
│       └── index.ts        # the feature's public API (see barrel rule below)
├── components/ui/          # domain-agnostic primitives: Button, Dialog, Table
├── lib/                    # technology wrappers: http client, storage, 3rd-party SDK setup
├── utils/                  # pure, universal, business-free: dates, strings, numbers
├── config/                 # validated env + app-wide static config
├── types/                  # only genuinely cross-cutting types
└── testing/                # test setup, render helpers, mock server
```

Only create the subfolders a feature actually needs. An empty `hooks/` folder is noise.

The flat `components/ hooks/ utils/ services/` layout is fine for a small app and reliably
fails past that point: a single change to one business capability touches five distant
folders, and nothing tells you which files belong together. If you inherit that layout,
migrate feature by feature rather than all at once.

### `utils` vs `lib` vs `api` vs `helpers`

These names are meaningless unless you fix them, so fix them:

| Folder | Contains | Test |
|--------|----------|------|
| `utils/` | Pure, universal, business-free | Could be published to npm unchanged |
| `lib/` | Technology-bound wrappers — HTTP client, storage, SDK config | Knows a *technology*, not your domain |
| `<feature>/api/` | Calls to your backend, DTO↔domain mapping | Knows your *endpoints* |
| `<feature>/utils/` | Domain transforms | Knows your *domain* |

**Do not create a top-level `helpers/`.** It has no definition that distinguishes it from
`utils/`, which is exactly why it becomes the folder where unclassifiable code goes to die.
Every function is either generic (`utils/`), technology-bound (`lib/`), or domain-bound
(inside the feature).

---

## Dependency direction — the part that makes it an architecture

Dependencies flow one way:

```
shared (components/ui, lib, utils, config, types)  →  features  →  app
```

Three rules, and they are the whole thing:

- **Shared may not import from features or app.** A primitive that knows about `Invoice`
  is not a primitive.
- **A feature may not import from a sibling feature.** If `checkout` needs something from
  `cart`, either lift the shared piece down into the shared layer, or compose both at the
  page level and pass data through props.
- **Features may not import from `app/`.** Routing is a consumer of features, never a
  dependency of them.

The payoff is concrete: a feature that obeys these rules can be deleted, moved, or handed
to another team by moving one folder. A feature that doesn't will take unrelated code down
with it.

**Write the rules into the linter, not just into a document.** An architecture nobody can
violate accidentally is the only kind that survives a deadline. `enforcement.md` has
ready-to-paste `eslint-plugin-boundaries` and `dependency-cruiser` configs — ESLint for
in-editor feedback, dependency-cruiser for CI and dependency graphs.

### When to escalate to Feature-Sliced Design

`features/ + app/` is the right default. Reach for full FSD (`app / pages / widgets /
features / entities / shared`) only when several teams work in one repo and the extra
layer names are earning their keep as a shared vocabulary.

Take FSD's v2.1 lesson even if you never adopt FSD: **keep code in the page/feature that
uses it until reuse is real.** FSD demoted its own entity-first decomposition precisely
because splitting by anticipated reuse destroyed cohesion — one workflow ended up scattered
across folders, and dead code became impossible to identify.

---

## Barrel files: exactly one per feature

Genuine tension in the ecosystem, resolved as follows:

- **Yes** to a single thin `features/<domain>/index.ts` that re-exports the feature's
  public surface. This is what turns a folder into a boundary — outsiders import
  `@/features/billing`, never `@/features/billing/components/internal-thing`.
- **No** to barrels anywhere else. No `components/index.ts`, no `utils/index.ts`, no
  barrels inside a feature. Broad barrels cost build time, defeat tree-shaking, make IDE
  "go to definition" land on the wrong file, and turn one file into a merge-conflict
  magnet.

Export only what outsiders need. A barrel that re-exports everything is just a slower
version of no barrier at all.

---

## Where business logic goes

Three layers, with React kept at the edges:

- **Presentation — components.** Receive props, render, raise events. No fetching, no
  business rules.
- **Orchestration — custom hooks.** Wire state, effects and data together for a screen.
  Hooks are for *coordination*, not for the rules themselves.
- **Rules — plain TypeScript modules with no React import.** Pricing, permissions,
  validation, state machines, domain invariants. Anything that would still be true if you
  replaced the UI framework tomorrow belongs here. The practical benefit is testing: these
  are ordinary functions with ordinary inputs, so they need no renderer, no mocks, and no
  act() dance.
- **Data access — `<feature>/api/`.** Request functions, query/mutation hooks, and the
  DTO→domain mapping. Keep the mapping here so backend shape changes stop at one file
  instead of rippling into components.

Two placement rules that fall out of this and are worth applying mechanically:

- **Reducers and pure helpers are declared outside the component body** — outside means
  module scope or a separate file. Reducers take state as an argument, so they never need
  the closure.
- **Server state and client state are different things and must not be mixed.** Data owned
  by the server lives in a query cache (TanStack Query, or RSC + `fetch`) — never mirrored
  into Zustand/Redux. Once server state moves out, what's left in a global store is only
  true client state, and there is usually surprisingly little of it. This is the single
  highest-leverage architectural decision in a React codebase; getting it wrong produces
  the cache-invalidation bugs people blame on the state library.

---

## Where constants and config go

Same ladder, one addition: **anything that varies per environment is not a constant.**

1. Used in one file → module scope in that file.
2. Used across one feature → `features/<x>/constants.ts`.
3. App-wide and truly static — route paths, query keys, roles, regexes →
   `src/config/` or `src/constants/`.
4. Environment-derived → a validated config module (`src/config/env.ts`) parsing
   `process.env` through a Zod schema at startup, with an explicit client/server split so a
   server secret cannot be imported into a client bundle. Failing loudly at boot beats
   `undefined` surfacing in production.

Don't extract single-use literals just to avoid a magic number. A constant earns its name
by being used in more than one place, or by encoding a meaning the literal doesn't convey.

---

## Where types go

1. Used in one file → declare it there. Inline in the signature is fine.
2. Used in more than one file → the nearest shared `*.types.ts` (usually
   `features/<x>/types.ts`).
3. Used in more than one package (monorepo) → shared package.

`src/types/` is for genuinely cross-cutting types only. A feature's query result shapes and
server-action payloads are not cross-cutting, no matter how many files inside that feature
use them.

---

## Component granularity

Split a component when you feel a concrete problem — reuse, tangled state, a test you can't
write, a re-render you can't isolate, two people editing the same file. Do not split on a
line count, and do not split in anticipation.

> Duplication is far cheaper than the wrong abstraction.

Line and prop counts are *prompts to look*, not thresholds to enforce. A 250-line component
that does one thing clearly is healthier than five components threaded together with prop
drilling. When you do split, prefer composition — pass `children`, lift content up, push
state down — over adding another layer of props.

Placement follows the ladder: a sub-component extracted for readability stays in the same
file or a sibling file. It only graduates to `features/<x>/components/` when something else
in the feature uses it, and to `components/ui/` only once it has no domain knowledge left.

---

## Naming

Consistency matters more than the specific choice, but if there's no existing convention:

- **Files and folders: kebab-case**, uniformly — `user-profile.tsx`, `use-cart.ts`. One
  rule with no per-file-type exceptions removes a daily micro-decision and avoids
  case-sensitivity surprises between macOS and CI.
- **Identifiers**: PascalCase for components and types, camelCase for functions and
  variables, SCREAMING_SNAKE for module-level constants.
- **Domain folders singular** (`customer/`), **bundle files plural** (`hooks.ts`,
  `constants.ts`) — the folder is one concept, the file holds many.
- **Absolute imports via path aliases** (`@/features/...`), never `../../../`. Relative
  paths encode the current location, so moving a folder rewrites every import in it.

If the repo already has a different convention, follow the repo. Mixed conventions cost more
than a suboptimal one.

---

## Reviewing structure

When new files appear in a diff, check in this order — the first three catch nearly
everything:

1. Does anything in `components/ui`, `lib`, `utils` or `config` import from `features/`?
2. Does a feature import from a sibling feature?
3. Was something extracted to a shared folder with exactly one consumer?
4. Did server data get copied into a client store?
5. Is business logic sitting in a component body, or a reducer declared inside one?
6. Is there a new broad barrel file?
7. Is there a new `helpers/` folder, or an env value hard-coded as a constant?
