# Structure Reference

Detail behind `SKILL.md`. Read when you need a concrete layout, an exhaustive placement
lookup, or a migration path.

Contents:
1. [Layouts by project size](#1-layouts-by-project-size)
2. [Anatomy of a feature](#2-anatomy-of-a-feature)
3. [Placement lookup table](#3-placement-lookup-table)
4. [Migrating a flat project](#4-migrating-a-flat-project)
5. [Mapping to Feature-Sliced Design](#5-mapping-to-feature-sliced-design)
6. [Naming reference](#6-naming-reference)
7. [Monorepo: when a package is justified](#7-monorepo-when-a-package-is-justified)

---

## 1. Layouts by project size

Structure should follow the codebase, not precede it. Don't spend more than a few minutes
choosing — start at the smallest layout that fits and let the pain tell you when to move up.

### Stage 1 — flat (up to ~15 files)

```
src/
├── components/
├── hooks/
├── utils/
└── App.tsx
```

Perfectly fine. Premature folder taxonomy on a small app is pure overhead. Move on when
you can no longer tell which files belong together.

### Stage 2 — feature-first (the default for real projects)

```
src/
├── app/                      # routes (Next.js) or router config (SPA)
├── features/
│   ├── auth/
│   ├── billing/
│   └── projects/
├── components/ui/
├── lib/
├── utils/
├── config/
├── types/
└── testing/
```

This is the layout `SKILL.md` prescribes. It satisfies "screaming architecture" — `src/`
tells a reader what the product does, not which framework it uses — and it makes deletion
trivial, which is the honest test of a boundary.

### Stage 3 — layered (multi-team)

Only when several teams share the repo and need a common vocabulary for *how reusable*
something is. See [§5](#5-mapping-to-feature-sliced-design).

---

## 2. Anatomy of a feature

```
features/billing/
├── api/
│   ├── get-invoices.ts        # request fn + query hook + DTO→domain mapping
│   └── create-invoice.ts
├── components/
│   ├── invoice-table.tsx
│   └── invoice-table-row.tsx  # sibling: used only by invoice-table
├── hooks/
│   └── use-invoice-filters.ts # orchestration
├── model/
│   ├── invoice.ts             # domain type + rules, no React import
│   └── pricing.ts             # pure business rules
├── constants.ts
├── types.ts
├── utils.ts
└── index.ts                   # public API — the only file outsiders import
```

Rules that make this a boundary rather than a folder:

- **Create only what's needed.** Most features never need all of these.
- **`index.ts` exports the public surface only.** Internals stay internal — that's the
  point. If a component is only rendered by another component in the same feature, it is
  not public.
- **No sibling-feature imports.** Compose at the page level instead.
- **`model/` imports nothing from React.** That constraint is what makes the rules testable
  without a renderer, and it's the difference between "business logic in a hook" and
  business logic you can actually reason about.

### Where does a shared *type* between features go?

If `billing` and `projects` both need `Money`, it is not a billing type — it's a domain
primitive. Put it in `src/types/` (or a `shared/model/` if you have one). Don't let
`projects` import `features/billing/types`; that's the sibling-import violation wearing a
disguise.

---

## 3. Placement lookup table

| Thing | Default home | Promote when |
|-------|--------------|--------------|
| Component used by one component | Same file, or sibling file | A second component in the feature uses it |
| Component used across one feature | `features/<x>/components/` | A second feature needs it *and* it has no domain knowledge |
| Domain-agnostic primitive (Button, Dialog) | `components/ui/` | Two apps need it → package |
| Route-local one-off (Next.js) | `app/<route>/_components/` | Used outside that route → feature |
| Custom hook used by one component | Sibling `use-x.ts` | Feature-wide → `features/<x>/hooks/` |
| Business rule / calculation | `features/<x>/model/*.ts`, no React import | Shared domain concept → `src/types` + shared model |
| Data fetching | `features/<x>/api/` | Never global — the endpoint belongs to the domain |
| HTTP client instance, interceptors | `lib/http-client.ts` | — |
| Third-party SDK setup | `lib/<sdk>.ts` | — |
| Date/string/number helper | `utils/` | — |
| Domain-specific formatter (`formatInvoiceStatus`) | `features/<x>/utils.ts` | — |
| Constant used once | Module scope in that file | Second consumer → feature `constants.ts` |
| Route paths, query keys, roles | `config/` or `constants/` | — |
| Env-derived value | `config/env.ts` (validated) | — |
| Type used once | Same file | More files → `features/<x>/types.ts` |
| Cross-feature type | `src/types/` | Cross-package → shared package |
| Global store | `features/<x>/model/store.ts`, or `src/stores/` if truly app-wide | — |
| Server data | Query cache — never a store | — |
| Zod schema for a form | Next to the form, in the feature | Shared contract → shared package |
| Test utilities, MSW handlers | `testing/` | — |
| Error boundary for a feature | Inside the feature, wrapping its entry component | — |
| E2E tests | Outside `src/`, at repo root | Deliberately *not* colocated |

The last row is the notable exception to colocation: end-to-end tests span the whole system,
so they shouldn't have to move every time you refactor internal folders.

---

## 4. Migrating a flat project

Do not do a big-bang restructure — it produces an unreviewable diff and a week of merge
conflicts for zero user-visible change.

1. Add `features/` next to the existing folders. Leave everything where it is.
2. The next time you touch a business area, move *that* area's files into
   `features/<domain>/` and add its `index.ts`.
3. Anything left in the old global `components/` after a few passes is either a genuine UI
   primitive (move to `components/ui/`) or dead code (delete it — that's a real benefit of
   the exercise).
4. Turn on the boundary lint rules in warn mode once two or three features exist; flip to
   error once the backlog is empty. See `enforcement.md`.

Migrating opportunistically means the structure improves where the churn is, which is
exactly where it pays off.

---

## 5. Mapping to Feature-Sliced Design

If a team already uses FSD, or the repo grows to need the extra vocabulary, the default
layout maps cleanly:

| Default layout | FSD layer |
|---|---|
| `app/` (routes) | `app` + `pages` |
| large page-specific composites | `widgets` (or keep in the page slice — see below) |
| `features/<domain>/` | `features` + `entities` |
| `components/ui`, `lib`, `utils`, `config`, `types` | `shared` |

FSD's own rules, condensed:

- Seven layers, top to bottom: `app` → `pages` → `widgets` → `features` → `entities` →
  `shared` (`processes` is deprecated).
- **Imports go strictly downward.** Same-layer sibling imports are forbidden — the same
  rule as "no cross-feature imports", generalised.
- **Slices** divide a layer by domain; **segments** (`ui`, `api`, `model`, `lib`, `config`)
  divide a slice by technical purpose.
- Every slice exposes a public API; outsiders may not reach into its internals.

**Take the v2.1 lesson regardless of whether you adopt FSD.** FSD 2.1 moved to "pages
first": keep large UI blocks, forms and data logic in the page slice that uses them instead
of pre-extracting entities and features. They changed this because entity-first
decomposition hurt cohesion (one workflow scattered across many folders), had a steep
learning curve, and different developers classified the same code differently — producing
architectural arguments instead of architecture.

---

## 6. Naming reference

| Kind | Convention | Example |
|------|-----------|---------|
| Files | kebab-case | `invoice-table.tsx`, `use-cart.ts` |
| Folders | kebab-case, singular for domains | `features/billing/`, `customer/` |
| Bundle files | plural | `hooks.ts`, `constants.ts`, `utils.ts`, `types.ts` |
| Components, types, interfaces | PascalCase | `InvoiceTable`, `Invoice` |
| Hooks | `use` prefix, camelCase identifier | `useInvoiceFilters` |
| Functions, variables | camelCase | `formatInvoiceTotal` |
| Module constants | SCREAMING_SNAKE | `MAX_RETRY_COUNT` |
| Server actions (Next.js) | `-action.ts` suffix or `actions.ts` | `create-invoice-action.ts` |
| Query functions | `get-` / `list-` prefix | `get-invoice.ts` |
| Test files | `*.test.ts(x)` next to the subject | `invoice-table.test.tsx` |

Two notes:

- **All-kebab-case for files is the emerging preference** over PascalCase-for-components.
  The win is that there is exactly one rule, so nobody has to decide per file, and nothing
  breaks when a case-insensitive dev machine meets a case-sensitive CI box.
- **Follow the existing repo convention over this table.** A codebase with two conventions
  costs more than one with a suboptimal convention.

---

## 7. Monorepo: when a package is justified

Extract to `packages/*` only when there are **two real consuming apps**, not because
something feels reusable. The production pattern is `apps/*` for deployables and
`packages/*` for design-system, database, auth and shared config.

Until then, `components/ui/` inside the app is the shared layer, and it costs nothing to
promote later.

> **This repo:** DevDigest deliberately does *not* use workspace packages. Shared code
> (`@devdigest/shared` contracts, `@devdigest/ui`) is **copied** into `*/src/vendor/*` and
> re-synced by hand — see the root `CLAUDE.md`. That convention overrides the generic
> monorepo advice above; a change to a source package must be manually propagated to each
> vendor copy.
