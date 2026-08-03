# Routing — changed file → domain → skills

Read this at step 2. The globs deliberately track the `paths:` filters of the five CI
workflows in `.github/workflows/`, so a file that triggers a CI job also triggers the
matching review domain.

Paths are repo-relative and use `/` on every platform.

---

## Domains

| Domain | Globs | Skills the subagent must read |
|---|---|---|
| `frontend-ui` | `client/src/app/**`, `client/src/components/**`, `client/src/vendor/ui/**`, `client/src/lib/**`, `client/messages/**`, `client/*.mjs` | `frontend-ui-architecture/SKILL.md` + `structure.md` + `nextjs.md`; `react-best-practices/SKILL.md`; `next-best-practices/SKILL.md` |
| `frontend-tests` | `client/src/**/*.test.ts`, `client/src/**/*.test.tsx`, `client/src/test/**` | `react-testing-library/SKILL.md` |
| `backend-api` | `server/src/modules/**`, `server/src/adapters/**`, `server/src/platform/**`, `server/src/app.ts`, `server/src/server.ts` | `onion-architecture/SKILL.md` + `review-checklist.md`; `fastify-best-practices/SKILL.md` + the `rules/` files that match the diff |
| `backend-db` | `server/src/db/schema/**`, `server/src/db/client.ts`, `server/src/db/seed.ts`, `server/src/db/seed-prompts.ts`, `server/src/db/rows.ts`, `server/drizzle.config.ts` | `drizzle-orm-patterns/SKILL.md` + the matching `references/` file; `postgresql-table-design/SKILL.md` |
| `migrations` | `server/src/db/migrations/**` | none — see below |
| `contracts` | `server/src/vendor/shared/**`, `client/src/vendor/shared/**`, `server/src/modules/_shared/schemas.ts` | `zod/SKILL.md` + the matching `references/` files |
| `review-engine` | `reviewer-core/src/**`, `reviewer-core/test/**` | `onion-architecture/SKILL.md` (ring-0 purity rules); `typescript-expert/SKILL.md` |
| `backend-tests` | `server/test/**` | `server/CLAUDE.md` conventions — no dedicated skill |
| `e2e` | `e2e/**` (excluding `e2e/test-results/**`) | `e2e/CLAUDE.md` conventions — no dedicated skill |
| `security` | cross-cutting, see below | `security/SKILL.md` + `checklists.md` |
| `docs-config` | `**/*.md`, `.github/**`, `scripts/**`, `**/package.json`, `**/tsconfig.json`, `**/vitest.config.ts`, `docker-compose.yml` | none — handled inline |

---

## Rules that the table cannot express

**`security` is additive, never a replacement.** It runs *alongside* the domain that owns
the file, whenever the diff touches any of:

- `server/src/modules/*/routes.ts` — new or changed endpoints
- `server/src/adapters/**` — anything talking to the outside world
- `server/src/platform/config.ts`, `server/src/adapters/secrets/**`
- `reviewer-core/src/prompt.ts` — the injection defense lives here
- any `.env*`, or a diff hunk containing a token-shaped literal

**`security/SKILL.md` is written for the wrong stack.** Its rules assume React + Express +
MongoDB + JWT. Tell the subagent, in the prompt: apply only the stack-independent parts —
secret handling, authorization, input validation, injection as a class, upload handling —
and ignore the Mongoose/Express-specific guidance. This repo is Fastify + Drizzle/Postgres,
and `fastify-type-provider-zod` already handles a category of input validation that skill
would otherwise flag as missing.

**`typescript-expert` is conditional.** Load it only when the diff introduces generics,
conditional/mapped types, `as` assertions, `any`, or declaration merging. Do not attach it
to every `.ts` file — it is a deep-typing skill, not a linter.

**`migrations` needs no reviewer.** `server/src/db/migrations/` is do-not-touch per
[server/CLAUDE.md](../../../server/CLAUDE.md). A changed file under it is an automatic
CRITICAL (rule 2 in `severity.md`); no subagent, no skill reading. If the change is
deliberate and coordinated, it is the author's job to say so — the gate still fires.

**`contracts` always pulls the vendor-sync check.** `server/src/vendor/shared/**` is the
source of truth; `client/src/vendor/shared/**` is a manual copy (root
[CLAUDE.md](../../../CLAUDE.md)). Whenever the domain is active, compare the two trees
byte-for-byte and raise CRITICAL rule 3 on any divergence — this is a check to *run*, not a
judgement to make by eye.

**`docs-config` gets no subagent.** Handle it in the main agent: confirm a changed workflow
still has `paths:` filters covering the packages it tests, that a changed `package.json`
does not remove a script CI invokes, and that a changed `CLAUDE.md`/`insights.md` is not
contradicting a skill. Findings here are WARNING at most.

**`backend-tests` and `e2e` have no skill file.** The reviewer reads the module's
`CLAUDE.md` instead. For `server/test/**` the load-bearing rule is the `*.it.test.ts`
suffix (CRITICAL rule 7 — it breaks the CI unit job). For `e2e/**` it is deterministic
locators only, never the AI `chat` command, and flows target the read-only seeded fixtures.

**Unmatched files.** A changed file matching no glob goes to `docs-config` for a sanity
look. Do not invent a domain for it, and do not skip it silently — list it in the report's
domain table so the gap is visible.
