# server/ — agent map

`@devdigest/api` — Fastify 5 + Drizzle/Postgres. Imports repos/PRs, indexes
via repo-intel, runs the reviewer, stores results. Full picture:
[README.md](README.md).

Before starting work here (including its `repo-intel` submodule), read
[insights.md](insights.md) — treat it as high-confidence guidance unless
told otherwise. At the end of the task, update it; don't skip this step.

## Commands
`pnpm dev` (:3001) · `pnpm build` · `pnpm test` (unit+integration) ·
`pnpm typecheck` · `pnpm db:migrate` · `pnpm db:seed` · `pnpm db:generate`

## Where things live
- `src/modules/<name>/routes.ts` — one Fastify plugin per domain: `agents`,
  `intent`, `polling`, `pulls`, `repo-intel`, `repos`, `reviews`, `settings`,
  `workspace`
- `src/adapters/*` — ports (llm, github, git, astgrep, secrets, tokenizer,
  embedder, depgraph, codeindex), swapped for `adapters/mocks.ts` in tests
- `src/platform/container.ts` — DI wiring · `src/platform/config.ts` — env config
- `src/db/schema/*` — Drizzle schema, one file per domain (full future-lesson
  set already present, see root [CLAUDE.md](../CLAUDE.md))
- `src/prompts/` — built-in agent system prompts

## Further reading (load only if relevant to the task)
- [docs/](docs/) — deep dives per topic
- [specs/](specs/) — design specs for planned/in-progress features

## Non-default conventions
- Routes declare zod `params`/`body` schemas via `fastify-type-provider-zod`
  — never hand-roll `Schema.parse(req.body)` in a handler.
- DB-backed tests **must** use the `*.it.test.ts` suffix (drives the
  unit/integration split in CI); everything else must stay hermetic.
- `reviewer-core` is consumed as TypeScript **source** via a tsconfig path
  alias (`@devdigest/reviewer-core` → `../reviewer-core/src`), not a built
  package.

## Gotchas
- `REPO_INTEL_ENABLED` defaults to `true`; an unindexed repo silently
  degrades to diff-only context rather than erroring.
- Migrations are **not** applied on boot — `pnpm db:migrate` manually.
- Secrets go through `SecretsProvider` (`~/.devdigest/secrets.json`), not
  `AppConfig`/env — the one read chokepoint is `adapters/secrets/local.ts`.
- `INJECTION_GUARD` (appended to every agent prompt in
  `reviewer-core/prompt.ts`) is the prompt-injection defense — don't add a
  keyword denylist on top, it's a deliberate non-goal.

## Do-not-touch
- server/src/db/migrations/ - never hand-edit without coordination
