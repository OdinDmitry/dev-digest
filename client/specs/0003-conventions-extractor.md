# 0003 — Conventions Extractor (client)

## Why

Paired with [server spec 0003](../../server/specs/0003-conventions-extractor.md)
for the API this UI drives. A repo-scoped page where a user runs extraction,
reviews candidate house conventions with real clickable evidence, and merges
the accepted ones into a Skill — closing lesson **L02**'s second half (the
Skills/Agents authoring UI from [spec 0002](0002-skills.md) was already
shipped).

The scaffolding already anticipated this exact feature: `vendor/ui/nav.ts`'s
`SKILLS LAB` section carried the comment "Later lessons add Conventions...
to this group", `activeKeyFor()` (`components/app-shell/helpers.ts`)
already had a case for `/conventions`, and the `ConventionCandidate` zod
contract already existed — all present, all unused until now.

## What we decided

### Repo-scoped route, same shape as the PR list

New `/repos/:repoId/conventions` (`app/repos/[repoId]/conventions/`),
following the existing `/repos/:repoId/pulls` route's pattern:
`useActiveRepo()`/`useRepoNotFound()` from `lib/repo-context.tsx` resolve the
repo from the URL path, no new context needed.

### Sidebar: the SKILLS LAB entry the scaffolding was waiting for

Added to `vendor/ui/nav.ts`'s `SKILLS LAB` group (icon `ListChecks`, already
in the icon registry) plus a `g c` shortcut row — no other nav plumbing
needed since `activeKeyFor()` already handled the route.

### Hooks: one file, same per-resource shape as every other domain

`lib/hooks/conventions.ts` — `useConventions(repoId)`,
`useExtractConventions()`, `useUpdateConvention()`,
`useMergeConventionsPreview()`, `useDeleteConvention()`. Accept/Reject/Delete
are all optimistic, mirroring `useSetAgentSkills`'s
onMutate/onError-rollback/onSettled-invalidate shape (the only other
optimistic hook in the app) — status/removal needs to feel instant, not wait
on a round-trip.

### ConventionCard reuses FindingCard's evidence-link shape

Same `MonoLink` + `githubBlobUrl(repoFullName, sha, file, start, end)`
pattern `FindingCard` already uses for PR findings — except `sha` here is
the convention's own `scanned_sha` (the commit the sample was actually read
at), not a PR's head sha, since a repo-wide conventions scan has no PR to
anchor to.

### Confidence renders as a labeled progress bar, not a compact chip

Initially built with the existing `ConfidenceNum` chip (small dot + "NN%
conf" text, already used on `FindingCard`) — the reference mockups actually
show a full-width "Confidence [bar] NN%" readout. Swapped to
`PercentProgress` (`@devdigest/ui`, already existed, previously only used
for indexing progress), colored by the same ok/warn/muted thresholds
`ConfidenceNum` used.

### Accept/Reject status IS the selection — no separate multi-select

"Create skill" merges whatever is currently `status: 'accepted'` for the
repo. No separate checkbox/selection UI layered on top — matches the
reference screenshots, where the accept toggle visibly doubles as inclusion
in the next skill. "Deselect all" bulk-resets every `accepted` row back to
`pending` (loops `useUpdateConvention` — no bulk endpoint, the repo's
conventions list is small enough that this is cheap).

### CreateSkillFromConventionsModal reuses skill creation, not a new endpoint

Same "preview then confirm" shape as skill import (spec 0002): opens with
`useMergeConventionsPreview()` prefilling Name/Description/Type/Body (all
editable), submits via the existing `useCreateSkill()` with
`source: 'extracted'`. Body editing reuses the skills feature's own
`SkillBodyEditor` (line-numbered gutter, token count) rather than a plain
textarea — cross-feature import from `app/skills/_components/...`, accepted
deliberately since duplicating that component's pixel-metric-sensitive CSS
(its own file header warns a copy would drift) is worse than the import.
After creation, redirects to `/skills?id=<id>` (the existing skill detail
page) rather than just closing back onto the conventions list — the user
asked for this explicitly after the first pass just closed the modal.

## Incidental fixes surfaced by building and live-testing this feature

None of these are Conventions-specific — they're gaps in shared UI the new
modal/page exercised for the first time in a way existing screens hadn't:

- **`Modal` (`vendor/ui/kit/Modal.tsx`) gives its children zero padding** —
  unlike `Drawer`, which bakes padding in. `CreateSkillFromConventionsModal`
  shipped without a wrapper and rendered edge-to-edge; while fixing it, found
  the **pre-existing** `CreateSkillModal` (skills feature, not new to this
  task) had the exact same bug and had simply never been reported. Both now
  wrap their fields in a `padding: 24` div, matching `CreateAgentModal`'s
  already-correct pattern.
- **`Markdown.tsx`'s `code` renderer didn't distinguish inline from fenced
  code** — applied the same small-chip inline styling to both, and since an
  inline `style` attribute always beats a CSS class, the `.dd-md pre code`
  rule meant to cancel that out for blocks never could. Surfaced as visibly
  broken/mismatched rounded corners on a skill body's code blocks (a shape
  `buildMergeBody`'s output produces directly). Fixed by overriding `pre`
  separately and re-rendering a plain `<pre><code>` for blocks.
- **`::-webkit-scrollbar-corner` was never styled** — thumb/track were, corner
  wasn't, leaving a stray white square wherever an element scrolls both ways
  (first noticed on `SkillBodyEditor`'s textarea). Fixed once, globally, in
  `vendor/ui/styles.css`.
- **`VersionsTab` never offered Diff on the current version** — a deliberate
  original design (`isNewest ? <CurrentBadge> : <Diff+Restore>`) turned out
  to be a real gap: "what did I just change" against the current version is
  the single most common reason to open the tab. Now every row gets Diff
  when it has an older neighbour (current version included); Restore stays
  hidden only on the current row (restoring onto itself is a no-op).
- **The "outside your workspace, vet before enabling" banner fired for
  `source: 'extracted'` skills** — `untrusted = skill.source !== "manual"`
  (in `ConfigTab`, `PreviewTab`, `SkillListItem`) treated a skill mined from
  the user's own repo, already reviewed one-by-one through this exact
  Accept/Reject flow, the same as a raw upload nobody has read. New
  `lib/skill-source.ts::isUnvettedSkillSource()` narrows the banner to the
  two sources that are genuinely foreign, `imported_url` and `community`.

## Out of scope

- **API Contract Reviewer** — pure content (a system prompt + 4 skill
  bodies) authored through the already-shipped Skills/Agents UI, no client
  code.
- A dedicated multi-select UI for merging — Accept/Reject status already is
  the selection (see above).
- Grouping accepted conventions into multiple skills automatically — the
  merge-preview body already groups by category as markdown sections; a UI
  to split that into several skills is a small future extension.

## Once shipped

Implemented and tested — `ConventionsView.test.tsx` (empty state, listing,
optimistic accept, merge-modal open → create → redirect),
`skill-source.test.ts`, `Markdown.test.tsx` (inline vs. fenced code
rendering), and the updated `VersionsTab.test.tsx`. Verified live against
this repo's own real clone: nav entry renders, extraction round-trips
through the real API, and the `::-webkit-scrollbar-corner` / `Modal`
padding fixes were confirmed against the running dev server. Fold the still-
true parts into `client/CLAUDE.md` (`Where things live`) and delete this
file.
