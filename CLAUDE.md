# DevDigest — agent map

Local-first AI PR review, course starter template. 5 standalone packages, no
workspace root — each has its own `package.json`/lockfile; cross-package code
is shared through tsconfig path aliases + vendored copies, not published
modules. Full picture: [README.md](README.md).

## Stack
Node ≥22 · pnpm ≥10 · Docker (Postgres only) · Fastify 5 · Next.js 15 ·
Drizzle ORM + Postgres/pgvector · Zod contracts shared across every package.

## Commands
`./scripts/dev.sh` boots everything (Postgres → migrate → seed → API :3001 →
web :3000). Per-package commands live in each module's own CLAUDE.md.

## Modules
- [server/CLAUDE.md](server/CLAUDE.md) — Fastify API, DI container, DB, repo-intel indexer
- [client/CLAUDE.md](client/CLAUDE.md) — Next.js studio (UI)
- [reviewer-core/CLAUDE.md](reviewer-core/CLAUDE.md) — pure review engine (diff → LLM → grounded findings)
- [mcp/CLAUDE.md](mcp/CLAUDE.md) — local stdio MCP server (Claude Code / Desktop → the API)
- [e2e/CLAUDE.md](e2e/CLAUDE.md) — deterministic browser e2e (agent-browser, no LLM)

## Feature documents
- [docs/specs/](docs/specs/README.md) — SDD specs: **what** a feature must do
  and why, in EARS acceptance criteria. Written by `spec-creator`,
  implementation-free.
- [docs/plans/](docs/plans/README.md) — Development Plans: **how** it gets
  built, task → AC → test. Written by `implementation-planner`.
- [.claude/agents/README.md](.claude/agents/README.md) — the agent chain that
  produces and consumes both.

## Non-default conventions
- This is a **course starter**: the DB schema already contains every table
  future lessons need. Unused ones (`ci`, `eval`, `skills`, `knowledge`, …)
  are expected to sit empty — don't repurpose or "clean them up".
- Shared code (`@devdigest/shared` Zod contracts, `@devdigest/ui`) is
  **copied**, not npm-linked, into `*/src/vendor/*`. A change to the source
  package must be manually re-synced into each vendor copy.

## Gotchas
- Migrations are **not** run on server boot — `cd server && pnpm db:migrate`.
- Secrets (LLM keys, `GITHUB_TOKEN`) live in `~/.devdigest/secrets.json`
  (mode `0600`), never in git or the database.
- `docker compose down -v` deletes the `devdigest_pgdata` volume — wipes every
  imported repo/review. Don't run it to "just restart" Postgres.
- `.mcp.json` points at `mcp/dist/index.js` — run `cd mcp && pnpm install &&
  pnpm build` once, or Claude Code shows the `devdigest` server as failed.

## Do-not-touch
