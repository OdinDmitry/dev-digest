# Development Plan: Project Context — browse, preview, attach (part 1 of 2)

Spec: docs/specs/cross/SPEC-01-project-context.md
Date: 2026-08-16
Execution mode: single-agent

**This plan covers AC-1…AC-10 and AC-12…AC-18 only.** AC-11 and AC-19…AC-28
(run-time injection, prompt block, trace segment) are in
[2026-08-16-project-context-run-injection.md](2026-08-16-project-context-run-injection.md),
which depends on everything below and must run second. Between the two plans
every AC-1…AC-28 appears exactly once.

AC-11 sits in plan 2 deliberately: "assembled project context" is only
observable from outside the system at run time, and the spec verifies AC-11 by
server integration. The *pure* ordering/de-duplication rules it shares with
AC-12/AC-13 are built and unit-tested here (`helpers.assembleEntries`), so
plan 2 only adds text reading, the budget and the prompt.

## Goal

Make every markdown document in an imported repository's working copy
browsable and previewable in DevDigest, let the user attach an ordered set of
those documents to an agent or to a skill, and show a deterministic,
model-independent token count per document, per listing and per attached set —
all with no model call and no writes to the repository.

## Out of scope

- Creating, editing, uploading, renaming or deleting documents. The `Edit`
  toggle and the new-file / new-folder / upload icons in mockup 01 are rendered
  inert (or omitted) — spec Non-goals.
- Chunking, embedding, semantic retrieval. The footer states a token total, not
  a chunk count.
- The COVERAGE ring in mockup 01 and the pull%/accept% figures on the skill and
  agent cards. The ring is **not rendered at all** — nothing occupies that space.
- Non-markdown documents, and documents from anywhere other than the imported
  repository's working copy.
- Injecting anything into a run, the `## Project context` prompt block, the run
  trace and its segments — all of that is plan 2.
- Re-pointing an attachment when a document is renamed or moved.
- Per-run overrides of the attached set.
- Any change to how skills, memory, repo skeleton or diff segments are assembled.

## Constraints

- **Root CLAUDE.md** — `@devdigest/shared` and `@devdigest/ui` are *copied*, not
  linked. A contract change must be applied by hand to `server/src/vendor/shared`
  **and** `client/src/vendor/shared`. There is no source package; the two vendor
  copies are the source of truth. `reviewer-core` resolves
  `@devdigest/shared` to *server's* copy (`reviewer-core/tsconfig.json`), so
  there is no third copy.
- **server/CLAUDE.md do-not-touch** — `server/src/db/migrations/` must never be
  hand-edited. Generate with `pnpm db:generate` only.
- **server/CLAUDE.md** — routes declare zod `params`/`body`/`querystring` via
  `fastify-type-provider-zod`; never `Schema.parse(req.body)` in a handler.
  DB-backed tests **must** use the `*.it.test.ts` suffix.
- **server/CLAUDE.md** — migrations are not run on boot; `pnpm db:migrate` after
  T4.
- **client/CLAUDE.md** — pages are thin; feature logic lives in colocated
  `_components/`. Data fetching goes through a hook in `src/lib/hooks/*`, never
  a raw `fetch` in a component.
- **server/insights.md 2026-08-04** — `drizzle-kit generate` hangs on an
  interactive prompt when a diff both removes and adds columns on one table.
  T3/T4 add a brand-new table only, so no prompt is expected; if one appears,
  stop rather than piping input.
- **server/insights.md 2026-08-04** — before naming any new contract type, grep
  the whole `contracts/` folder: a collision surfaces only at the barrel
  (`TS2308`), not in the file you edited. `SpecFile` and `IndexStatus` already
  exist under a `// ---- Project Context ----` heading in
  `contracts/platform.ts`; they are unused scaffolding for the (out-of-scope)
  editing feature and must **not** be repurposed or edited.
- **server/insights.md 2026-08-07** — `path.relative`/`path.join` return
  OS-native separators. Every repository-relative path this feature stores,
  returns or compares is POSIX (`/`), normalised with
  `.split(sep).join('/')`. Never hand-roll `lastIndexOf('/')` on a joined path.
- **client/insights.md 2026-08-05** — `messages/en/context.json` already exists
  with `title`, `empty.title`, `empty.body`, `loadError`, `kb`,
  `mode.preview`, `reindex`/`resync`. Reuse those keys; only add what is
  genuinely new. `chunks` is superseded by a token total and stays unused.
- **client/insights.md 2026-08-08** — `@testing-library/user-event` is **not**
  installed. Use `fireEvent`.
