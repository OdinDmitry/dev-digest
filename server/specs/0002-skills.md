# 0002 — Skills (server)

## Why

Agents had a single static `system_prompt`: every reusable rule (a coverage
rubric, a naming convention, a security checklist) had to be copy-pasted into
each agent that wanted it, and there was no way to tell, after the fact, which
rules actually reached a given run's prompt.

Most of the schema/contract scaffolding for this already existed in the course
starter — `skills`, `skill_versions`, `agent_skills` tables, the `Skill`/
`SkillType`/`SkillSource`/`AgentSkillLink` contracts, and the agent-side link
routes (`GET|POST /agents/:id/skills`) — all migrated and wired, just unused.
This spec is what filled the gap: a `skills` CRUD module, an import path for
markdown/zip uploads, the wiring that actually resolves an agent's linked
skills into its prompt, and — in a second pass — version history with restore
and a per-skill "linked agent count" rollup for the redesigned client UI (see
[client spec 0002](../../client/specs/0002-skills.md)).

## What we decided

### A skill is text only

Name, a directive `description` (its interface — what the agent reads to
decide whether the skill applies, required non-empty on create), a `type`
(`rubric | convention | security | custom`), and a markdown `body`. No tools,
no code, no execution path — the body is inserted into the assembled prompt
verbatim and nothing else.

### New module: `server/src/modules/skills/`

`repository.ts` / `service.ts` / `routes.ts` / `helpers.ts` / `import.ts` /
`constants.ts`, registered in `modules/index.ts` alongside `agents`.

```
GET    /skills                            → list (workspace-scoped)
GET    /skills/stats                      → per-skill linked-agent rollup (rail)
GET    /skills/:id                        → one skill
POST   /skills                            → create
PUT    /skills/:id                        → update (a body change versions the skill)
DELETE /skills/:id                        → delete (versions + agent links cascade)
GET    /skills/:id/versions               → body-version history (newest first, no body)
GET    /skills/:id/versions/:version      → one historical snapshot (with body)
POST   /skills/:id/versions/:version/restore → restore a snapshot as a NEW version
POST   /skills/import/preview             → parse an upload; persists NOTHING
```

`GET /skills/stats` is registered **before** `GET /skills/:id` — otherwise
`IdParams`'s uuid check reads the literal `"stats"` and 422s instead of
returning the rollup (same hazard as `GET /agents/stats` vs `/agents/:id`).

Attaching a skill to an agent stays on the agents module
(`GET|POST /agents/:id/skills`), which already owned `agent_skills` — the
skills module never touches that link table's agent side, only reads it for
`countsByAgent`/`countsBySkill`.

### Versioning: body-only, unlike agents

`agent_versions` snapshots the whole config, so any field change bumps the
agent's version. `skill_versions` has only `(skill_id, version, body,
note?, created_at)`, so only a **body** change bumps the skill's version —
`isBodyChange` (`skills/helpers.ts`) is deliberately narrower than the
agents module's `isConfigChange`; a rename/retype/enable-toggle leaves the
version untouched.

A save that changes the body may carry an optional author `note` ("what
changed?"). It is forwarded to the snapshot **only when the body actually
changed** — a note on a rename-only patch has nothing to attach to and is
silently dropped (the client only shows the note field while the body is
dirty, so this stays unreachable from the UI). `note` is nullable; every v1
and every pre-existing snapshot has `note: null`.

`GET /skills/:id/versions` returns `{ skill_id, version, note, created_at,
lines_added, lines_removed }` per entry — **never the body**. Line counts are
computed server-side against the immediately-older snapshot (against `''` for
v1) with a pure `lineDelta()` (LCS-length DP, `skills/helpers.ts`), so the
history list can show a summary without shipping every historical body to the
browser. The body is fetched on demand via `GET /skills/:id/versions/:version`.

### Restore writes a NEW version

`POST /skills/:id/versions/:version/restore` copies a historical body forward
as the **next** version — never rewrites the old one. Three reasons: the
`(skill_id, version)` PK with `onConflictDoNothing` makes rewriting a past
version impossible without a destructive delete; `skills.version` staying
monotonic is the only sane reading of the version badge in the UI; and history
staying append-only is what makes the "eval runs stay reproducible against the
exact text they scored" promise true. Restoring the **current** version is a
genuine no-op (reuses `update()`, which only versions on an actual body
change) — no new row, `skills.version` unchanged.

### Import: markdown or zip, preview-then-confirm, executables never read

Upload arrives as JSON, not multipart (multipart bypasses the zod type
provider): plain `content` for `.md`, base64 `content_base64` for `.zip`
(route-level `bodyLimit` raised above the 1 MiB app default, since base64
inflates by 4/3). `fflate`'s `unzipSync({ filter })` decides per-entry
**before decompression** — an executable extension (`.sh .py .js .exe …`) or
a `bin/`/`scripts/` path segment is refused there, so its bytes are never
inflated, let alone parsed or stored. `POST /skills/import/preview` returns
the parsed result (name/description/type/body/skipped-list) and writes
nothing; the client confirms via the normal `POST /skills`, with
`source: 'imported_url'` and **`enabled: false`** — an imported skill's body
is instructions in someone else's voice, and enabling it is a deliberate,
separate act.

`source: 'imported_url'` covers every upload (file or zip) — `extracted`
means mined from this repo's own code (a later lesson), `community` means the
curated catalog (not built), `manual` means typed here.

### No `wrapUntrusted` on skill bodies

`reviewer-core`'s `INJECTION_GUARD` tells the model that content inside
`<untrusted>` blocks must be ignored as instructions. A skill body genuinely
IS meant as an instruction (a rubric telling the model what to check), so
wrapping every skill would silently neuter the feature. The trust boundary is
product-level instead: the import preview shows the full body plus everything
skipped, and the skill lands disabled until the user explicitly turns it on.

### Prompt wiring

`ReviewRunExecutor.buildSkillBodies()` (`modules/reviews/run-executor.ts`)
resolves an agent's linked skills via `AgentsRepository.linkedSkills` (already
ordered by `agent_skills.order` — the client's drag order), filters out any
individually-disabled skill, and passes the surviving bodies to
`reviewPullRequest({ skills })`. Omitted entirely when the list is empty, so
an agent with no skills gets a byte-identical prompt to before this feature
existed. Logged via `RunLogger` (`Skills: N/M linked skill(s) injected …`) so
a run's Live Log shows which skills fired without opening the trace.
`assemblePrompt` already had the `skills` slot and the `## Skills / rules`
section — this only closes the gap where nothing populated it.

## Out of scope

- Per-skill "% pulled into a run" / "% accepted" metrics — nothing records
  which skills entered which run, and `findings` carry no skill attribution;
  both would need a new join table and are left to the eval/stats lesson.
- URL import and the community catalog — the i18n keys exist as course
  scaffolding but no route/hook backs them.
- Syntax highlighting in the body editor — line numbers only, no new
  dependency.
- Rewriting a past `skill_versions` row — restore always appends.

## Once shipped

Implemented, tested (`server/test/skills*.test.ts`, `.it.test.ts` variants
against real Postgres) and verified live. Fold the still-true parts into
`server/CLAUDE.md` (`Where things live` — add the `skills` module next to
`agents`) when convenient; this spec is being kept rather than deleted per
explicit request, as the record of what was decided and why.
