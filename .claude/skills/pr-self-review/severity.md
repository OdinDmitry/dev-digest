# Severity, the CRITICAL list, and what not to report

Inline this whole file into every reviewer subagent prompt. Do not summarise it — a rubric
that each agent interprets on its own is not a rubric.

---

## Vocabulary

`CRITICAL` · `WARNING` · `SUGGESTION` — the same three levels the review engine uses in
[server/src/vendor/shared/contracts/findings.ts](../../../server/src/vendor/shared/contracts/findings.ts),
ranked in [reviewer-core/src/output/to-review.ts](../../../reviewer-core/src/output/to-review.ts)
(`SEV_RANK`). Categories are the contract's `bug | security | perf | style | test`, plus
`architecture` for ring/placement findings, which the contract has no category for.

## Confidence before severity

Borrowed from [security/SKILL.md](../security/SKILL.md), and it applies to every domain, not
just security:

| Confidence | Meaning | What you do |
|---|---|---|
| HIGH | The rule-violating pattern is present *and* you have traced why it matters here | Report with severity |
| MEDIUM | Pattern present, consequence unverified | One line under "worth a look", no severity |
| LOW | Might be a problem depending on things you cannot see | Say nothing |

A gate that fires on speculation gets disabled within a week. When in doubt, drop it.

---

## CRITICAL — the closed list

Nine triggers. **Nothing else is CRITICAL**, however bad it looks. If you believe something
belongs on this list, say so in the report as a WARNING and propose the addition — do not
promote it yourself.

1. **Secret exposure.** A token, key or credential appears in the diff; or a secret is read
   from `process.env` outside `server/src/adapters/secrets/local.ts` and
   `server/src/platform/config.ts`. Secrets belong in `~/.devdigest/secrets.json` behind
   `SecretsProvider` — the single read chokepoint.

2. **Hand-edited migration.** An **existing** file under `server/src/db/migrations/` is
   modified, renamed or deleted, or `meta/_journal.json` is rewritten rather than appended
   to. Marked do-not-touch in [server/CLAUDE.md](../../../server/CLAUDE.md).

   A migration produced by `pnpm db:generate` is **not** this finding. The two are
   distinguishable mechanically, so do not decide from the author's description or from the
   fact that a plan asked for it: generation only ever *adds* an `NNNN_name.sql` and a
   matching `meta/NNNN_snapshot.json`, and only ever *appends* to `meta/_journal.json`.
   Rewriting a `.sql` that has already run against someone's database is what this rule
   exists to catch. Verify with commands, never by eye:

   ```bash
   # a. an existing artifact modified, renamed or deleted (journal handled by b.)
   git diff --name-status "$BASE" -- server/src/db/migrations \
     | grep -E '^(M|D|R)' | grep -v '_journal\.json'
   # b. journal rewritten instead of appended to
   git diff "$BASE" -- server/src/db/migrations/meta/_journal.json \
     | grep -E '^-' | grep -v '^---'
   # c. a .sql hand-written rather than generated — no snapshot beside it
   for f in server/src/db/migrations/*.sql; do
     n="$(basename "$f" | cut -c1-4)"
     [ -f "server/src/db/migrations/meta/${n}_snapshot.json" ] || echo "orphan: $f"
   done
   ```

   Output from any of the three is the finding. All three silent means the migration was
   generated: **no severity**, and the report states the counts among its clean results —
   "N migration file(s) added, no existing file modified, journal append-only". Report it
   either way, so a reader can see the check ran rather than inferring it from silence.

   Note `a.` and `b.` use `git diff "$BASE"` without `...HEAD`, so they cover the working
   tree as well as commits. A new migration is normally **untracked** and therefore invisible
   to both — which is correct, since adding one is the legitimate case. That is also why the
   old path-based trigger ("any changed file under the directory") fired on every schema PR:
   it was reading presence, not shape. `c.` is what keeps a hand-written `.sql` from slipping
   through on the same technicality.

3. **Desynced contract copy.** `server/src/vendor/shared/**` changed without the identical
   change in `client/src/vendor/shared/**` (or vice versa). These are copies, not linked
   packages — the drift is silent and shows up as a runtime shape mismatch. Verify with a
   command, never by eye — and scope it to the files **this change touched**, because a
   whole-tree comparison reports the repository's standing debt as though the PR caused it:

   ```bash
   V="server/src/vendor/shared client/src/vendor/shared"
   { git diff --name-only "$BASE" -- $V
     git ls-files --others --exclude-standard -- $V   # a brand-new contract is untracked
   } | sed -E 's#^(server|client)/src/vendor/shared/##' | sort -u \
     | while read -r f; do
         diff -q "server/src/vendor/shared/$f" "client/src/vendor/shared/$f"
       done
   ```

   The `ls-files --others` line is load-bearing: a contract added by this change is untracked,
   `git diff` does not list it, and without that line the loop runs zero times and reports a
   clean result for the one file most likely to be desynced. Verify the loop actually iterated
   before trusting its silence.

   Any output is the finding: this change edited one copy of a contract and not the other.
   No output — including when the PR touches neither tree, and the loop therefore runs zero
   times — means the rule does not fire.

   Pre-existing drift is a **separate matter and never CRITICAL here.** `diff -r` across the
   two trees will often print something in a repository that has accumulated debt; that is
   worth one line under the report's clean results ("N file(s) already diverged at the merge
   base, untouched by this change — separate cleanup"), and nothing more. A gate that blocks
   a PR for debt it did not create teaches the author to override the gate.

