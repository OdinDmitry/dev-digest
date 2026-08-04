# 0003 — Conventions Extractor (server)

## Why

Course lesson **L02** is "Skills in the product · Conventions extractor"
([root README.md](../../README.md)). The Skills/Agents half already shipped (see
[spec 0002](0002-skills.md)) — full Skill CRUD/versioning/import, full Agent
CRUD, `agent_skills` linking, and prompt-wiring that resolves an agent's
linked skills into every review. The Conventions Extractor was the other
half of L02, still missing: scan a repo's own code with a cheap LLM call,
propose candidate house conventions with real file:line evidence, let the
user accept/reject/edit them, then merge the accepted set into a Skill via
the machinery spec 0002 already built.

Most of the scaffolding for this was already sitting unused, confirming it
was the intended next step: the `conventions` table (`db/schema/knowledge.ts`),
`RepoIntelService.getConventionSamples()` (`modules/repo-intel/service.ts`),
the `ConventionCandidate` zod contract, the `'extracted'` skill `source`
enum value (spec 0002 explicitly reserved it for "a later lesson"), and the
`conventions` entry in the `FEATURE_MODELS` registry
(`contracts/platform.ts` / `modules/settings/feature-models.ts`) — all
present, all wired to nothing.

## What we decided

### Schema: `conventions` extended, `accepted:boolean` → `status` enum

