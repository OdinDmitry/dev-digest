# frontend-ui-architecture

**Version 1.0.0** · researched and written 2026-08-03

A skill about **where frontend code lives** — folder structure, feature boundaries,
dependency direction, and the placement of components, hooks, constants, types, utilities
and business logic in React + Next.js + TypeScript codebases. Architecture and organization
only; deliberately no performance or rendering guidance.

## Files

| File | Contents |
|------|----------|
| [SKILL.md](SKILL.md) | Core rules: the placement ladder, feature-first structure, dependency direction, barrels, business-logic layering, constants, types, granularity, naming, review checklist |
| [structure.md](structure.md) | Layouts by project size, feature anatomy, exhaustive placement lookup table, migration path, FSD mapping, naming reference, monorepo criteria |
| [nextjs.md](nextjs.md) | App Router: `app/` vs `features/`, colocation, private folders, route groups, the server/client boundary, Server Actions, env config |
| [enforcement.md](enforcement.md) | Copy-pasteable ESLint (`import/no-restricted-paths`, `eslint-plugin-boundaries`) and dependency-cruiser configs, plus a rollout plan for existing codebases |

## Relationship to sibling skills

| Question | Skill |
|----------|-------|
| Where does this file/component/constant/type/logic live? | **this one** |
| Is this component/hook written correctly? Anti-patterns? | `react-best-practices` |
| How do RSC, caching, metadata, images actually work? | `next-best-practices` |
| Where do tests live and how are they written? | `react-testing-library` |

Two overlaps were resolved deliberately when this skill was written:

