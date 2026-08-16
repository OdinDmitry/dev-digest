# client/ — agent map

`@devdigest/web` — Next.js 15 studio: import repos, browse PRs, run/read AI
reviews, author agents. Full picture: [README.md](README.md).

Before starting work here, read [insights.md](insights.md) — treat it as
high-confidence guidance unless told otherwise. At the end of the task,
update it; don't skip this step.

## Commands
`pnpm dev` (:3000) · `pnpm build` · `pnpm start` · `pnpm test` (vitest +
jsdom, fetch mocked) · `pnpm test:unit` (alias of `pnpm test` — every client
test is hermetic; exists so agents can use one command name across modules) ·
`pnpm typecheck`

Add `--reporter=dot` when an agent runs these, to keep the output out of the
agent's context.

## Where things live
- `src/app/**/page.tsx` — routes (App Router): `/repos/:repoId/pulls`,
  `/pulls/:number`, `/agents`, `/agents/:id`, `/settings/:section`, `/onboarding`
- `src/lib/api.ts` — API base client · `src/lib/hooks/*` — one TanStack Query
  hook file per resource, the only place that talks to the API
- `src/components/app-shell` — nav, breadcrumbs, `g`-then-key shortcuts
  (cross-cutting chrome)
- `src/app/**/_components/<Name>/` — colocated feature components, each with
  its own `*.test.tsx`
- `src/vendor/ui` (`@devdigest/ui`) — UI primitives · `src/vendor/shared`
  (`@devdigest/shared`) — Zod contracts, both vendored copies
- `messages/<locale>/*.json` — next-intl translations

## Further reading (load only if relevant to the task)
- [docs/](docs/) — deep dives per topic
- [../docs/specs/](../docs/specs/README.md) — specs for planned features (what/why)
- [../docs/plans/](../docs/plans/README.md) — Development Plans (how)

## Non-default conventions
- Pages are thin; feature logic sits in colocated `_components/` folders, not
  in `page.tsx`.
- Data fetching goes through a hook in `src/lib/hooks/*`, never a raw `fetch`
  in a component.
- API base is `NEXT_PUBLIC_API_BASE` (default `http://localhost:3001`).

## Gotchas
- Component tests mock `fetch` — they need neither the real API nor a
  browser. Real browser journeys live in [../e2e](../e2e/CLAUDE.md), not here.
- `src/vendor/ui` and `src/vendor/shared` are copies, not npm packages — a
  contract change in `@devdigest/shared` must be manually re-synced here.

## Do-not-touch
