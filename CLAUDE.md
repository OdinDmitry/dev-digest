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
- `/impl <plan-path>` ([.claude/commands/impl.md](.claude/commands/impl.md)) —
  runs an approved plan end to end: implement → architecture review ∥ tests →
  fix loop → verify. `spec-creator` and `implementation-planner` stay manual,
  by design.
- `/impl-sec <plan-path>`
  ([.claude/commands/impl-sec.md](.claude/commands/impl-sec.md)) — same chain
  with `security-reviewer` in Phase 2; use for auth, input handling, secrets,
  or new API surface.

## Evals — self-check after harness changes
The harness (skills, subagents, `CLAUDE.md`) is testable like any other code.
[evals/](evals/README.md) is a standalone package (`cd evals && pnpm install`);
locally it runs on the **Claude Code subscription** — no API key, the runner
strips `ANTHROPIC_API_KEY` on purpose. Route each change to its minimum check:

| Change | Minimum check |
|--------|---------------|
| `.claude/skills/**` | `pnpm eval:quality` + `pnpm vitest run skills/<name>` |
| `.claude/agents/**` | `pnpm vitest run agents/<name>` + `pnpm eval:workflow` |
| `CLAUDE.md` / routing rules | `pnpm eval:workflow` |
| an eval case or a grader | re-calibrate the baseline (below) |

Re-calibration is a **labeled series**, never a single run — capture the
baseline label *before* the edit, there is no way to reconstruct it after:

```bash
pnpm eval:repeat skills/<name> -n 5 --label baseline   # BEFORE the edit
pnpm eval:repeat skills/<name> -n 5 --label candidate  # AFTER
pnpm eval:delta baseline candidate                     # per-practice diff
```

CI ([.github/workflows/evals.yml](.github/workflows/evals.yml)) mirrors this:
`eval:quality` is **blocking**; the model tiers only publish a report, because
they cost money and fluctuate between runs. A blocking threshold gets added to
a model tier only once its case set is stable.

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