- **Component size.** `react-best-practices` states "max 200 lines / max 5–7 props". This
  skill treats those as prompts to look, not thresholds to enforce, following the
  well-supported position that premature splitting costs more than a large cohesive
  component ([B2](#tier-b--opinionated-practitioners)).
- **RSC boundaries.** `next-best-practices` explains how they work; this skill only says
  where to draw them.

## Positions this skill takes on contested questions

The ecosystem genuinely disagrees on two points. Both were decided rather than hedged,
because a skill that presents both sides gives no guidance:

- **Barrel files.** FSD requires a public API per slice; bulletproof-react says avoid
  barrels entirely. Resolution: exactly one thin `index.ts` per feature exporting the
  public surface, and no barrels anywhere else. This keeps the boundary that makes a
  feature a module, without the build-time, tree-shaking and IDE-navigation costs of broad
  barrels ([A1](#tier-a--canonical--official), [A6](#tier-a--canonical--official),
  [C6](#tier-c--ecosystem-consensus--tooling), [C7](#tier-c--ecosystem-consensus--tooling)).
- **One structure vs a decision ladder.** The skill prescribes `features/ + app/` with a
  unidirectional dependency rule, and documents full FSD as the escalation path for
  multi-team repos. Prescribing one default avoids the analysis paralysis the sources
  repeatedly warn about ([B10](#tier-b--opinionated-practitioners)).

---

# Sources

53 sources, tiered by authority. **Tier A** — canonical, official, or battle-tested
reference implementations. **Tier B** — opinionated practitioners with a track record.
**Tier C** — ecosystem commentary and tooling; useful for consensus-checking, not
authoritative alone.

## Tier A — canonical & official

| # | Source | What it settles |
|---|--------|-----------------|
| A1 | [bulletproof-react — Project Structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) | The reference `src/` layout; feature-folder anatomy; unidirectional dependency rule; ESLint enforcement config; "no barrel files" |
| A2 | [bulletproof-react — Project Standards](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-standards.md) | Naming, absolute imports, lint/format standards |
| A3 | [bulletproof-react (repo)](https://github.com/alan2207/bulletproof-react) | Working reference implementation |
| A4 | [Feature-Sliced Design — Overview](https://feature-sliced.design/docs/get-started/overview) | Layers / slices / segments; the downward-import rule |
| A5 | [FSD — Layers reference](https://feature-sliced.design/docs/reference/layers) | All 7 layers and what belongs in each |
| A6 | [FSD — Slices & Segments reference](https://feature-sliced.design/docs/reference/slices-segments) | `ui` / `api` / `model` / `lib` / `config` segment semantics; public API rule |
| A7 | [FSD v2.1 — "Pages come first"](https://github.com/feature-sliced/documentation/discussions/756) | Why entity-first decomposition was demoted; pages-first guidance |
| A8 | [FSD — The Perfect Folder Structure for Scalable Frontend](https://feature-sliced.design/blog/frontend-folder-structure) | Explicit critique of flat `components/ hooks/ utils/` |
| A9 | [Next.js — Project Structure & Organization](https://nextjs.org/docs/app/getting-started/project-structure) | Colocation is safe by default; `_private` folders; `(route groups)`; `src/`; the three sanctioned file-splitting strategies |
| A10 | [Next.js — Route Groups](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups) | Organizing by section/team without touching URLs; multiple root layouts |
| A11 | [Next.js — Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) | The boundary; composition via `children`; `'use client'` ≠ no SSR |
| A12 | [React — Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks) | Official position on extracting shared logic |
| A13 | [React — Extracting State Logic into a Reducer](https://react.dev/learn/extracting-state-logic-into-a-reducer) | Reducers declared outside the component; intent-named actions |
| A14 | [React — Scaling Up with Reducer and Context](https://react.dev/learn/scaling-up-with-reducer-and-context) | Split state and dispatch contexts; wrap in a custom hook |
| A15 | [TanStack Query — Does this replace Redux/MobX?](https://tanstack.com/query/v5/docs/framework/react/guides/does-this-replace-client-state) | Canonical server-state vs client-state split |
| A16 | [Vercel — next-forge](https://github.com/vercel/next-forge) | Production `apps/` + `packages/` (design-system, database, auth) split |
| A17 | [Vercel Academy — Client/Server Component Boundaries](https://vercel.com/academy/nextjs-foundations/client-server-boundaries) | First-party guidance on where to draw `'use client'` |
| A18 | [Vercel Academy — Production Monorepos / next-forge patterns](https://vercel.com/academy/production-monorepos/next-forge-patterns) | When to promote shared UI into its own package |
| A19 | [T3 Env — Next.js](https://env.t3.gg/docs/nextjs) | Typed, validated config layer with an explicit client/server split |
| A20 | [Create T3 App — Environment Variables](https://create.t3.gg/en/usage/env-variables) | Build-time env validation; importing `env.ts` in `next.config` |

## Tier B — opinionated practitioners

| # | Source | What it settles |
|---|--------|-----------------|
| B1 | [Kent C. Dodds — Colocation](https://kentcdodds.com/blog/colocation) | The governing principle: "place code as close to where it's relevant as possible", plus the explicit exceptions (E2E tests, system-wide docs, genuinely shared utilities) |
| B2 | [Kent C. Dodds — When to break up a component](https://kentcdodds.com/blog/when-to-break-up-a-component-into-multiple-components) | Split on felt problems, not line counts; "duplication is far cheaper than the wrong abstraction" |
| B3 | [Kent C. Dodds — State Colocation](https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster) | Push state down rather than lifting by default |
| B4 | [Robin Wieruch — React Folder Structure (2026)](https://www.robinwieruch.de/react-folder-structure/) | The staged evolution flat → component folders → technical → feature; kebab-case files, singular domain folders, plural bundle files |
| B5 | [Alex Kondov — Tao of React](https://alexkondov.com/tao-of-react/) | 80+ rules: group by route/module, common module, absolute paths, wrap external components, components in folders, reducers, data-fetching libraries |
| B6 | [Tao of React (book site)](https://www.taoofreact.com/) | Book-form index of the same rules |
| B7 | [bram.us — Tao of React summary](https://www.bram.us/2021/01/31/tao-of-react-software-design-architecture-best-practices/) | Accessible mirror of B5's rule list (alexkondov.com returns 403 to fetchers) |
| B8 | [profy.dev — Screaming Architecture: Evolution of a React folder structure](https://dev.to/profydev/screaming-architecture-evolution-of-a-react-folder-structure-4g25) | The four-stage evolution; `features/` + `pages/`; feature public API via `index`; why global `hooks/`/`contexts/` become dumping grounds |
| B9 | [profy.dev — Clean(er) React Architecture pt.6: Business Logic Separation](https://profy.dev/article/react-architecture-business-logic-and-dependency-injection) | Extracting business logic into hooks + DI for testability |
| B10 | [profy.dev — pt.7: Domain Logic](https://profy.dev/article/react-architecture-domain-logic) | A domain layer operating on domain models, independent of React |
| B11 | [profy.dev — pt.5: Infrastructure Services & DI](https://profy.dev/article/react-architecture-infrastructure-services-and-dependency-injection) | Making the API layer testable |
| B12 | [profy.dev — pt.8: React Query](https://profy.dev/article/react-architecture-tanstack-query) | Separating domain entities from DTOs; where mapping belongs |
| B13 | [Total TypeScript (Matt Pocock) — Where to put your types](https://www.totaltypescript.com/where-to-put-your-types-in-application-code) | The three rules: one place → same file; many places → shared file; many packages → shared package |
| B14 | [React Handbook — Project Standards](https://reacthandbook.dev/project-standards) | "Don't spend >5 minutes planning folders — organize as you go"; endorses bulletproof-react |
| B15 | [React Handbook](https://reacthandbook.dev/) | Broader production-React architecture guide |
| B16 | [Infinum Frontend Handbook — React project structure](https://infinum.com/handbook/frontend/react/project-structure) | An agency's enforced, real-world structure |
| B17 | [itswillt — Folder Structures in React Projects](https://dev.to/itswillt/folder-structures-in-react-projects-3dp8) | The clearest published definition of `lib/` vs `utils/` vs `services/`; the Level 1/2/3 ladder |
| B18 | [Sandro Roth — How to structure your React projects](https://sandroroth.com/blog/project-structure/) | bulletproof-react vs FSD compared in practice |
| B19 | [Matias Kinnunen — Locality of Behaviour / Co-location](https://mtsknn.fi/blog/locality-of-behavior-and-co-location/) | The LoB principle underpinning colocation |
| B20 | [Codemzy — My React file/folder structure, 2025 changes](https://www.codemzy.com/blog/react-file-structure) | The shift toward all-kebab-case filenames |

## Tier C — ecosystem consensus & tooling

| # | Source | What it's for |
|---|--------|---------------|
| C1 | [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries) | Enforcing layer/feature import rules in-editor |
| C2 | [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) | Enforcing the same rules in CI, plus dependency graphs |
| C3 | [eslint-plugin-import-fsd](https://github.com/oleg-putseiko/eslint-plugin-import-fsd) | FSD-specific layer validation |
| C4 | [Xebia — Taking Frontend Architecture Serious With dependency-cruiser](https://xebia.com/blog/taking-frontend-architecture-serious-with-dependency-cruiser/) | Why lint-enforced beats documented; the ESLint-vs-CI trade-off |
| C5 | [Steve Kinney — Architectural Linting](https://stevekinney.com/courses/enterprise-ui/architectural-linting-exercise) | Teaching-grade example of the rule set |
| C6 | [Barrel files and why you should STOP using them](https://dev.to/tassiofront/barrel-files-and-why-you-should-stop-using-them-bc4) | The anti-barrel case: build time, tree-shaking, IDE navigation, merge conflicts |
| C7 | [Steven Lemon — Are TypeScript barrel files an anti-pattern?](https://steven-lemon182.medium.com/are-typescript-barrel-files-an-anti-pattern-72a713004250) | The balanced counter-case: barrels are fine as a *stable module public API* |
| C8 | [Why you should avoid `helpers`](https://dev.to/knzt/helpers-and-utils-folders-in-software-architecture-3f8h) | Why `helpers/`/`utils/` rot into dumping grounds |
| C9 | [Are utils a code smell?](https://dev.to/noway/are-utils-folder-where-you-put-random-stuff-you-don-t-know-where-to-put-otherwise-a-code-smell-3054) | The counterpoint discussion |
| C10 | [Semaphore — Organizing constants in a dedicated layer](https://semaphore.io/blog/constants-layer-javascript) | The pro-central-constants position |
| C11 | [Design Systems Collective — Is Atomic Design still relevant in 2025?](https://www.designsystemscollective.com/is-atomic-design-still-relevant-in-2025-d9c214788cfe) | Why atomic design lost to domain-based structure for app code |
| C12 | [Atomic Design and its relevance in frontend in 2025](https://dev.to/m_midas/atomic-design-and-its-relevance-in-frontend-in-2025-32e9) | Same debate, second opinion |
| C13 | [makerkit — Next.js 16 App Router Project Structure](https://makerkit.dev/blog/tutorials/nextjs-app-router-project-structure) | Feature folders alongside `app/` in practice |
| C14 | [dharmsy — Next.js 16 App Router folder structure](https://www.dharmsy.com/blog/nextjs-16-app-router-folder-structure) | `_components` / route-group conventions in practice |
| C15 | [iamraghuveer — Server vs Client Components: drawing the right boundary](https://www.iamraghuveer.com/posts/nextjs-server-vs-client-components/) | The "healthy tree is overwhelmingly server" heuristic |
| C16 | [thetshaped.dev — Screaming Architecture & Colocation](https://thetshaped.dev/p/screaming-architecture-and-colocation-nodejs-typescript-react) | Combines the two principles into one structure |
| C17 | [Godel — FSD: A guide to scalable frontend architecture](https://www.godeltech.com/blog/feature-sliced-design-a-guide-to-scalable-frontend-architecture/) | Neutral third-party explanation of FSD |
| C18 | [Serghei — Where your types live matters more than you think](https://blog.serghei.pl/posts/where-your-types-live-matters/) | The three-tier type-placement ladder |
| C19 | [Hrynkevych — Screaming Architecture in Front-End](https://medium.com/@hrynkevych/screaming-architecture-in-front-end-de72d9ec961c) | Uncle Bob's principle applied to frontend |
| C20 | [Robin Wieruch / community — React feature-based folder structure](https://medium.com/@Srinivas.A/react-feature-based-folder-structure-4665e39939e9) | Community-level restatement, useful as a consensus check |

---

## Changelog

### 1.0.0 — 2026-08-03
Initial release. Research covering 53 sources; positions fixed on barrel files and on
prescribing a single default structure; overlaps with `react-best-practices` and
`next-best-practices` resolved.