The pre-existing table had `id, workspaceId, repoId, rule, evidencePath,
evidenceSnippet, confidence, accepted`. Extended with `category`,
`evidenceStartLine`/`evidenceEndLine` (needed for a clickable GitHub
file:line link — the old shape only had a text snippet, no line numbers),
`scannedSha` (the commit the sample was read at, so a link stays valid after
the repo's default branch moves), and `createdAt` (missing entirely before).
`accepted:boolean` became `status: 'pending' | 'accepted' | 'rejected'` — a
genuine three-state toggle (not-yet-reviewed vs. explicit accept vs. explicit
reject), which a boolean can't represent and the UI needs.

Generating this migration hit an environment-specific `drizzle-kit generate`
hang (see `insights.md`, Tool & Library Notes) — worked around by splitting
into two migrations (`0013` drops `accepted` alone, `0014` adds everything
else), never combined in one diff.

### Sample selection is entirely code-driven — no model call

`modules/conventions/samples.ts::buildConventionSamples()` reads root config
files (eslint/tsconfig/prettier, by filename) plus the top-ranked files from
the already-existing `repoIntel.getConventionSamples(repoId, 12)`. Every
sampled file is rendered with a **1-based line-number prefix per line**
(`renderSample()`), truncated by whole lines never mid-line, so a line
number the model cites back is a real line in the real file — this is what
makes the grounding check below possible at all.

### Grounding is a new, separate, code-only check — not reviewer-core's

`modules/conventions/grounding.ts::verifyEvidence()` re-reads the real file
at the repo's clone path and confirms it exists and the cited line range is
inside its real line count. Deliberately **not** a reuse of
`reviewer-core/src/grounding.ts`'s `groundFindings` — that gate checks a
finding's lines against unified-diff hunks and reviewer-core is
filesystem-free by design; a repo-wide file/line existence check needs fs
access, which belongs in `server/`. A candidate that fails is dropped
silently — never persisted, never surfaced as an error to the user.

### Extraction is one synchronous call, not the run-executor/SSE machinery

`ConventionsService.extract()` is a plain `await`ed POST: resolve the model
via the already-wired `resolveFeatureModel(container, workspaceId,
'conventions')`, one `llm.completeStructured()` call over the samples
(`modules/conventions/schema.ts`'s internal `RawConventionExtraction`
schema — deliberately separate from the public `ConventionCandidate`
contract, since a raw LLM candidate has no `id`/`status` yet), then
`verifyEvidence` per candidate. This is a single cheap-model call over ~15
files, not a multi-agent diff review — the async run-executor/SSE
infrastructure reviews use would be pure overhead here.

### Re-scan preserves the user's decisions

`ConventionsRepository.deletePendingForRepo()` deletes only `status:
'pending'` rows before inserting the fresh batch — `accepted`/`rejected`
rows (real decisions, possibly already merged into a skill) survive a
re-scan untouched. The delete only runs *after* a successful LLM call +
grounding pass, so a failed re-scan never wipes out a prior successful one.

### New module `server/src/modules/conventions/`

Mirrors the `skills`/`agents` module shape (`repository.ts` / `service.ts`
/ `routes.ts` / `constants.ts`, plus `samples.ts`/`grounding.ts`/`schema.ts`/
`helpers.ts`), registered in `modules/index.ts`:

```
POST   /repos/:id/conventions/extract        → run/re-run extraction (sync)
GET    /repos/:id/conventions                → list candidates for a repo
PUT    /conventions/:id                       → accept/reject/edit one candidate
DELETE /conventions/:id                       → permanently remove one candidate
POST   /repos/:id/conventions/merge-preview  → draft a skill from given ids (no write)
```

### Merging into a skill reuses skill creation — doesn't duplicate it

`mergePreview()` groups the given (normally `accepted`) conventions by
category and formats a markdown skill body (`helpers.ts::buildMergeBody` —
one section per convention: rule, `Detected in \`file:start-end\`` evidence
line, fenced snippet). It **writes nothing** — same "preview, don't persist"
shape as the existing skill-import flow (spec 0002). The client shows the
draft for editing and creates the skill via the pre-existing `POST /skills`
directly, with `source: 'extracted'` and the preview's `evidence_files` —
no new "create" endpoint.

### Deterministic list ordering

`listByRepo()` originally ordered by `confidence DESC, createdAt DESC`
alone. Live testing surfaced that rows tied on both (the common case for one
extraction batch) come back in a different order across otherwise-identical
queries — accepting one candidate made unrelated ones visibly swap position.
Fixed by appending `id` as a final tiebreaker (see `insights.md`).

### Delete was added after live testing, not in the original plan

The original design only distinguished `pending`/`accepted`/`rejected` by
status, with no way to remove a row. Live testing showed this compounds:
`rejected` rows persist forever, and a re-scan's fresh `pending` batch
doesn't dedupe against previously-`accepted` rows covering the same rule —
the list only grows, with no escape hatch. `DELETE /conventions/:id`
(any status, workspace-scoped) is the fix — pure manual user control, no
attempt at automatic dedup.

## Out of scope

- **API Contract Reviewer** (the L02 exercise's other half) — needs zero new
  code. It's an agent + 4 skills authored through the already-shipped
  Skills/Agents UI (spec 0002), not a Conventions Extractor concern.
- A bulk "clear all" / "delete all pending" endpoint — per-row `DELETE` is
  the only escape hatch; a repo with dozens of stale candidates needs
  several calls, accepted as a reasonable cost against the complexity of a
  second bulk-delete surface.
- Automatically splitting accepted conventions into multiple skills by
  category — `mergePreview` already groups by category in the body, so this
  is a small future extension, not built now.
- Per-skill "% of extracted candidates accepted" metrics — nothing records
  which extraction run a skill's constituent conventions came from once
  merged (same "out of scope" reasoning as spec 0002's skill-eval metrics).

## Once shipped

Implemented and tested — `server/test/conventions.test.ts` (hermetic:
`verifyEvidence`, `renderSample`, `buildMergeBody`) and
`server/test/conventions.it.test.ts` (real Postgres: grounding drops
fabricated evidence, re-scan preserves accepted rows, merge-preview, delete).
Verified live end-to-end against this repo's own real clone through a real
OpenRouter free-tier model: extraction produced grounded candidates citing
real file:line pairs in `client/src/app/...`, accept → merge-preview →
`POST /skills` (`source: 'extracted'`) all round-tripped correctly. Fold the
still-true parts into `server/CLAUDE.md` (`Where things live` — add
`conventions` next to `skills`/`agents`) and delete this file.