4. **Inverted import direction** (`onion-architecture`):
   - `drizzle-orm` or `db/schema` imported in a `service.ts` or `routes.ts`
   - `fastify` imported outside `modules/*/routes.ts` and `src/app.ts`
   - a concrete adapter constructed (`new OctokitGitHubClient(...)`, `new OpenAIProvider(...)`)
     anywhere but `platform/container.ts`
   - `db/rows.js` imported into a `service.ts` or `routes.ts`

5. **Ring-0 purity broken.** Anything under `reviewer-core/src/**` importing `fs`, `node:*`,
   `pg`, an HTTP client, or any I/O. That package must stay testable with nothing but an
   injected `LLMProvider`.

6. **Injection defense weakened.** `INJECTION_GUARD` or `wrapUntrusted()` in
   `reviewer-core/src/prompt.ts` removed, narrowed, or bypassed for some prompt section.
   Adding a keyword denylist alongside it also counts — that is a documented non-goal.

7. **DB-backed test without the `*.it.test.ts` suffix.** A new or changed test under
   `server/test/` that touches Postgres but is named `*.test.ts`. The CI unit job runs
   `vitest run --exclude '**/*.it.test.ts'` with no database — this breaks `server-unit.yml`
   for everyone.

8. **React correctness bug** (`react-best-practices`, its CRITICAL tier): a hook called
   conditionally or in a loop, array index used as `key` in a list that can reorder, direct
   mutation of state or props.

9. **Unguarded new endpoint.** A new route that declares no zod `params`/`body` schema via
   `fastify-type-provider-zod`, or that skips an authorization check its sibling routes in
   the same module perform.

Everything else:

- **WARNING** — file in the wrong folder, business logic in the wrong ring without an import
  violation, missing test for new behaviour, N+1 query, unnecessary client component,
  duplicated logic, a workflow whose `paths:` filter no longer covers what it tests.
- **SUGGESTION** — naming, ordering, comment density, anything a linter would own.

---

## Do not report

Each of these is a false positive this repo produces reliably. Check the list before
writing a finding.

- **Grandfathered onion violations.** Listed in
  [onion-architecture/SKILL.md](../onion-architecture/SKILL.md) §"Accepted violations":
  Drizzle queries inside `pulls`/`polling`/`settings`/`workspace` `routes.ts` and
  `settings/feature-models.ts`; the four existing services taking `Container`; row types in
  ring-2 signatures in `reviews` and `repos` (`AgentRow`, `typeof schema.repos.$inferSelect`
  in `run-executor.ts`, `diff-loader.ts`, `repos/helpers.ts`). Flag only *new* instances or
  *extensions* of these — and note that a deliberate cleanup of one is legitimate work, not
  a violation.
- **The empty future-lesson tables.** `ci`, `eval`, `skills`, `knowledge` and friends in
  `server/src/db/schema/` are meant to sit unused — this is a course starter. Not dead code.
- **Anything outside the changed lines.** Pre-existing problems in a file you happen to be
  reading are not this PR's findings.
- **Pure file moves.** A path change with identical content is not a placement finding
  unless the *new* path violates a rule.
- **Missing lint fixes.** No package has a `lint` script and there is no ESLint/Prettier/
  Biome config anywhere. Style points are SUGGESTION at most, and mostly not worth writing.
- **Missing `Schema.parse(req.body)`.** Routes are supposed to declare zod schemas
  declaratively; hand-rolled parsing in a handler is the anti-pattern, not the fix.
- **`reviewer-core` imported as source.** The tsconfig path alias
  `@devdigest/reviewer-core` → `../reviewer-core/src` is deliberate, not a build mistake.
- **Optional prompt slots left `undefined`.** `skills`, `memory`, `specs`, `callers` in the
  prompt assembler are unwired on purpose.

---

## How to word a finding

Per [onion-architecture/review-checklist.md](../onion-architecture/review-checklist.md):
name the consequence and the concrete move, not the principle.

> This query in `routes.ts` puts persistence in ring 4 — it makes the use case unreachable
> from a job and untestable without a server; move it to `repository.ts` behind a service
> method.

lands, and is actionable. "Please use the repository pattern" does not.

For a CRITICAL, always state which of the nine triggers it is. The author needs to know the
gate is predictable, not that a model formed an opinion.
