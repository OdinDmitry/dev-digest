# Skills

Reusable AI skills that provide specialized knowledge and workflows. Canonical location is `.claude/skills/` with a symlink at `.cursor/skills/ → ../.claude/skills` for Cursor compatibility. Shared with the team via version control.

## Catalog

| Skill | Scope | Description |
|-------|-------|-------------|
| [onion-architecture](onion-architecture/SKILL.md) | Backend | Which ring code belongs to — domain/ports/services/adapters/delivery, import direction, module anatomy |
| [fastify-best-practices](fastify-best-practices/SKILL.md) | Backend | Fastify routes, plugins, JSON-schema validation, error handling |
| [drizzle-orm-patterns](drizzle-orm-patterns/SKILL.md) | Backend | Drizzle schema, queries, relations, transactions, migrations |
| [postgresql-table-design](postgresql-table-design/SKILL.md) | Backend | Postgres schema design, data types, indexing, constraints |
| [frontend-ui-architecture](frontend-ui-architecture/SKILL.md) | Frontend | Where code lives — folder structure, feature boundaries, dependency rules, business-logic placement |
| [next-best-practices](next-best-practices/SKILL.md) | Frontend | Next.js App Router, RSC boundaries, data fetching, optimization |
| [react-best-practices](react-best-practices/SKILL.md) | Frontend | React anti-patterns, state management, hooks rules |
| [react-testing-library](react-testing-library/SKILL.md) | Frontend | General-purpose React Testing Library guide with Vitest |
| [zod](zod/SKILL.md) | Full-stack | Zod schema validation, parsing, error handling, type inference |
| [typescript-expert](typescript-expert/SKILL.md) | Full-stack | Type-level programming, performance, tooling, migrations |
| [security](security/SKILL.md) | Full-stack | OWASP Top 10:2025, auth, injection, uploads, secrets |
| [ears-acceptance-criteria](ears-acceptance-criteria/SKILL.md) | Specs | EARS patterns, translating a vague ask into one testable criterion, AC-identifier rules, validation checklist |
| [accessibility-requirements](accessibility-requirements/SKILL.md) | Specs | What to interrogate for a11y and how to phrase it as a requirement — not as markup |
| [pr-self-review](pr-self-review/SKILL.md) | Shared | Pre-PR gate — routes the diff to the skills that govern it; a CRITICAL finding blocks `gh pr create` |
| [mermaid-diagram](mermaid-diagram/SKILL.md) | Shared | Mermaid diagrams in markdown (flowcharts, sequence, ERD, …) |
| [engineering-insights](engineering-insights/SKILL.md) | Shared | Reads/writes per-module `insights.md` — non-obvious discoveries, append-only |
| [workflow-retro](workflow-retro/SKILL.md) | Shared | Manual-only post-run retro of a multi-agent workflow — quick (in-context) or `deep` (reads disk transcripts); appends a row to `docs/retro/ledger.md` |

## What Are Skills?

Skills are modular packages that extend the AI agent with specialized knowledge and workflows. Unlike rules (always applied) or agents (invoked for specific tasks), skills are loaded on-demand when the agent determines they're relevant.

### Skills vs Rules vs Commands vs Agents

| Type | Scope | Loaded | Purpose |
|------|-------|--------|---------|
| **Rules** (`.mdc`) | Project conventions | Always or by file pattern | Persistent guardrails |
| **Commands** (`.md`) | User actions | On `/command` invocation | Slash commands |
| **Skills** (`.md`) | Domain knowledge | On-demand by agent | Specialized knowledge |
| **Agents** (`.md`) | Workflows | Via Task tool | Subagent orchestration |

## Creating New Skills

Each skill has:

- `SKILL.md` — Main skill file with rules and conventions (required)
- `examples.md` — Code examples showing good/bad patterns (recommended)
- `references.md` or `README.md` — Sources, rationale, version/changelog (optional)
- Additional topic files — loaded on demand; link them from `SKILL.md` with a note on
  when to read each, so the agent only pulls in what it needs
