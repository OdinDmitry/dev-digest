# Development Plan: Export to CI — Phase C (client surfaces)

Spec: docs/specs/cross/SPEC-05-export-to-ci.md
Date: 2026-08-28
Execution mode: single-agent (one ordered `/impl` pass)

Phase 3 of 3. Siblings:
`docs/plans/2026-08-28-export-to-ci-a-contracts-generation-install.md` (Phase A),
`docs/plans/2026-08-28-export-to-ci-b-runner-and-ingest.md` (Phase B).
**Both must be green before this file starts** — every endpoint and every
contract this phase renders is frozen there.

Run this plan with **`/impl-sec`** for consistency with A and B. Its own
security surface is small (it adds no endpoint), but it renders text retrieved
from a third-party repository, which is the reason `security` A05's stored-XSS
rules apply to the run list.

Design refs:
`docs/specs/cross/_design/SPEC-05-export-to-ci/2.png` (the agent's CI view and
the add-to-CI control), `1.png` (wizard · target — **the four platform cards
only**; the required target-repository chooser is the revision the user supplied
after `1.png` was drawn and is described in the spec's Design refs note),
`3.png` (wizard · preview), `4.png` (wizard · configure), `5.png` (wizard ·
install).

Two deliberate deviations from the mockups, both settled in the spec: `3.png`'s
`.devdigest/memory.jsonl` and its `devdigest/review-action@v1` step are **not**
generated (Phase A already fixes what the file list contains), and `2.png`'s
"Update CI config" control is **not** built — re-export goes through the same
wizard.

## Goal

Give the feature its three surfaces: a CI view on the agent editor that lists
the repositories the agent is installed in, says for each whether the installed
workflow is the version the export would generate now, and shows that agent's
recent CI runs; a four-step export wizard that chooses a target and a
repository, previews every generated file with the workflow open to editing,
configures triggers and publication mode while reporting which secrets the
workflow expects, and ends by presenting the pull request it opened; and a CI
Runs page, reachable from the navigation, listing every recorded run with its
repository, pull request, agent, verdict, findings, cost, duration and a link to
the job.

## Out of scope

- Any server change. Every route, contract and computed field this phase renders
  exists after Phase B; if something is missing, that is a defect in A or B, not
  a task here.
- The three non-GitHub-Actions target cards. They render, they say they are not
  available, and they are not selectable.
- "Copy files as a zip". It renders on the install step, says files are added
  manually, and does nothing.
- An "Update CI config" control (`2.png`).
- Any CI surface on a pull-request page. `client/src/app/repos/[repoId]/pulls/**`
  is not edited.
- Auto-refresh or polling of CI runs. `ci.json`'s existing `runs.autoRefresh`
  key stays unused; results arrive only when the user presses Refresh.
- Filters and non-recency ordering on CI Runs. `ci.json`'s existing
  `runs.filters.*` keys stay unused — the spec defines "most recent first" and
  no filtering.
- Any change to `@devdigest/ui`'s `SearchableSelect`, `Modal` or
  `ExportWizardSteps`. See Placement decisions for why the wizard builds its own
  chooser instead.
- Adding `@testing-library/user-event`. It is not installed
  (`client/insights.md`, Tool & Library Notes 2026-08-08) — use `fireEvent`,
  matching the rest of the suite.

## Constraints

Every claim below was read in this session at the line given.

1. **The agent editor's tab whitelist is already derived, not duplicated.**
   `client/src/app/agents/[id]/page.tsx:20` — `const VALID_TABS = TABS.map(tb =>
   tb.key)` — with a comment at `:16-19` recording that a hand-kept second list
   is how the Context tab once shipped unreachable. Adding `ci` to
   `AgentEditor/constants.ts:11-16` therefore makes `?tab=ci` work with **no
   second edit**, and the e2e flow in T16 is what keeps that true.
2. **`AgentEditor.tsx:26-34` is an if/else chain over `tab`,** with `ConfigTab`
   as the fallback. A new tab needs one branch there as well as the `TABS`
   entry.
3. **The nav has no CI Runs entry.** `client/src/vendor/ui/nav.ts:21-47` — `NAV`
   contains `pulls`, `context`, `skills`, `agents`, `conventions`, `eval` and
   nothing else. `client/src/components/app-shell/helpers.ts:38` already maps
   `/ci-runs` to the key `"ci-runs"`, so the *resolver* exists and the
   *registry entry* does not — the reverse of the usual bug, and the reason
   AC-16's "selects CI runs in the navigation" is not satisfiable today.
4. **`NAV` is the single source for the sidebar, the command palette and the
   `g`-shortcuts.** `client/src/vendor/ui/shell/Sidebar.tsx:3,45`,
   `client/src/components/app-shell/hooks/useShellCommands.ts:21`,
   `useGlobalShortcuts.ts:45`, and `nav.ts:73-75` derives `SHORTCUTS` from
   `NAV`. One entry gets all four. The `gKey` letters already taken are
   `p, x, s, a, c, e` (`nav.ts:25,26,35,36,42,44`) and `,`
   (`SETTINGS_ITEM`, `nav.ts:54`).
5. **`Workflow` is a registered icon** — `client/src/vendor/ui/icons.tsx:79,162`.
   `IconName` is a closed union, so an unregistered name will not compile.
6. **A value import from `@devdigest/shared` breaks `next build`.**
   `client/insights.md`, Tool & Library Notes 2026-08-22: `pnpm typecheck` and
   `pnpm test:unit` both stay green while `pnpm build` fails with "Module not
   found: Can't resolve './contracts/….js'". **Every shared-contract import in
   this phase is `import type`.** Nothing client-side calls `.parse()` on a
   vendored schema; the workflow's validity is answered by the server route
   Phase A added.
7. **`SearchableSelect`'s trigger cannot be opened from the keyboard.**
   `client/src/vendor/ui/kit/SearchableSelect.tsx:82-83` — the trigger is a
   `<div onClick={…}>` with no `tabIndex`, no `role` and no `onKeyDown`; the
   filter box's `↑/↓/Enter/Esc` handling at `:63-78` is only reachable once the
   list is already open. It also has no result-count announcement. Its two
   existing consumers are `ConfigTab.tsx:120` and `SettingsModels.tsx:58`.
8. **`ExportWizardSteps` conveys the step by colour, number and label — never
   as "step N of M".** `client/src/vendor/ui/ExportWizardSteps.tsx:6-55`. The
   NFR asks for text, so the wizard renders its own line alongside it.
9. **`Modal` has `role="dialog"`/`aria-modal` but no focus management.**
   `client/src/vendor/ui/kit/Modal.tsx:26-27`; its close button lives in the
   header at `:58`.
10. **`useFocusTrap` exists and must wrap the whole `<Modal>` from outside.**
    `client/src/lib/use-focus-trap.ts:24`; `client/insights.md`, Codebase
    Patterns 2026-08-22 — `Modal.tsx` accepts no ref, so the trap ref goes on a
    plain wrapper div around `<Modal>`, or the header's close button falls
    outside the trap. `CompareRunsDialog.tsx:98` and `EvalCaseDialog.tsx:66` are
    the two precedents.
11. **`client/messages/en/ci.json` already exists**, with `runs`,
    `exportWizard`, `ciTab`, `publishDialog` and `page` blocks — pre-built
    scaffolding for this lesson, the same pattern `client/insights.md`, Codebase
    Patterns 2026-08-05 records for `smartDiff.*`. Reuse the keys that fit, add
    what is missing, and leave `publishDialog` (a different, unbuilt design)
    untouched.
12. **Message namespaces need no registry.** `client/src/i18n/request.ts:17-24`
    reads every file in `messages/<locale>/` and keys the namespace by filename.
    Adding keys to `ci.json` is the whole change.
13. **The CI failure-threshold control already exists on the Config tab.**
    `ConfigTab.tsx:31` holds `ciFailOn` in state, `:134-140` renders the
    `SelectInput`, `:82` sends it. AC-10's statement belongs beside that
    control; there is no second threshold control to build.
14. **Data fetching goes through a hook in `src/lib/hooks/*`, never a raw
    `fetch` in a component** — `client/CLAUDE.md`, Non-default conventions.
    `client/src/lib/hooks/index.ts:4-16` is the barrel.
15. **Component tests mock `fetch` and need no browser**; real browser journeys
    live in `e2e/` — `client/CLAUDE.md`, Gotchas.
16. **e2e locators are deterministic only** (`--url`, `--text`,
    `find role|text|label`), never the AI `chat` command, and **no click scrolls
    its target into view** — `e2e/CLAUDE.md`, Non-default conventions. Flows
    target read-only seeded data so nothing triggers a model call.
17. **A URL assertion alone does not prove a tab renders.**
    `e2e/specs/14-agent-evals-tab.flow.json:3` records the reasoning: a build
    where the tab button and the `?tab=` whitelist disagree still changes the
    URL while silently falling back to Config. Every tab flow asserts on copy
    that only the new surface renders.
18. **jsdom runs no layout**, so a focusability check must not filter on
    `offsetParent` — `client/insights.md`, Tool & Library Notes 2026-08-22.
    `use-focus-trap.ts` already handles this; do not reintroduce the filter in
    any new helper.
19. **A mocked `next/navigation` router that mutates a module-level variable
    does not re-render** — `client/insights.md`, Codebase Patterns 2026-08-04;
    force a fresh render after an action that depends on `replace()`.
20. **Handoff-sized task bullets** — `/impl` copies task lines verbatim into
    spawn prompts. Prefer `file:line` references over pasted code.

## Placement decisions

Each traces to a preloaded skill's rule, not to preference.

- **`CiTab` is colocated under the editor that owns it** —
  `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/`,
  matching `ConfigTab`, `SkillsTab` and `EvalsTab`. `frontend-ui-architecture`'s
  placement ladder, rung 2: one consumer, so it stays next to it.
- **`ExportWizard` is a private child of `CiTab`**
  (`CiTab/_components/ExportWizard/`), not a top-level component. Same rung: the
  CI tab is its only entry point, and the spec makes it so (AC-1 opens it from
  the CI view and nowhere else).
- **`RepoChooser` is built inside the wizard rather than reusing
  `SearchableSelect`.** Two NFRs demand behaviour the primitive does not have —
  full keyboard operability including *reaching* the control (constraint 7) and
  a debounced announcement of how many repositories a search narrowed to.
  Changing the vendored primitive would change the agent model picker
  (`ConfigTab.tsx:120`) and the feature-model settings
  (`SettingsModels.tsx:58`) as a side effect of a CI feature.
  `frontend-ui-architecture`: "Duplication is far cheaper than the wrong
  abstraction", and promotion to the shared layer waits for a second real
  consumer.
- **The wizard's step state, edited workflow contents and chosen options live
  in one reducer at the `ExportWizard` module scope**, not in per-step
  components. `frontend-ui-architecture`, "Where business logic goes": reducers
  are declared outside the component body, and the state must outlive the step
  the user is on — the spec requires edits to survive moving between steps and
  to be discarded when the wizard closes.
- **Server state is never mirrored into wizard state.** The generated files, the
  expected secrets and the workflow version come from the preview query and are
  read from the query cache; only the *user's edit* of the workflow lives in the
  reducer. `frontend-ui-architecture`: "Server state and client state are
  different things and must not be mixed."
- **One hook file, `client/src/lib/hooks/ci.ts`**, holding every CI query and
  mutation, exported through the barrel — `client/CLAUDE.md` ("one TanStack
  Query hook file per resource, the only place that talks to the API") and
  `frontend-ui-architecture`'s `<feature>/api/` rule.
- **`CiRunsView` is colocated under its route**
  (`client/src/app/ci-runs/_components/CiRunsView/`), with `page.tsx` thin —
  `client/CLAUDE.md`, Non-default conventions.
- **Trigger options are chip-styled `<label>`s wrapping real
  `<input type="checkbox">`.** The NFR requires selection to be conveyed as
  text rather than by colour or outline alone and each option to be
  individually selectable (AC-20); a native checkbox conveys its state to
  assistive technology without a hand-rolled `role`/`aria-checked` pair, and
  `client/insights.md`, Codebase Patterns 2026-08-17 records how easily a
  hand-rolled composite `role="checkbox"` hides its own children from AT.
- **Unavailable target cards are `<button disabled>` carrying a text badge.**
  The NFR requires the unavailability to be text, not dimming, and requires the
  card not to be selectable by keyboard or pointer; `disabled` removes it from
  the tab order and from click handling in one attribute.
- **Every verdict, status, secret-readiness and version-currency indicator
  renders a word, with colour and icon as decoration only.** The NFR says so
  four times; `client/insights.md`, What Doesn't Work 2026-07-30 is the in-repo
  precedent for an indicator that lost its meaning when only the colour carried
  it.
- **Retrieved text is rendered as inert content.** Repository names, pull
  request numbers and job URLs come from a third party. Plain React text nodes
  (auto-escaped), and the job link gets `rel="noopener noreferrer"` and is
  rendered only when the URL starts with `https://` — `security` A05's
  "validate URLs before `href` — reject `javascript:`".

## Entry points & duplicate registries

- **`AgentEditor/constants.ts:11-16` (`TABS`)** — the tab registry. `page.tsx:20`
  derives `VALID_TABS` from it, so this is the **only** list. Covered by **T2**;
  T16's e2e flow asserts on rendered copy, not just the URL, because a
  regression that re-introduced a hand-kept whitelist would still change the URL
  (constraint 17).
- **`AgentEditor.tsx:26-34`** — the render switch, a second place that
  enumerates tab keys. *Not collapsible without a component map*, which would be
  a refactor of a file this plan otherwise does not touch. Covered by **T3**,
  listed alongside T2's file so neither is edited alone.
- **`client/src/vendor/ui/nav.ts:21-47` (`NAV`)** — the nav registry. Checked:
  `Sidebar`, `useShellCommands` and `useGlobalShortcuts` all derive from it
  (constraint 4) and `nav.ts:73-75` derives `SHORTCUTS` from it too, so **one
  entry is the whole change**. Covered by **T13**.
- **`client/src/components/app-shell/helpers.ts:38`** — checked: already returns
  `"ci-runs"` for `/ci-runs`. **No edit needed**; the key T13 adds must be
  exactly `"ci-runs"` or the sidebar will not highlight.
- **`client/src/lib/hooks/index.ts:4-16`** — the hooks barrel. `./ci` must be
  added. Covered by **T5**.
- **`client/messages/en/ci.json`** — checked against
  `client/src/i18n/request.ts:17-24`: namespaces are discovered by filename, so
  there is **no message registry to update**. The file already exists
  (constraint 11).
- **`client/src/vendor/shared/contracts/eval-ci.ts`** — checked: kept in sync by
  Phase A T19 and Phase B T18. This phase imports **types only** from it and
  edits neither copy.
- `grep -rn "ci-runs\|ciRuns\|CI Runs" client/src` — **checked**: the only hits
  today are `helpers.ts:38` and a section comment in the contracts copy. No
  page, no route, no nav item, no hook exists to collide with.
- `grep -rn "exportWizard\|ciTab" client/src` — **checked, nothing**: the
  `ci.json` blocks have no consumer yet, so no existing component's copy changes
  when they are extended.

## Affected modules & files

- **client hooks**: `client/src/lib/hooks/ci.ts` (new),
  `client/src/lib/hooks/index.ts`
- **client nav**: `client/src/vendor/ui/nav.ts`
- **client agent editor**:
  `client/src/app/agents/[id]/_components/AgentEditor/constants.ts`,
  `AgentEditor.tsx`,
  `_components/CiTab/{CiTab.tsx,index.ts,styles.ts,helpers.ts}`,
  `_components/CiTab/_components/ExportWizard/{ExportWizard.tsx,index.ts,styles.ts,reducer.ts,constants.ts}`,
  `_components/CiTab/_components/ExportWizard/_components/RepoChooser/{RepoChooser.tsx,index.ts}`,
  `_components/ConfigTab/ConfigTab.tsx`
- **client CI Runs**: `client/src/app/ci-runs/page.tsx`,
  `client/src/app/ci-runs/_components/CiRunsView/{CiRunsView.tsx,index.ts,styles.ts,helpers.ts}`
- **client i18n**: `client/messages/en/ci.json`
- **client tests (new)**: `CiTab.test.tsx`, `ExportWizard.test.tsx`,
  `RepoChooser.test.tsx`, `CiRunsView.test.tsx`, `ConfigTab.test.tsx`
- **e2e (new)**: `e2e/specs/15-agent-ci-tab.flow.json`,
  `e2e/specs/16-ci-runs.flow.json`

## Frozen surface

### Hooks — `client/src/lib/hooks/ci.ts`

```ts
useCiInstallations(agentId: string)            // GET  /agents/:id/ci-installations
useAgentCiRuns(agentId: string)                // GET  /agents/:id/ci-runs
useCiRuns()                                    // GET  /ci/runs
useRefreshCiRuns()                             // POST /ci/refresh
useCiExportPreview()                           // POST /agents/:id/ci-export/preview
useValidateWorkflow()                          // POST /ci/workflow/validate
useInstallCi()                                 // POST /agents/:id/ci-export/install
```

`useRefreshCiRuns` and `useInstallCi` invalidate `["ci","runs"]` and
`["ci","installations",agentId]` on success. Both set
`meta: { suppressErrorToast: true }` and are `catch`ed at the call site so the
wizard and the page own their inline error UX — `client/insights.md`, What
Works 2026-08-22 records that an uncaught `mutateAsync` rejection surfaces as
Next's runtime-error overlay.

### Wizard state — `ExportWizard/reducer.ts` (module scope, no React import)

```ts
export interface WizardState {
  step: 0 | 1 | 2 | 3;              // target | preview | configure | install
  target: 'gha';                    // the only selectable member
  repoId: string | null;            // AC-19: step 0 cannot be left while null
  workflowEdit: string | null;      // null = "use the generated contents"
  triggers: CiTriggerEvent[];       // opens as ['opened','synchronize'] (edge case)
  postAs: CiPostAs;                 // opens as 'github_review'
  workflowError: string | null;     // AC-3
  installError: string | null;
  prUrl: string | null;             // AC-7
}
export function canLeaveStep(s: WizardState): boolean;
export function wizardReducer(s: WizardState, a: WizardAction): WizardState;
```

`canLeaveStep` is the single gate: step 0 requires `repoId !== null`
(**AC-19**), step 1 requires `workflowError === null` (**AC-3**), step 2
requires `triggers.length > 0` (edge case: "with none selected the configure
step cannot be advanced and states that a trigger is required"). Every step's
Continue button is `disabled` when it returns false **and** the reason is
rendered as text next to the control that caused it.

Edits survive `step` changes because the reducer outlives the step components;
closing the wizard unmounts it and discards them — that is the spec's
"closing the wizard discards them", with no extra code.

### Wizard step behaviour

- **Step 0 · Target.** Four cards; only `gha` is a live `<button>` and it is
  preselected. The other three are `<button disabled>` with a text badge saying
  they are not available in this version. Below them, the `RepoChooser`, labelled
  as required. Continue is disabled until a repository is chosen (**AC-19**).
  When the workspace has no repository at all, the CI view's add-to-CI control
  is disabled before the wizard ever opens and says a repository must be
  imported first (edge case).
- **Step 1 · Preview.** `useCiExportPreview` runs **on entering this step**, not
  on open. A file list on the left, the selected file's contents on the right;
  the workflow is the only editable one and is marked `editable` (**AC-2**).
  Editing it dispatches into `workflowEdit`; on Continue, `useValidateWorkflow`
  runs and an invalid result sets `workflowError`, which renders **next to the
  workflow contents** and blocks the step (**AC-3**). An agent with no skills
  shows a line saying no skills are attached, not an empty section. A preview
  that fails because the runner bundle is unavailable renders the server's
  message in the wizard's alert region (**AC-5**, client half).
- **Step 2 · Configure.** Three trigger checkboxes, individually selectable
  (**AC-20**), opening with `opened` and `synchronize` selected and `reopened`
  not. The expected-secrets table renders one row per
  `preview.expected_secrets` entry with the word "provided by Actions" or "you
  must add this" — never a colour alone, and never a value (**AC-4**). Three
  radio buttons for the publication mode. A static note explaining that blocking
  a merge additionally needs a required status check in the repository's own
  settings.
- **Step 3 · Install.** The "Open a PR with these files" card, selected and
  live; the "Copy files as a zip" card, visible and inert. Install calls
  `useInstallCi` with `repo_id`, `triggers`, `post_as`, and `workflow_contents:
  state.workflowEdit` (**AC-22**). On success the step presents the returned
  pull-request location as a link (**AC-7**); on failure the message renders in
  the alert region without moving focus (NFR).

### Accessibility mechanics

- `useFocusTrap(wrapperRef, true, onClose)` on a plain `<div>` wrapping the
  whole `<Modal>` (**AC-17**, constraint 10).
- Each step's content sits in a container with `tabIndex={-1}` and a
  `useEffect` keyed on `state.step` that calls `.focus()` on it (**AC-18**).
- A line reading "Step {n} of {total} — {label}" beside `ExportWizardSteps`
  (NFR, constraint 8).
- One `role="alert"` region per wizard for failures, written to without any
  `.focus()` call (NFR).
- `RepoChooser`: a labelled `<input type="text">` filter that is itself the tab
  stop, a `role="listbox"` of `role="option"` buttons, `↑/↓/Enter/Esc`, and a
  separate `aria-live="polite"` element holding "{n} repositories match",
  written **once per completed search** via a ~300 ms debounce (NFR).
- Every interactive target is at least 24×24 CSS pixels, and text and
  non-decorative indicators meet 4.5:1 against their background (NFRs; these are
  design constraints on the styles files, not separately automated).

### CI Runs page

`/ci-runs` renders one row per `CiRun`, most recent first, with repository,
pull request number, agent name, verdict **as a word**, finding count, cost,
duration, status **as a word**, and a job link. `in_progress` renders no verdict
and no counts; `unavailable` renders its reason and never a zero finding count
(**AC-16**). A Refresh button calls `useRefreshCiRuns` and, when the response
carries rejections, renders one line per rejection naming the job — never
silently (edge case). Two empty states: no installation anywhere → the copy
names the way to install one; installations but no runs → "no CI runs yet".

## Tasks

- [ ] T1 Extend `client/messages/en/ci.json`: add the keys this phase needs under the existing `runs`, `exportWizard` and `ciTab` blocks — trigger labels, secret-readiness words, publication-mode labels, verdict words, run-status words, workflow-version currency words, the "step {n} of {total}" line, the required-repository and required-trigger messages, the no-skills line, the fork-skipped explanation, the rejected-result line, the no-installation empty state, and the CI-threshold re-export notice. Leave the `publishDialog` block untouched — `client/messages/en/ci.json` — owner: `implementer` — skill: `next-best-practices` — → AC-16 → `ci_runs_view_unit`
- [ ] T2 Add `{ key: "ci", labelKey: "editor.tabs.ci", icon: "Workflow" }` to `TABS` and the matching label to `messages/en/agents.json`; `page.tsx:20` derives the `?tab=` whitelist from this list, so **no second list is edited** — `client/src/app/agents/[id]/_components/AgentEditor/constants.ts`, `client/messages/en/agents.json` — owner: `implementer` — skill: `react-best-practices` — → AC-1 → `ci_tab_unit`
- [ ] T3 Add the `tab === "ci"` branch to the render chain at `AgentEditor.tsx:26-34`, rendering `<CiTab agent={agent} />`; the `ciTab` copy resolves in the `ci` namespace, so add a second `useTranslations("ci")` rather than routing it through the `agents` one (the precedent for a cross-namespace tab is `client/insights.md`, Codebase Patterns 2026-08-16) — `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx` — owner: `implementer` — skill: `react-best-practices` — → AC-1 → `ci_tab_unit`
- [ ] T4 `client/src/lib/hooks/ci.ts` — the seven hooks in the Frozen surface, all `import type` from `@devdigest/shared` (constraint 6), mutations carrying `meta: { suppressErrorToast: true }` and the invalidations listed there — `client/src/lib/hooks/ci.ts` — owner: `implementer` — skill: `next-best-practices` — → AC-16 → `ci_runs_view_unit`
- [ ] T5 Add `export * from "./ci";` to the hooks barrel — `client/src/lib/hooks/index.ts` — owner: `implementer` — skill: `react-best-practices` — → AC-16 → `ci_runs_view_unit`
- [ ] T6 `RepoChooser` per the Frozen surface's accessibility mechanics: a labelled text filter that is the tab stop, a `role="listbox"`/`role="option"` result list with `↑/↓/Enter/Esc`, a debounced `aria-live="polite"` match count written once per completed search, and an empty result that states nothing matched **and leaves the current selection unchanged** (edge case: "An empty result is not a deselection") — `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/_components/ExportWizard/_components/RepoChooser/RepoChooser.tsx` (+ `index.ts`) — owner: `implementer` — skill: `react-best-practices` — → AC-19 → `ci_repo_chooser_unit`
- [ ] T7 `reducer.ts` — `WizardState`, `WizardAction`, `canLeaveStep`, `wizardReducer` exactly per the Frozen surface, at module scope with no React import — `.../ExportWizard/reducer.ts`, `.../ExportWizard/constants.ts` — owner: `implementer` — skill: `react-best-practices` — → AC-19, AC-20 → `ci_wizard_unit`
- [ ] T8 `ExportWizard.tsx` steps 0 and 1 — the four target cards (three `<button disabled>` with a text badge), the `RepoChooser`, the file list and the read-only/editable contents pane, the Continue gate, and the workflow-validation call whose failure renders next to the workflow contents — `.../ExportWizard/ExportWizard.tsx`, `.../ExportWizard/styles.ts` — owner: `implementer` — skill: `react-best-practices` — → AC-2, AC-3, AC-19 → `ci_wizard_unit`
- [ ] T9 `ExportWizard.tsx` steps 2 and 3 — the three trigger checkboxes, the expected-secrets table, the publication-mode radios, the branch-protection note, the two install cards (zip inert) and the success state presenting the returned pull-request link — same two files as T8 — owner: `implementer` — skill: `react-best-practices` — → AC-4, AC-7, AC-20, AC-22 → `ci_wizard_unit`
- [ ] T10 Wizard accessibility — `useFocusTrap` on a `<div>` wrapping the whole `<Modal>` (never just its children — `client/insights.md` 2026-08-22), a `tabIndex={-1}` step container focused by a `useEffect` keyed on `state.step`, the "Step {n} of {total}" text line beside `ExportWizardSteps`, and one `role="alert"` region that is written to without any `.focus()` call — same two files as T8 — owner: `implementer` — skill: `react-best-practices` — → AC-17, AC-18 → `ci_wizard_unit`
- [ ] T11 `CiTab.tsx` — the heading, the add-to-CI control opening the wizard at its target step (disabled with an explanatory line when the workspace has no repository), one row per installation with its repository, target, install date, exported threshold and a **word** saying whether the installed workflow version is the version the export would generate now, a row-level line for an installation with no runs yet, and this agent's recent CI runs below (with no run section at all when there are none) — `.../CiTab/CiTab.tsx`, `.../CiTab/helpers.ts`, `.../CiTab/styles.ts`, `.../CiTab/index.ts` — owner: `implementer` — skill: `react-best-practices` — → AC-1, AC-9, AC-23 → `ci_tab_unit`
- [ ] T12 Add the re-export notice beside the existing CI-threshold control at `ConfigTab.tsx:134-140`, rendered once the selected value differs from `agent.ci_fail_on`, stating that the change reaches CI only after the agent is exported to that repository again — `client/src/app/agents/[id]/_components/AgentEditor/_components/ConfigTab/ConfigTab.tsx` — owner: `implementer` — skill: `react-best-practices` — → AC-10 → `ci_fail_on_notice_unit`
- [ ] T13 Add `{ key: "ci-runs", label: "CI Runs", icon: "Workflow", href: "/ci-runs", gKey: "i" }` to the SKILLS LAB group of `NAV`; the key must be exactly `"ci-runs"` to match `app-shell/helpers.ts:38`, and `gKey: "i"` is free against the letters listed in constraint 4. Sidebar, command palette and shortcuts all derive from this one entry — `client/src/vendor/ui/nav.ts` — owner: `implementer` — skill: `frontend-ui-architecture` — → AC-16 → `ci_runs_flow`
- [ ] T14 `/ci-runs` route: a thin `page.tsx` inside `AppShell` with the `ci.page.crumb` breadcrumb, and `CiRunsView` rendering the run rows, the Refresh control, the rejection lines and the two empty states exactly per the Frozen surface; verdict and status render as words, and the job link is emitted only for an `https://` URL and carries `rel="noopener noreferrer"` — `client/src/app/ci-runs/page.tsx`, `client/src/app/ci-runs/_components/CiRunsView/{CiRunsView.tsx,helpers.ts,styles.ts,index.ts}` — owner: `implementer` — skill: `next-best-practices` — → AC-16 → `ci_runs_view_unit`
- [ ] T15 `ci_tab_unit` — mount `CiTab` with mocked `fetch`: the add-to-CI control opens the wizard at its target step (**AC-1**); an installation whose `current` is `true` renders the "up to date" word and one whose `current` is `false` renders the "out of date" word, and an installation whose `workflow_version` is `null` renders the same "out of date" word (**AC-9**, the "installation recorded before workflow versions existed" edge case); the agent's recent runs render, and an agent with installations but no runs renders no run section; an installation with no runs renders its own "no run recorded" line rather than an empty outcome (**AC-23**); with zero repositories the add-to-CI control is disabled and states that a repository must be imported first — `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/CiTab.test.tsx` — owner: `test-writer` — skill: `react-testing-library` — → AC-1, AC-9, AC-23 → `ci_tab_unit`
- [ ] T16 `ci_wizard_unit` — mount `ExportWizard` with mocked `fetch` and `fireEvent` (no `user-event`, constraint from Out of scope): Continue on the target step is disabled until a repository is chosen and enabled after (**AC-19**); the preview step renders one entry per file with only the workflow marked editable (**AC-2**); typing into the workflow and pressing Continue with a server response of `{valid:false,error}` keeps the step, renders the reason **inside the workflow pane**, and issues no install call (**AC-3**); the same edit with `{valid:true}` advances, and Install posts `workflow_contents` equal to the edited text (**AC-22**); each trigger checkbox toggles independently and deselecting all three disables Continue with a stated reason (**AC-20**); the secrets table renders both keys with distinct readiness **words** and neither a value nor a colour-only cue (**AC-4**); a successful install renders the returned pull-request link (**AC-7**); Tab from the last focusable element returns to the first and Escape closes (**AC-17**); moving to the next step puts `document.activeElement` on that step's container (**AC-18**); an install failure renders in the alert region **without** moving `document.activeElement`; and an edit made on the preview step survives going back to target and forward again — `.../ExportWizard/ExportWizard.test.tsx` — owner: `test-writer` — skill: `react-testing-library` — → AC-2, AC-3, AC-4, AC-7, AC-17, AC-18, AC-19, AC-20, AC-22 → `ci_wizard_unit`
- [ ] T17 `ci_repo_chooser_unit` — the filter input is reachable by Tab and `↑/↓/Enter` selects without a pointer; the `aria-live` region reports the match count **once** per completed search under fake timers (two keystrokes inside the debounce window produce one announcement); a search matching nothing states so and leaves the previously chosen repository selected — `.../RepoChooser/RepoChooser.test.tsx` — owner: `test-writer` — skill: `react-testing-library` — → AC-19 → `ci_repo_chooser_unit`
- [ ] T18 `ci_runs_view_unit` — a recorded run renders repository, pull request, agent, verdict word, finding count, cost, duration and a job link (**AC-16**); an `in_progress` run renders no verdict and no counts; an `unavailable` run renders its reason and **not** a zero finding count; a `skipped` run renders the fork explanation and is not presented as a failure; rows are ordered most recent first; a refresh response carrying a rejection renders one line naming that job; both empty states render their own copy; and a run whose `job_url` is not `https://` renders no anchor — `client/src/app/ci-runs/_components/CiRunsView/CiRunsView.test.tsx` — owner: `test-writer` — skill: `react-testing-library` — → AC-16 → `ci_runs_view_unit`
- [ ] T19 `ci_fail_on_notice_unit` — changing the CI-threshold select renders the re-export notice, and the notice is absent before any change (**AC-10**) — `client/src/app/agents/[id]/_components/AgentEditor/_components/ConfigTab/ConfigTab.test.tsx` — owner: `test-writer` — skill: `react-testing-library` — → AC-10 → `ci_fail_on_notice_unit`
- [ ] T20 `ci_tab_flow` — an agent-browser flow modelled on `e2e/specs/14-agent-evals-tab.flow.json`: open `/agents`, click the seeded agent, click the **CI** tab button, `wait --url tab=ci`, then `wait --text` on copy that **only** the CI tab renders (the CI-deployment heading), then click the add-to-CI control and `wait --text` on the target step's own copy. The URL assertion alone is not enough (constraint 17). No step triggers a model call — `e2e/specs/15-agent-ci-tab.flow.json` — owner: `test-writer` — skill: `react-testing-library` — → AC-1 → `ci_tab_flow`
- [ ] T21 `ci_runs_flow` — open the app, activate the **CI Runs** nav item, `wait --url /ci-runs`, then `wait --text` on the no-installation empty-state copy, which only this page renders. The hermetic seed has no installation, so this is the deterministic state — `e2e/specs/16-ci-runs.flow.json` — owner: `test-writer` — skill: `react-testing-library` — → AC-16 → `ci_runs_flow`

## Traceability

| AC | Tasks | Verified by |
|----|-------|-------------|
| AC-1 | T2, T3, T11, T15, T20 | `ci_tab_unit`, `ci_tab_flow` |
| AC-2 | T8, T16 | `ci_wizard_unit` |
| AC-3 | T8, T16 | `ci_wizard_unit` |
| AC-4 | T9, T16 | `ci_wizard_unit` |
| AC-7 | T9, T16 | `ci_wizard_unit` |
| AC-9 | T11, T15 | `ci_tab_unit` |
| AC-10 | T12, T19 | `ci_fail_on_notice_unit` |
| AC-16 | T1, T4, T5, T13, T14, T18, T21 | `ci_runs_view_unit`, `ci_runs_flow` |
| AC-17 | T10, T16 | `ci_wizard_unit` |
| AC-18 | T10, T16 | `ci_wizard_unit` |
| AC-19 | T6, T7, T8, T16, T17 | `ci_wizard_unit`, `ci_repo_chooser_unit` |
| AC-20 | T7, T9, T16 | `ci_wizard_unit` |
| AC-22 | T9, T16 | `ci_wizard_unit` |
| AC-23 | T11, T15 | `ci_tab_unit` |

AC-2, AC-3, AC-4, AC-7, AC-9, AC-16, AC-22 and AC-23 appear here for their
**presentation** half; their server halves are bound in Phase A or Phase B.

## Verification

### Fast loop (implementer / test-writer, after every step)

- `cd client && pnpm typecheck`
- `cd client && pnpm test:unit --reporter=dot`

### Full (plan-verifier, once at the end)

- `cd client && pnpm typecheck`
- `cd client && pnpm test:unit --reporter=dot`
- `cd client && pnpm build` — the only check that catches a value import from
  `@devdigest/shared` (constraint 6); typecheck and unit tests both stay green
  while the build fails.
- `cd server && pnpm typecheck` and `cd server && pnpm test:unit --reporter=dot`
  — nothing server-side changed, so this is a regression check only.
- `./scripts/e2e.sh` — this phase adds two UI entry points (an agent-editor tab
  and a nav item), so the e2e suite is mandatory, not optional. Flows 15 and 16
  must pass alongside the existing 14.
- The end-to-end lab exercise the spec describes — export into a fork of a demo
  repository, read the generated pull request by hand, add the model credential,
  merge, open a test pull request, set the threshold to critical, and confirm a
  critical finding turns the check red while the run appears in CI Runs with no
  secret in any log or attached file — **owner: `human`**. It needs a browser, a
  real GitHub repository and a real model key, and the spec itself calls it
  manual and irreducible. It is the only evidence for nothing: every AC above is
  bound to a test that runs. Before attempting it, `cd agent-runner && pnpm
  install && pnpm build`, or the export will refuse (AC-5).

## Explicit note

Architecture and security review are out of scope for `implementer` and are
handled by separate review agents/skills after implementation. This plan is
intended to run under `/impl-sec`.

## Open questions / assumptions

- **AC-7's automated evidence is a unit test, not the e2e flow the spec's
  Traceability table suggests.** Installing opens a real pull request in a real
  repository with a real credential; `e2e/CLAUDE.md` scopes flows to read-only
  seeded data with no model call and no third-party write, so an e2e install is
  not available. The wizard's rendering of the returned location is bound to
  `ci_wizard_unit`, and the real install is exercised by the human lab exercise.
- **`ci.json`'s `runs.autoRefresh` and `runs.filters.*` keys are left unused.**
  Both describe behaviour the spec lists as a non-goal (scheduled retrieval;
  filtering and non-recency ordering). They stay in the file as scaffolding, per
  root `CLAUDE.md`'s "don't repurpose or clean up" convention for unused starter
  assets.
- **The nav entry joins the SKILLS LAB group.** `2.png` shows a GLOBAL section
  holding Memory, Multi-Agent Review, Agent Performance and CI Runs; three of
  those four routes do not exist, so creating the section for one item would
  leave it looking broken. Assumed, not asked; moving it later is a one-line
  change in `nav.ts`.
- **`gKey: "i"`.** Free against `p, x, s, a, c, e` (`nav.ts:25,26,35,36,42,44`)
  and `,` (`nav.ts:54`). `c` (Conventions) would have been the mnemonic choice
  and is taken.