- **client/insights.md 2026-08-08** — `requestAnimationFrame` callbacks can
  silently never fire in this project's browser harness. Use `setTimeout` for
  any "wait a tick then touch the DOM" step (T17's focus restore).
- **client/insights.md 2026-08-04** — a drag-reorder list needs an optimistic
  mutation *and* `await qc.cancelQueries(...)` first, or an in-flight GET
  resurrects the pre-drag order.
- **Non-functional (spec)** — max document size 256 KB; discovery limit 2,000
  documents/repo; project-context budget 20,000 tokens; token counts produced
  with no model call; identical content ⇒ identical count; a document's count
  is the same regardless of the owning agent or its model.
- **Non-functional (spec, a11y)** — every per-document control (attach toggle,
  reorder handle, preview control) carries an accessible name naming both the
  action and the document; interactive targets ≥ 24×24 CSS px; token counts and
  source-folder badges ≥ 4.5:1 contrast (use `--text-secondary`/`--text-primary`,
  not `--text-muted`); the source folder is conveyed by text, never colour alone.
- **Tenancy** — every read and write is scoped to the requesting user's
  workspace via `getContext(app.container, req)`; repos, agents and skills are
  resolved workspace-scoped before any attachment is read or written.

## Affected modules & files

**server**

- `src/vendor/shared/contracts/context.ts` — **new** contracts (T1)
- `src/vendor/shared/index.ts` — export the new contract file (T1)
- `src/db/schema/context.ts` — add the `contextAttachments` table (T3)
- `src/db/schema.ts` — barrel import + `schema` object entry (T3)
- `src/db/migrations/00NN_*.sql` + `meta/` — **generated** (T4)
- `src/adapters/tokenizer/index.ts` — widen the documented scope (T7)
- `src/modules/context/constants.ts` — **new** (T5)
- `src/modules/context/scan.ts` — **new**, the only fs-touching file (T6)
- `src/modules/context/repository.ts` — **new**, the only file touching
  `context_attachments` (T8)
- `src/modules/context/helpers.ts` — **new**, pure transforms (T9)
- `src/modules/context/service.ts` — **new**, ring-2 use cases (T10)
- `src/modules/context/routes.ts` — **new**, Fastify plugin (T11)
- `src/modules/index.ts` — register the module (T11)
- `test/context-scan.test.ts`, `test/context-helpers.test.ts`,
  `test/context.it.test.ts` — **new** (T21–T23)

**client**

- `src/vendor/shared/contracts/context.ts`, `src/vendor/shared/index.ts` —
  hand-synced copies of the server's (T2)
- `src/vendor/ui/nav.ts` — nav entry + shortcut (T13)
- `src/vendor/ui/primitives/Markdown.tsx` — inert-rendering hardening (T14)
- `src/lib/hooks/context.ts`, `src/lib/hooks/index.ts` — **new** hooks (T12)
- `src/app/repos/[repoId]/context/page.tsx` — **new** route (T16)
- `src/app/repos/[repoId]/context/_components/ProjectContextView/` — **new**
  (`ProjectContextView.tsx`, `helpers.ts`, `styles.ts`, `constants.ts`) (T15)
- `src/components/context-attach/ContextAttachPanel/` — **new** shared panel
  (`ContextAttachPanel.tsx`, `helpers.ts`, `styles.ts`, `index.ts`) (T17)
- `src/app/agents/[id]/_components/AgentEditor/constants.ts`,
  `AgentEditor.tsx` — Context tab (T18)
- `src/app/skills/_components/SkillDetail/constants.ts`, `SkillDetail.tsx` —
  Context tab (T19)
- `messages/en/context.json`, `messages/en/agents.json`,
  `messages/en/skills.json` — copy (T20)
- `.../ProjectContextView/ProjectContextView.test.tsx`,
  `src/components/context-attach/ContextAttachPanel/ContextAttachPanel.test.tsx`
  — **new** (T24, T25)

## Placement decisions (already made — do not re-derive)

1. **Token counting is server-side and authoritative.** The spec requires the
   same number regardless of the consuming agent's model, *and* plan 2 uses the
   same number to decide the 20,000-token truncation (AC-24) that AC-17's
   warning predicts. If the UI counted with `client/src/lib/tokens.ts`
   (`chars/4`) and the server truncated with `cl100k_base`, AC-17 and AC-24
   would disagree. The client renders the number the server returns.
   `client/src/lib/tokens.ts` stays untouched — it is a keystroke-rate hint for
   the skill-body editor, a different job.
2. **The counter is the existing `Tokenizer` port** (`src/adapters/tokenizer/`,
   already in `Container` with a test override). Its header comment currently
   says "ONLY under modules/repo-intel"; T7 widens that to "any server-side
   deterministic token count". Adding a second counter would produce two
   different numbers for the same text — the one thing the spec's NFR forbids.
3. **The markdown scan is a module-local ring-3 file, not a new port.**
   `onion-architecture` says not to add an interface with a single
   implementation and a single caller; `modules/repo-intel/pipeline/walk.ts` is
   the existing precedent for fs walking inside a module, tested hermetically
   against a temp dir. `service.ts` imports `scan.ts` the same way it imports
   `repository.ts`; **no `node:fs` import may appear in `service.ts` or
   `routes.ts`**.
4. **`ContextService` takes explicit deps, not `Container`** —
   `onion-architecture`'s rule for new services. The four grandfathered
   `Container`-taking services are not a precedent to copy.
5. **The attach panel lives in `client/src/components/context-attach/`.** It has
   two consumers in different route trees (`/agents/[id]` and `/skills`) with no
   common ancestor folder, so `frontend-ui-architecture`'s ladder puts it at the
   shared rung; `src/components/run-cost/RunCostBadge.tsx` is the existing
   precedent for a domain-aware shared component there. `vendor/ui` is for
   domain-free primitives and is the wrong home.
6. **Attachment ownership uses two nullable FKs, not a polymorphic
   `owner_id`.** `postgresql-table-design` wants real FKs with `ON DELETE
   CASCADE`; a polymorphic column would leave orphan rows when an agent or skill
   is deleted. `CHECK ((agent_id IS NULL) <> (skill_id IS NULL))` keeps exactly
   one owner.

## Tasks

### Step 0 — contracts and schema (everything else depends on these)

- [ ] **T1** Create `server/src/vendor/shared/contracts/context.ts` and add
      `export * from './contracts/context.js';` to
      `server/src/vendor/shared/index.ts`. Grep the whole `contracts/` folder
      for each new name first (barrel-collision rule). Exactly these exports,
      each with its Zod schema and `z.infer` type:
      `ContextDocument { path, folder, size_bytes, token_count, usage_count }`;
      `ContextListing { documents: ContextDocument[], document_count, total_tokens, partial, not_listed, last_synced_at: string|null, synced: boolean }`;
      `ContextDocumentText { path, text }`;
      `ContextOwnerKind = z.enum(['agent','skill'])`;
      `ContextAttachment { owner_kind, owner_id, repo_id, path, order, missing, token_count }`;
      `ContextAttachmentSet { attachments, total_tokens, budget, over_budget }`;
      `ContextAttachmentInput { repo_id: z.string().uuid(), paths: z.array(z.string()) }`;
      `AssembledContextEntry { repo_id, path, via: ContextOwnerKind }`.
      `folder` is `''` for a repo-root document. — `server/src/vendor/shared/contracts/context.ts`, `server/src/vendor/shared/index.ts` — owner: `implementer` — skill: `zod` — → AC-6 → `lists every markdown document with folder, token count and usage count`
- [ ] **T2** Copy T1's file byte-for-byte to
      `client/src/vendor/shared/contracts/context.ts` and add the identical
      barrel line to `client/src/vendor/shared/index.ts`. This is the manual
      re-sync the root CLAUDE.md requires; skipping it silently rots the
      client's types. — `client/src/vendor/shared/contracts/context.ts`, `client/src/vendor/shared/index.ts` — owner: `implementer` — skill: `zod` — → AC-6 → `renders each document's token count`
- [ ] **T3** Add `contextAttachments` to `server/src/db/schema/context.ts` and
      register it in both places in `server/src/db/schema.ts` (the named import
      list and the `schema` object). Columns: `id uuid pk defaultRandom`;
      `workspaceId uuid notNull → workspaces.id cascade`;
      `agentId uuid → agents.id cascade` (nullable);
      `skillId uuid → skills.id cascade` (nullable);
      `repoId uuid notNull → repos.id cascade`; `path text notNull`;
      `order integer notNull` (mirrors `agentSkills.order`); `createdAt now()`.
      Constraints/indexes: `check` that exactly one of `agentId`/`skillId` is
      non-null; partial unique index on `(agentId, repoId, path)
      where agent_id is not null`; partial unique index on
      `(skillId, repoId, path) where skill_id is not null`; index on `(repoId,
      path)` (usage-count lookup); index on `(workspaceId)`. — `server/src/db/schema/context.ts`, `server/src/db/schema.ts` — owner: `implementer` — skill: `postgresql-table-design` — → AC-9 → `an attachment survives a fresh read of the owner`
- [ ] **T4** Generate the migration with `cd server && pnpm db:generate`, then
      apply it with `pnpm db:migrate`. Do **not** hand-edit anything under
      `src/db/migrations/` (do-not-touch). A new table produces a clean
      `CREATE TABLE` diff with no interactive prompt; if drizzle-kit prompts,
      stop and report rather than piping input. — `server/src/db/migrations/*` (generated) — owner: `implementer` — skill: `drizzle-orm-patterns` — → AC-9 → `an attachment survives a fresh read of the owner`

### Server

- [ ] **T5** `server/src/modules/context/constants.ts`:
      `MARKDOWN_EXT = ['.md', '.markdown']`;
      `MAX_DOCUMENT_BYTES = 256 * 1024`; `DISCOVERY_LIMIT = 2000`;
      `PROJECT_CONTEXT_TOKEN_BUDGET = 20_000`; `READ_CONCURRENCY = 16`;
      `TOKEN_CACHE_MAX = 20_000`; and `EXCLUDED_DIRS` (its own copy of
      `node_modules, dist, build, coverage, .next, out, vendor, .git`, with a
      comment naming `modules/repo-intel/constants.ts` as the sibling copy and
      why they are not shared — the two scans have independent lifecycles and
      extensions). — `server/src/modules/context/constants.ts` — owner: `implementer` — skill: `typescript-expert` — → AC-2 → `excludes non-markdown, excluded dirs, oversized files and escaping paths`
- [ ] **T6** `server/src/modules/context/scan.ts` — the **only** file in this
      module that imports `node:fs`. Two exports:
      `listMarkdown(root): Promise<{ files: { path: string; sizeBytes: number; mtimeMs: number }[]; notListed: number }>`
      — recursive walk modelled on `modules/repo-intel/pipeline/walk.ts`:
      skip symlinks (`entry.isSymbolicLink()`), skip `EXCLUDED_DIRS` by name,
      keep only `MARKDOWN_EXT`, drop files over `MAX_DOCUMENT_BYTES`, emit
      POSIX-relative paths (`relative(root, full).split(sep).join('/')`), sort
      ascending, then cap at `DISCOVERY_LIMIT` setting `notListed` to the
      remainder. And
      `readDocument(root, relPath): Promise<string | null>` — returns `null`
      (never throws) when the document is absent, oversized, not strictly valid
      UTF-8 (`new TextDecoder('utf-8', { fatal: true })`), or when
      `resolve(root, relPath)` does not start with `resolve(root) + sep`. The
      containment check is the guard that stops an attachment path from reading
      a file elsewhere on the machine — apply it before any `readFile`, and
      reject absolute inputs and `..` segments outright. — `server/src/modules/context/scan.ts` — owner: `implementer` — skill: `security` — → AC-2 → `excludes non-markdown, excluded dirs, oversized files and escaping paths`
- [ ] **T7** Rewrite the scope paragraph of
      `server/src/adapters/tokenizer/index.ts`'s header comment: the counter is
      no longer "ONLY under modules/repo-intel" but the single server-side
      deterministic token counter, now also used by `modules/context` for
      per-document and per-set counts. No code change. — `server/src/adapters/tokenizer/index.ts` — owner: `implementer` — skill: `typescript-expert` — → AC-6 → `lists every markdown document with folder, token count and usage count`
- [ ] **T8** `server/src/modules/context/repository.ts` — `ContextRepository`,
      the only file touching `context_attachments`. Methods:
      `listForOwner(workspaceId, kind, ownerId): Promise<Row[]>` ordered by
      `order` then `path` (never rely on an unstable tie — see
      server/insights.md 2026-08-04);
      `replaceForOwner(workspaceId, kind, ownerId, repoId, paths)` — delete the
      owner's rows then insert `paths` with `order = index`, **inside one
      `db.transaction`** so a concurrent read never sees a half-empty set;
      `attachmentAgentPairsForRepo(workspaceId, repoId): Promise<{ path: string; agentId: string }[]>`
      (direct agent attachments) and
      `attachmentAgentPairsViaSkillsForRepo(workspaceId, repoId)` (join
      `context_attachments.skill_id → agent_skills.skill_id`, projecting
      `agent_skills.agent_id`); `listForAgentAndItsSkills(workspaceId, agentId)`
      returning the agent's own rows and the rows of every skill it links, each
      tagged with its `via`. No `enabled` filter anywhere — the usage count
      deliberately includes disabled agents and skills. — `server/src/modules/context/repository.ts` — owner: `implementer` — skill: `drizzle-orm-patterns` — → AC-8 → `usage count counts an agent once whether it reaches the document directly, via a skill, or both`
- [ ] **T9** `server/src/modules/context/helpers.ts` — pure, no I/O, no DB:
      `folderOf(path)` (containing folder, `''` at repo root);
      `usageCounts(pairs: { path, agentId }[][]): Map<string, number>` counting
      **distinct** agent ids per path across all input sets (this is what makes
      "directly, through a skill, or both" count once);
      `assembleEntries(skillGroups: { skillId, entries }[], ownEntries)
      : AssembledContextEntry[]` — concatenate every skill group in skill-link
      order, each group in its own stored order, **then** the agent's own
      entries in their stored order, and de-duplicate on `repo_id + path`
      keeping the **first** occurrence (so a document reachable both ways lands
      in the skill-inherited position). — `server/src/modules/context/helpers.ts` — owner: `implementer` — skill: `typescript-expert` — → AC-13 → `places skill-inherited documents before the agent's own, each group in its owner's order`
- [ ] **T10** `server/src/modules/context/service.ts` — `ContextService` with
      **explicit deps**, never `Container`:
      `constructor(private deps: { repo: ContextRepository; agents: AgentsRepository; tokenizer: Tokenizer; cloneDir: string; repos: RepoRepository })`.
      Methods:
      `listDocuments(workspaceId, repoId): Promise<ContextListing>` — resolve
      the repo workspace-scoped (`NotFoundError` otherwise); when
      `repo.clonePath == null` return
      `{ documents: [], document_count: 0, total_tokens: 0, partial: false, not_listed: 0, last_synced_at: null, synced: false }`
      (AC-4 — the client must not show the empty-set message for this); else
      `listMarkdown(repo.clonePath)`, read + count each file with
      `READ_CONCURRENCY`-bounded concurrency, drop any file `readDocument`
      returns `null` for, attach `folder` and `usage_count`, and set
      `last_synced_at` from `repo.lastPolledAt`.
      `getDocumentText(workspaceId, repoId, path): Promise<ContextDocumentText>`
      — `NotFoundError` when `readDocument` returns `null`.
      `getOwnerAttachments(workspaceId, kind, ownerId): Promise<ContextAttachmentSet>`
      — per-row `missing` from `readDocument(...) === null`, per-row
      `token_count`, `total_tokens`, `budget = PROJECT_CONTEXT_TOKEN_BUDGET`,
      `over_budget = total_tokens > budget`.
      `setOwnerAttachments(workspaceId, kind, ownerId, input)` — verify the
      owner and the repo belong to the workspace, then
      `repo.replaceForOwner(...)`, then return `getOwnerAttachments(...)`.
      `assembleForAgent(workspaceId, agentId): Promise<AssembledContextEntry[]>`
      — `repo.listForAgentAndItsSkills` → `helpers.assembleEntries`.
      Token counts are memoised in a private
      `Map<string, number>` keyed `` `${repoId}:${path}:${sizeBytes}:${mtimeMs}` ``
      bounded at `TOKEN_CACHE_MAX` (evict oldest on overflow); the service is
      constructed once per Fastify plugin registration, so the cache lives for
      the app's lifetime. No `fastify`, no `drizzle-orm`, no `node:fs` import in
      this file. — `server/src/modules/context/service.ts` — owner: `implementer` — skill: `onion-architecture` — → AC-17 → `warns when the attached set exceeds the project-context budget`
- [ ] **T11** `server/src/modules/context/routes.ts` — one Fastify plugin,
      zod schemas via `fastify-type-provider-zod`, `getContext` on every
      handler, `new ContextService({...app.container})` once at registration.
      Routes:
      `GET /repos/:id/context/documents` (`params: IdParams`) → `ContextListing`;
      `GET /repos/:id/context/document` (`params: IdParams`,
      `querystring: z.object({ path: z.string().min(1).max(1024) })`) →
      `ContextDocumentText`;
      `GET /agents/:id/context` and `PUT /agents/:id/context`
      (`body: ContextAttachmentInput`) → `ContextAttachmentSet`;
      `GET /skills/:id/context` and `PUT /skills/:id/context` → same.
      Register the module in `server/src/modules/index.ts` (one import + one
      entry, alphabetical position irrelevant). No SQL and no fs in this file. — `server/src/modules/context/routes.ts`, `server/src/modules/index.ts` — owner: `implementer` — skill: `fastify-best-practices` — → AC-1 → `lists every markdown document of the synced working copy with its containing folder`

### Client

- [ ] **T12** `client/src/lib/hooks/context.ts` + export from
      `client/src/lib/hooks/index.ts`:
      `useContextDocuments(repoId)` → key `["context","documents",repoId]`,
      `enabled: !!repoId`;
      `useContextDocument(repoId, path, { enabled })` → key
      `["context","document",repoId,path]`;
      `useOwnerContext(kind, ownerId)` → key `["context",kind,ownerId]`;
      `useSetOwnerContext()` — an **optimistic** mutation modelled line-for-line
      on `useSetAgentSkills` in `hooks/agents.ts`, including
      `await qc.cancelQueries({ queryKey: ["context",kind,ownerId] })` in
      `onMutate` (without it an in-flight GET resurrects the pre-drag order),
      `onError` rollback, and `onSettled` invalidation of both
      `["context",kind,ownerId]` and `["context","documents",repoId]` (usage
      counts move on every attach/detach). — `client/src/lib/hooks/context.ts`, `client/src/lib/hooks/index.ts` — owner: `implementer` — skill: `react-best-practices` — → AC-10 → `updates the combined token count on attach and on detach without starting a run`
- [ ] **T13** Add to `client/src/vendor/ui/nav.ts`: a `WORKSPACE` nav item
      `{ key: "context", label: "Project Context", icon: "Folder", href: "/repos/:repoId/context", gKey: "x" }`
      and the matching `SHORTCUTS` entry `{ keys: "g x", label: "Go to Project
      Context", group: "Navigation" }`. `activeKeyFor` in
      `client/src/components/app-shell/helpers.ts` already maps `/context` →
      `"context"` — do not change it. — `client/src/vendor/ui/nav.ts` — owner: `implementer` — skill: `react-best-practices` — → AC-1 → `lists every markdown document of the synced working copy with its containing folder`
- [ ] **T14** Harden `client/src/vendor/ui/primitives/Markdown.tsx` so a
      rendered document cannot make a network request or execute anything.
      Add two `components` overrides: `img` renders the alt text as a plain
      `<span>` (never an `<img src>`, which would fetch an
      attacker-named address on render), and `a` allows only `http:`, `https:`
      and `mailto:` hrefs — anything else (notably `javascript:`) renders as
      plain text — and always sets `rel="noopener noreferrer"`. react-markdown
      v9 does not render raw HTML without `rehype-raw`, which is not installed
      and must not be added. Additive and backwards-compatible: every existing
      consumer (skill body, import preview) gets the same guarantee. Do **not**
      move this into `.dd-md` CSS — it is per-element JS logic, which is the
      documented exception in client/insights.md 2026-08-04. — `client/src/vendor/ui/primitives/Markdown.tsx` — owner: `implementer` — skill: `security` — → AC-5 → `renders the requested document as inert markdown`
- [ ] **T15** `client/src/app/repos/[repoId]/context/_components/ProjectContextView/`
      — the mockup-01 layout: left rail = the document tree grouped by
      containing folder (folder heading = the `folder` string as **text**,
      documents sorted by path within it) with a filter box; right pane =
      `<Markdown>` preview of the selected document, its header showing the
      file name, an inert `Preview | Edit` toggle (Edit disabled with a
      "not available yet" title) and `Used by N agents` from `usage_count`; no
      COVERAGE ring anywhere. Footer states
      `{document_count} documents · {total_tokens} tokens total · last synced
      {last_synced_at}`, plus "{not_listed} not listed" when `partial`. Branch
      on the listing: `synced === false` → "document listing unavailable — this
      repository has not finished its first sync" and **never** the empty
      message; `synced === true && documents.length === 0` → the
      `context.empty.*` state; filter matching nothing → "no document matches".
      Each document row shows its token count with `--text-secondary`
      (contrast) and a preview control whose `aria-label` names both the action
      and the document. Long/deep paths are truncated with the full path on the
      row's `title`. — `client/src/app/repos/[repoId]/context/_components/ProjectContextView/*` — owner: `implementer` — skill: `react-best-practices` — → AC-7 → `shows the combined token count of the listed documents in the footer`
- [ ] **T16** `client/src/app/repos/[repoId]/context/page.tsx` — thin route:
      read `repoId` from params, render `<AppShell crumb=…><ProjectContextView
      repoId={repoId} /></AppShell>` following the shape of
      `src/app/repos/[repoId]/conventions/page.tsx`. No fetching here. — `client/src/app/repos/[repoId]/context/page.tsx` — owner: `implementer` — skill: `next-best-practices` — → AC-1 → `lists every markdown document of the synced working copy with its containing folder`
- [ ] **T17** `client/src/components/context-attach/ContextAttachPanel/` — one
      component used by both the agent and the skill Context tabs.
      Props: `{ ownerKind: ContextOwnerKind; ownerId: string; hint: string }`;
      it reads the active repo from `useActiveRepo()` and the documents from
      `useContextDocuments(repoId)`, the attachments from
      `useOwnerContext(ownerKind, ownerId)`. Behaviour, per mockups 02/03:
      header `Project context` + `{attached} of {total} attached` badge +
      `Filter documents…` box; one row per discoverable document with a
      checkbox toggle, the file name, the folder as a **text** source badge,
      and a Preview control; footer `≈ {total_tokens} tokens` plus the
      right-hand explanatory line. Rules:
      (a) toggling persists the whole ordered `paths` array through
      `useSetOwnerContext` — the optimistic hook makes the footer total move
      immediately with no run started (AC-10);
      (b) reordering is **disabled entirely while the filter box is non-empty**,
      with the hint swapped, exactly as `SkillsTab.tsx` does — reordering a
      filtered list would silently drop the hidden attachments (AC-14);
      (c) each attached row supports `Alt+ArrowUp` / `Alt+ArrowDown` from the
      focused row to move it one position (plain arrows keep moving focus),
      computed with `moveItem` from `src/lib/drag-list.ts`, and focus is
      restored to that same row afterwards via a `setTimeout(…, 0)` refocus
      through a `Map<path, HTMLElement>` ref — **not** `requestAnimationFrame`
      (AC-15);
      (d) a visually-hidden `<div role="status" aria-live="polite">` is updated
      on every position change with the document's name and its new position
      out of the total (AC-16);
      (e) a row whose attachment has `missing: true` renders a "missing from
      the working copy" marker and is not draggable (AC-18);
      (f) when `over_budget`, a warning banner states the set exceeds the
      20,000-token project-context budget (AC-17);
      (g) every toggle / handle / preview control has an `aria-label` naming
      the action **and** the document, and a ≥ 24×24 px hit target.
      Drag-to-reorder reuses `useDragList` from `src/lib/drag-list.ts`
      unchanged. — `client/src/components/context-attach/ContextAttachPanel/*` — owner: `implementer` — skill: `react-best-practices` — → AC-15 → `moves a focused row one position with the keyboard and keeps focus on it`
- [ ] **T18** Add `{ key: "context", labelKey: "editor.tabs.context", icon:
      "Folder" }` to `TABS` in
      `client/src/app/agents/[id]/_components/AgentEditor/constants.ts` and
      render `<ContextAttachPanel ownerKind="agent" ownerId={agent.id} …/>` for
      that tab in `AgentEditor.tsx` (convert the current ternary into an
      explicit per-key branch). — `client/src/app/agents/[id]/_components/AgentEditor/constants.ts`, `.../AgentEditor.tsx` — owner: `implementer` — skill: `react-best-practices` — → AC-9 → `an attachment survives a fresh read of the owner`
- [ ] **T19** Add `{ key: "context", labelKey: "context.tabLabel", icon:
      "Folder" }` to `TABS` in
      `client/src/app/skills/_components/SkillDetail/constants.ts` (between
      Config and Preview, matching mockup 03) and render
      `<ContextAttachPanel ownerKind="skill" ownerId={skill.id} …/>` in
      `SkillDetail.tsx`. — `client/src/app/skills/_components/SkillDetail/constants.ts`, `.../SkillDetail.tsx` — owner: `implementer` — skill: `react-best-practices` — → AC-9 → `an attachment survives a fresh read of the owner`
- [ ] **T20** Copy. Extend `client/messages/en/context.json` (reuse the
      existing `title`, `empty.*`, `loadError`, `kb`, `mode.preview` keys; leave
      `chunks` unused) with: `unavailable`, `footer`, `notListed`,
      `noMatch`, `usedByAgents`, `tokens`, `filterPlaceholder`,
      `attachAria`, `previewAria`, `reorderAria`, `reorderAnnounced`,
      `missing`, `overBudget`, `orderHint`, `dragDisabledHint`,
      `attachedCount`, `inheritedHint`, `tabLabel`, `editDisabled`. Add
      `editor.tabs.context` to `messages/en/agents.json`. `en` is the only
      locale in this repo. — `client/messages/en/context.json`, `client/messages/en/agents.json` — owner: `implementer` — skill: `next-best-practices` — → AC-3 → `states the repository contains no markdown documents when the synced set is empty`

### Tests

- [ ] **T21** `server/test/context-scan.test.ts` (unit, hermetic, temp dir via
      `node:fs/promises` + `os.tmpdir()`; use `dirname(full)` + `mkdir
      { recursive: true }`, never a manual separator search — see
      server/insights.md 2026-08-07). Cover: a `.md` and a `.markdown` file are
      listed and a `.txt` / `.ts` is not; a file under `node_modules/` and one
      under `.git/` are not; a 257 KB markdown file is not; a file whose bytes
      are not valid UTF-8 is not; `readDocument` returns `null` for
      `../../etc/passwd`, for an absolute path, and for a symlink pointing
      outside the root; paths come back POSIX-separated on win32; the listing is
      ascending by path and `notListed` reports the overflow past
      `DISCOVERY_LIMIT`. — `server/test/context-scan.test.ts` — owner: `test-writer` — skill: `typescript-expert` — → AC-2 → `excludes non-markdown, excluded dirs, oversized files and escaping paths`
- [ ] **T22** `server/test/context-helpers.test.ts` (unit). Cover
      `assembleEntries`: a document reachable through both a skill and the
      agent's own attachment appears exactly once (AC-12); every
      skill-inherited document precedes every own document and each group keeps
      its owner's stored order (AC-13). Also `usageCounts` and `folderOf`. — `server/test/context-helpers.test.ts` — owner: `test-writer` — skill: `typescript-expert` — → AC-12 → `includes a document reachable both ways exactly once`
- [ ] **T23** `server/test/context.it.test.ts` (`*.it.test.ts` suffix,
      testcontainers, `dockerAvailable()` gate, `buildApp` + `app.inject`,
      modelled on `test/blast.it.test.ts`). **Must pass
      `secrets: new MockSecretsProvider()` in `overrides`** — server/insights.md
      2026-08-07: without it an adapter resolved through `SecretsProvider` can
      reach the real network mid-test. Write a temp working copy on disk, insert
      a `repos` row whose `clonePath` points at it, then assert:
      `GET /repos/:id/context/documents` returns every markdown file with its
      `folder`, `token_count` and `usage_count`, in ascending path order (AC-1);
      after attaching a document to an agent and the same document to a skill
      that agent links, the document's `usage_count` is `1`, and it is `2` once
      a second, unrelated agent attaches it, and disabling the agent does not
      change it (AC-8); `PUT /agents/:id/context` then a *fresh*
      `GET /agents/:id/context` returns the stored ordered set (AC-9); a repo,
      agent or skill from another workspace 404s. — `server/test/context.it.test.ts` — owner: `test-writer` — skill: `fastify-best-practices` — → AC-1 → `lists every markdown document of the synced working copy with its containing folder`
- [ ] **T24** `client/src/app/repos/[repoId]/context/_components/ProjectContextView/ProjectContextView.test.tsx`
      (vitest + jsdom, `fetch` mocked, `fireEvent` — `user-event` is not
      installed). Cover: `synced: false` renders the unavailable message and
      **not** the empty message (AC-4); `synced: true, documents: []` renders
      the empty message (AC-3); clicking a document renders its markdown, with
      an `<img>` in the source producing no `img` element and a
      `javascript:` link producing no anchor (AC-5); each row shows its
      `token_count` (AC-6); the footer shows the combined `total_tokens` (AC-7). — `client/src/app/repos/[repoId]/context/_components/ProjectContextView/ProjectContextView.test.tsx` — owner: `test-writer` — skill: `react-testing-library` — → AC-3 → `states the repository contains no markdown documents when the synced set is empty`
- [ ] **T25** `client/src/components/context-attach/ContextAttachPanel/ContextAttachPanel.test.tsx`.
      Cover: toggling a document updates the displayed combined token count
      while the PUT is still pending and fires no run request (AC-10); with a
      non-empty filter the rows are not draggable and the hint has swapped
      (AC-14); `Alt+ArrowDown` on a focused attached row moves it one position
      and `document.activeElement` is still that row (AC-15); the `role="status"`
      node then contains the document's name and its new position (AC-16); a set
      whose `over_budget` is true renders the budget warning (AC-17); an
      attachment with `missing: true` renders the missing marker (AC-18). — `client/src/components/context-attach/ContextAttachPanel/ContextAttachPanel.test.tsx` — owner: `test-writer` — skill: `react-testing-library` — → AC-10 → `updates the combined token count on attach and on detach without starting a run`

## Traceability

| AC | Tasks | Verified by |
|----|-------|-------------|
| AC-1 | T11, T13, T16 | `context.it.test.ts > lists every markdown document of the synced working copy with its containing folder` |
| AC-2 | T5, T6 | `context-scan.test.ts > excludes non-markdown, excluded dirs, oversized files and escaping paths` |
| AC-3 | T15, T20 | `ProjectContextView.test.tsx > states the repository contains no markdown documents when the synced set is empty` |
| AC-4 | T10, T15 | `ProjectContextView.test.tsx > presents the listing as unavailable and not the empty message before the first sync` |
| AC-5 | T14, T15 | `ProjectContextView.test.tsx > renders the requested document as inert markdown` |
| AC-6 | T1, T2, T7, T10 | `ProjectContextView.test.tsx > renders each document's token count` |
| AC-7 | T10, T15 | `ProjectContextView.test.tsx > shows the combined token count of the listed documents in the footer` |
| AC-8 | T8, T9, T10 | `context.it.test.ts > usage count counts an agent once whether it reaches the document directly, via a skill, or both` |
| AC-9 | T3, T4, T8, T10, T18, T19 | `context.it.test.ts > an attachment survives a fresh read of the owner` |
| AC-10 | T12, T17 | `ContextAttachPanel.test.tsx > updates the combined token count on attach and on detach without starting a run` |
| AC-12 | T9 | `context-helpers.test.ts > includes a document reachable both ways exactly once` |
| AC-13 | T9 | `context-helpers.test.ts > places skill-inherited documents before the agent's own, each group in its owner's order` |
| AC-14 | T17 | `ContextAttachPanel.test.tsx > does not permit reordering while the filter is non-empty` |
| AC-15 | T17 | `ContextAttachPanel.test.tsx > moves a focused row one position with the keyboard and keeps focus on it` |
| AC-16 | T17 | `ContextAttachPanel.test.tsx > announces the document and its new position to assistive technology` |
| AC-17 | T10, T17 | `ContextAttachPanel.test.tsx > warns when the attached set exceeds the project-context budget` |
| AC-18 | T10, T17 | `ContextAttachPanel.test.tsx > marks an attachment absent from the working copy as missing` |

AC-11 and AC-19…AC-28 are covered by
[2026-08-16-project-context-run-injection.md](2026-08-16-project-context-run-injection.md).

## Verification

### Fast loop (implementer / test-writer, after every step)

- `cd server && pnpm typecheck`
- `cd server && pnpm test:unit --reporter=dot`
- `cd client && pnpm typecheck`
- `cd client && pnpm test:unit --reporter=dot`

### Full (plan-verifier, once at the end)

- `cd server && pnpm typecheck`
- `cd server && pnpm db:migrate`
- `cd server && pnpm test:unit --reporter=dot`
- `cd server && pnpm test:integration --reporter=dot` (`context.it.test.ts` is a
  `*.it.test.ts` file; needs Docker. Per server/insights.md 2026-08-05, if an
  *unrelated* `.it.test.ts` fails in the full run, re-run that one file alone
  before blaming this change.)
- `cd client && pnpm typecheck`
- `cd client && pnpm test:unit --reporter=dot`
- `cd reviewer-core && npm run typecheck` (it resolves `@devdigest/shared`
  through server's vendor copy, so T1 must not break it)
- End-to-end check: `./scripts/dev.sh`, import or reuse a cloned repo, open
  **Project Context** from the sidebar, confirm the tree groups by folder and
  the footer states documents + tokens total + last sync; preview a document;
  open an agent's **Context** tab, attach two documents, watch the token total
  change without a run starting, reorder one with `Alt+ArrowDown`, reload the
  page and confirm the order and selection survived; attach a document to a
  skill the agent uses and confirm the document's `Used by` count on the
  Project Context page increments.
- Static guard: `grep -rn "node:fs" server/src/modules/context/` must match
  `scan.ts` only.
- **Measure the listing NFR — do not skip, and do not treat a miss as a
  failure.** Generate a throwaway tree of 2,000 markdown files of realistic size
  outside the repository, point a workspace entry at it, and time two listing
  requests: the first after a server restart (cold — every file is read and
  token-counted) and the second immediately after (warm — served from the
  per-`(repo, path, size, mtime)` count cache). Record both numbers in the
  implementation report.

  The spec's 2 s / 2,000-file budget is one of four limits it explicitly records
  as initial values chosen without measurement and expected to be revisited, so
  a cold request over budget is **data for a follow-up spec revision, not a
  reason to redesign this plan**. A warm request over budget is a real defect in
  the cache and must be fixed here. Persisting counts in a `context_documents`
  table stays out of scope either way — it is the follow-up this measurement
  exists to justify or rule out.

## Explicit note

Architecture and security review are out of scope for `implementer` and are
handled by separate review agents/skills after implementation.

## Open questions / assumptions

- **The 2 s / 2,000-file listing NFR is at risk on a cold token cache.** A first
  request after boot must read and BPE-encode every markdown file in the working
  copy; on a 2,000-file repository that plausibly exceeds 2 s. Mitigations in
  this plan: bounded-concurrency reads and a per-(repo, path, size, mtime) count
  cache, so every subsequent request is fast. The spec itself records these four
  limits as "initial values chosen without measurement… expected to be revisited
  once real repositories have been indexed against them", so this is being
  planned as a measurement follow-up rather than a design change. The
  measurement itself is a required step in Verification above — cold and warm
  timings on a 2,000-file tree, both recorded. A cold miss is input to a
  follow-up spec revision; a warm miss is a cache defect and is fixed here.
  Persisting counts in a small `context_documents` cache table is the follow-up
  that measurement exists to justify — deliberately not built now.
- **"Most recent completed sync" is read as `repos.clone_path != null` with the
  timestamp `repos.last_polled_at`** (both written together by
  `RepoRepository.updateClonePath` when a clone job finishes). `repo_index_state`
  is the *code* index, a different thing, and is not consulted.
- **Assumed `.markdown` counts as markdown** alongside `.md`. The mockups show
  only `.md`; the spec says "markdown file" without enumerating extensions.
- **`Alt+ArrowUp` / `Alt+ArrowDown` chosen as the move-up/move-down commands.**
  AC-15 requires "a move-up or move-down command… using the keyboard alone" but
  does not name keys; plain arrows must stay available for moving focus between
  rows.
