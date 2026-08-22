# Development Plan: Eval Pipeline — Phase C (client surfaces + `verify:l06`)

Spec: docs/specs/cross/SPEC-03-eval-pipeline.md
Date: 2026-08-22
Execution mode: multi-agent (Step 0 freeze → 3 parallel tracks → Integration)

Phase 3 of 3. Depends on
`docs/plans/2026-08-22-eval-pipeline-a-foundation.md` and
`docs/plans/2026-08-22-eval-pipeline-b-suite-runs.md` being fully green.
Every contract and every endpoint this phase consumes was frozen there and is
**not re-opened here**.

Design refs (read them before starting a track):
`docs/specs/cross/_design/SPEC-03-eval-pipeline/01-finding-turn-into-eval-case.png`
(the finding action), `02-eval-dashboard-all-agents.png` (Track B),
`03-eval-dashboard-agent-detail.png` (Track B),
`04-eval-compare-runs-modal.png` (Track B),
`05-agent-editor-evals-tab.png` (Track A),
`06-eval-case-positive.png`, `07-eval-case-negative.png` (Track A).

## Goal

Put the eval pipeline on screen: a "Turn into eval case" action on any
accepted or dismissed finding that opens a prefilled case dialog; an Evals tab
in the agent editor listing the agent's cases with their last outcome, a
per-case preview run and a run-all control that shows live progress; a
workspace Eval Dashboard in the SKILLS LAB nav group listing every agent with
an eval set; an agent run-history view with metric deltas and a two-run
comparison including the captured system-prompt diff; and the `verify:l06`
command that the course assignment grades by name.

## Out of scope

- Every element the spec's Non-goals list excludes from the mockups: the
  **Learn** and **Reply to author** finding actions (01); **sparklines** and
  the **Metric trend** chart (02, 03); the **alert banner** (03); the
  **Promote** button (04); the **Run on save** toggle and the **+ Finding
  skeleton** button (06, 07); the **Files** and **PR meta** input tabs (06,
  07); the `v6`/`v7` version labels (02, 03, 04).
- Any server change. If a field is missing, **stop and amend Phase A's
  contract in both vendor copies** rather than deriving it in a component.
- Retrofitting focus-trap behaviour onto the existing modals
  (`CreateAgentModal`, `CreateSkillModal`). See the placement decision below.
- A seed script or a fixture that creates eval cases; no test asserts a case
  count. The two e2e flows therefore assert **empty-state** copy.
- Cancelling a run from the UI; editing a past run; deleting a run.

## Constraints

Every claim below was read in this session at the line given.

1. **`Modal` has `role="dialog"` and `aria-modal="true"` but no focus trap,
   no Escape handler and no focus restore.**
   `client/src/vendor/ui/kit/Modal.tsx:19-68`. AC-43 and AC-44 are therefore
   new work, not something the primitive already provides.
2. **`Modal` applies zero padding to its children.**
   `client/insights.md`, Recurring Errors 2026-08-04 — `Modal.tsx:60` is
   `{ flex: 1, overflow: 'auto' }` and nothing else. Every new `<Modal>`
   consumer needs its own `padding: 24` wrapper or it renders flush to the
   edges.
3. **The agent editor's tab keys are enumerated in two files, and only one of
   them is where you would be working.** `AgentEditor/constants.ts:11-15`
   holds `TABS`; `AgentEditor.tsx:25-31` is a second enumeration of the same
   keys as a ternary chain. `agents/[id]/page.tsx:20` already **derives**
   `VALID_TABS` from `TABS` (the structural fix `client/insights.md`
   2026-08-17 records), so it needs no edit — but the ternary does.
4. **A URL assertion is not a rendering assertion.** Same insight: a broken
   tab whitelist still puts `?tab=x` in the URL. Both e2e flows below assert
   on copy that only the new surface renders, not only on `wait --url`.
5. **`nav.ts` enumerates navigation twice.** `client/src/vendor/ui/nav.ts:21-46`
   is `NAV`; `:68-79` is `SHORTCUTS`, whose `Navigation` group repeats one
   entry per `gKey` by hand. `useShellCommands.ts:21-29` and
   `useGlobalShortcuts.ts:45-47` both derive from `NAV` and need no edit;
   `ShortcutsHelp.tsx:8,44` consumes `SHORTCUTS` by group.
6. **`nav.eval` copy already exists.** `client/messages/en/shell.json:24` —
   `"eval": "Eval Dashboard"`. `useShellCommands.ts:24` resolves a nav item's
   label as `t(\`nav.${it.key}\`)`, so the nav item's `key` must be exactly
   `eval`.
7. **The `eval` i18n namespace already exists with substantial pre-built
   copy.** `client/messages/en/eval.json` carries `dashboard.*`,
   `caseEditor.*`, `evalsTab.*` and `page.*` blocks with **zero consumers**
   — the fourth instance of the pre-built-scaffolding pattern
   (`client/insights.md` 2026-08-05). Reuse these keys; add only what is
   genuinely missing.
8. **`editor.tabs.evals` already exists.** `client/messages/en/agents.json:51`
   — `"evals": "Evals"`. `AgentEditor.tsx:18` resolves `t(tb.labelKey)` under
   the `agents` namespace, so the Evals tab needs **no** cross-namespace
   special case (unlike the Context tab, `client/insights.md` 2026-08-16).
9. **Namespaces are loaded by directory scan, not a registry.**
   `client/src/i18n/request.ts:19-23` reads every `messages/en/*.json`.
   Nothing to register.
10. **e2e flows are discovered by directory scan.** `e2e/run.ts:93-94`
    filters `readdirSync(SPECS_DIR)` for `.flow.json`. Nothing to register.
11. **`@testing-library/user-event` is not installed.**
    `client/insights.md`, Tool & Library Notes 2026-08-08. Use `fireEvent`,
    matching the rest of the suite; do not add the dependency as a drive-by.
12. **A `mutate()` call is asynchronous.** `client/insights.md`, Recurring
    Errors 2026-08-18 — asserting on a mocked `api.post` in the same tick as
    `fireEvent.click` sees zero calls. Await something that only appears after
    the mutation resolves.
13. **A mocked `next/navigation` router that writes a module variable does not
    re-render.** `client/insights.md`, Codebase Patterns 2026-08-04 — force a
    fresh render after any action that depends on the mocked `replace()`.
14. **`MonoLink` renders an inert focusable `<button>` when `href` is falsy**
    (`client/insights.md` 2026-08-08) and its `title` cannot give a control an
    accessible name that differs from its visible text
    (`client/insights.md` 2026-08-18). The per-case action controls (AC's
    accessible-name NFR) use plain `<button aria-label={…}>`, not `MonoLink`.
15. **Data fetching goes through a hook in `src/lib/hooks/*`, never a raw
    `fetch` in a component**, and pages are thin — `client/CLAUDE.md:38-41`.
16. **No root `package.json` exists** and none is created (root `CLAUDE.md`:
    five standalone packages). `verify:l06` lives in `server/package.json` by
    the user's decision.
17. **e2e flows must not trigger a model call** and run against a hermetic,
    freshly seeded stack — `e2e/CLAUDE.md:37-39`, `scripts/e2e.sh`. With no
    seeded eval cases, both new flows assert empty-state copy.

## Placement decisions

- **`EvalCaseDialog` lives in `client/src/components/eval-case-dialog/`, not
  inside either route tree.** It has two consumers in unrelated route trees —
  `FindingCard` under `app/repos/[repoId]/pulls/[number]/` and `EvalsTab`
  under `app/agents/[id]/`. `frontend-ui-architecture`'s placement ladder
  promotes to a shared layer exactly when "a second, unrelated consumer
  actually appears". The in-repo precedent is `ContextAttachPanel`
  (`client/src/components/context-attach/`), imported by `AgentEditor.tsx:9`.
- **`useFocusTrap` is a new hook in `client/src/lib/use-focus-trap.ts`, and
  the vendored `Modal` is not modified.** Two consumers (the case dialog and
  the comparison dialog) justify rung 4 of the ladder, and `lib/` is the
  technology-bound layer ("knows a technology, not your domain"). Changing
  `Modal.tsx` would be the more structural fix and would benefit
  `CreateAgentModal`/`CreateSkillModal` too — it is deliberately **not** done
  here because `Modal` is a vendored copy of `@devdigest/ui` with no source
  package to re-sync from, and silently changing focus behaviour under two
  shipped modals is a change no AC asks for. Recorded as a recommendation, not
  planned.
- **The two dashboards are routes under `client/src/app/evals/`, with their
  feature components colocated in `_components/`** — `client/CLAUDE.md:24-27`
  ("`src/app/**/_components/<Name>/`, each with its own `*.test.tsx`") and
  `frontend-ui-architecture` ("pages are composition + routing only").
- **The Evals tab is a colocated editor tab, not a route** —
  `AgentEditor/_components/EvalsTab/`, mirroring `SkillsTab/` and the Context
  tab. AC-37 is a tab, AC-55 is a link out of it to the dashboard.
- **Server state is never mirrored into component state.**
  `frontend-ui-architecture` "Server state and client state are different
  things": the run in progress, the case list and the run history all live in
  the TanStack Query cache. The **only** client-owned state in this feature is
  the session-local preview result (AC-33), which is deliberately not server
  state — it is discarded on reload by construction.
- **The preview result is owned by `EvalsTab`, the one component that outlives
  both the trigger (a case row) and the destination (the same row's outcome
  cell).** `client/insights.md` 2026-08-05: a per-item target state must be
  owned by an ancestor that survives the transition. A `Map<caseId,
  EvalPerTrace>` in `EvalsTab`'s own `useState` — not in the query cache,
  because a preview must never be broadcast to another surface (spec Edge
  case: "a preview is local to the session that produced it").
- **The polarity banner, the read-only forbidden-zone list and the empty-list
  projection are one component's concern** (`EvalCaseDialog`), because AC-7,
  AC-10 and AC-48 are three views of the same stored expectations and
  splitting them would duplicate the polarity derivation.

## Entry points & duplicate registries

- **`client/src/vendor/ui/nav.ts`** — `NAV` (line 21) and `SHORTCUTS` (line
  68) both enumerate navigation. **T3 collapses the duplication**: the
  `Navigation`-group entries of `SHORTCUTS` are derived from `NAV` (`keys:
  \`g ${it.gKey}\``, `label: \`Go to ${it.label}\``) so a nav item added later
  cannot be missed, and the `Global`/`Findings`/`Actions` entries stay
  hand-written. Derived consumers checked and needing **no** edit:
  `useShellCommands.ts:21-29`, `useGlobalShortcuts.ts:45-47`,
  `ShortcutsHelp.tsx:8,44`.
- **`client/messages/en/shell.json:24`** — `nav.eval` is **already present**;
  the nav item's `key` must be `eval` for `t(\`nav.${it.key}\`)` to resolve.
  Recorded so nobody adds a second key.
- **`AgentEditor/constants.ts:11-15` (`TABS`) and `AgentEditor.tsx:25-31` (the
  render ternary)** — two enumerations of the same keys. **T7 edits both.**
  `agents/[id]/page.tsx:20` derives `VALID_TABS` from `TABS` and is
  **checked, no edit needed**. `messages/en/agents.json:51` already carries
  `editor.tabs.evals` — **checked, no edit needed**.
- **`client/src/lib/hooks/index.ts:4-15`** — the hooks barrel. `export * from
  "./evals"` is added by **T1**.
- **`client/src/i18n/request.ts:19-23`** — **checked, directory scan, no
  registry.** `messages/en/eval.json` already exists as a namespace.
- **`e2e/run.ts:93-94`** — **checked, directory scan, no registry.** Dropping
  the two `.flow.json` files in `e2e/specs/` is enough.
- `grep -rn "turnIntoEvalCase\|evalCase" client/src client/messages` —
  **checked, nothing**; the finding-action copy is genuinely new and goes in
  `messages/en/prReview.json` next to `finding.accept`/`finding.dismiss`
  (line 6-7).
- `grep -rn "/evals" client/src` — **checked, nothing**; no existing route,
  link or breadcrumb points at an eval surface today, so the nav item and the
  AC-55 link are the only two entry points into `/evals`.

## Affected modules & files

- **client (shared)**: `client/src/lib/hooks/evals.ts` (new),
  `client/src/lib/hooks/index.ts`, `client/src/lib/use-focus-trap.ts` (new),
  `client/src/vendor/ui/nav.ts`, `client/messages/en/eval.json`,
  `client/messages/en/prReview.json`
- **client (Track A)**:
  `client/src/components/eval-case-dialog/EvalCaseDialog/{EvalCaseDialog.tsx,helpers.ts,styles.ts}` (new),
  `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/{EvalsTab.tsx,styles.ts}` (new),
  `client/src/app/agents/[id]/_components/AgentEditor/constants.ts`,
  `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx`,
  `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx`
- **client (Track B)**: `client/src/app/evals/page.tsx` (new),
  `client/src/app/evals/_components/AgentEvalRow/{AgentEvalRow.tsx,styles.ts}` (new),
  `client/src/app/evals/_components/RunAllAgentsDialog/RunAllAgentsDialog.tsx` (new),
  `client/src/app/evals/[agentId]/page.tsx` (new),
  `client/src/app/evals/[agentId]/_components/RunHistoryTable/{RunHistoryTable.tsx,styles.ts}` (new),
  `client/src/app/evals/[agentId]/_components/CompareRunsDialog/CompareRunsDialog.tsx` (new)
- **client (Track C — tests)**: `EvalCaseDialog.test.tsx`, `EvalsTab.test.tsx`,
  `FindingCard.test.tsx` (extended), `client/src/app/evals/page.test.tsx`,
  `RunHistoryTable.test.tsx`, `CompareRunsDialog.test.tsx`,
  `client/src/lib/use-focus-trap.test.ts`
- **e2e**: `e2e/specs/13-eval-dashboard.flow.json` (new),
  `e2e/specs/14-agent-evals-tab.flow.json` (new)
- **course command**: `server/package.json`,
  `server/scripts/verify-l06.mjs` (new)

## Step 0 — the frozen contract (written before the tracks fork)

Step 0 is implemented by `implementer` as T1–T3 and must land before Track A
or Track B starts. Both tracks import from it and neither may change it.

### `client/src/lib/hooks/evals.ts` — the whole data surface

```ts
// reads
export function useAgentEvalCases(agentId: string): UseQueryResult<EvalCase[]>;
export function useEvalCaseSeed(findingId: string | null): UseQueryResult<EvalCaseSeed>;   // enabled: findingId != null
export function useEvalDashboard(): UseQueryResult<EvalDashboard>;
export function useAgentEvalRuns(agentId: string): UseQueryResult<EvalRunRecord[]>;
export function useActiveEvalRun(agentId: string): UseQueryResult<EvalRun | null>;
export function useEvalRun(runId: string | null): UseQueryResult<EvalRun>;
export function useEvalComparison(agentId: string, a: string | null, b: string | null): UseQueryResult<EvalComparison>;

// writes
export function useCreateEvalCase(agentId: string): UseMutationResult<EvalCase, …, EvalCaseInput>;
export function useCreateEvalCaseFromFinding(findingId: string): UseMutationResult<EvalCase, …, EvalCaseInput>;
export function useUpdateEvalCase(): UseMutationResult<EvalCase, …, { id: string; patch: EvalCaseUpdate }>;
export function useDeleteEvalCase(): UseMutationResult<void, …, { id: string }>;
export function usePreviewEvalCase(): UseMutationResult<EvalRunResult, …, { id: string }>;
export function useStartEvalRun(agentId: string): UseMutationResult<EvalRun, …, void>;
export function useRunAllAgents(): UseMutationResult<{ runs: EvalRun[] }, …, void>;
```

Query keys: `["evals","cases",agentId]`, `["evals","seed",findingId]`,
`["evals","dashboard"]`, `["evals","runs",agentId]`,
`["evals","active",agentId]`, `["evals","run",runId]`,
`["evals","compare",agentId,a,b]`.

**Polling (AC-24, AC-26):** `useActiveEvalRun` and `useEvalRun` set
`refetchInterval: (q) => isTerminal(q.state.data) ? false : 1500`. When a run
becomes terminal, both invalidate `["evals","cases",agentId]`,
`["evals","runs",agentId]` and `["evals","dashboard"]` so the case outcomes
and the history refresh **without a reload**. No component calls `fetch`
directly (`client/CLAUDE.md:38-41`).

### `client/src/lib/use-focus-trap.ts`

```ts
/** Confines Tab/Shift-Tab to `ref`'s subtree while `active`, focuses the first
 *  focusable node on open, closes on Escape, and restores focus to
 *  `document.activeElement` as it was at open time when `active` goes false. */
export function useFocusTrap(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  onClose: () => void,
): void;
```

AC-43 is the confinement half, AC-44 the restoration half. Both dialogs call
it; nothing else does.

### `EvalCaseDialog` props

```ts
export interface EvalCaseDialogProps {
  mode: 'new' | 'edit' | 'from-finding';
  agentId: string;
  findingId?: string;                    // mode === 'from-finding'
  caseRecord?: EvalCase;                 // mode === 'edit'
  onClose: () => void;
  onSaved?: (c: EvalCase) => void;
}
```

The dialog owns its own draft state, its own validation message and its own
preview result. It never reads the case list.

### Copy

Reuse the existing `eval.json` keys (constraint 7) wherever they fit:
`dashboard.defaultTitle`, `dashboard.recentRuns`, `dashboard.noRuns`,
`dashboard.metrics.*`, `dashboard.table.*`, `caseEditor.newCase`,
`caseEditor.runCase`, `caseEditor.running`, `caseEditor.save`,
`caseEditor.nameLabel`, `caseEditor.inputLabel`, `caseEditor.expectedOutput`,
`caseEditor.validJson`, `caseEditor.invalidJson`, `evalsTab.*`, `page.*`.
New keys required (T2 adds them, exact strings are the assertion targets for
Track C and the two e2e flows):

| Key | English |
|---|---|
| `dashboard.emptyAgents` | `No agent has an eval set yet.` |
| `dashboard.runAllAgents` | `Run all agents` |
| `dashboard.runAllConfirmTitle` | `Run every agent's eval set?` |
| `dashboard.runAllConfirmBody` | `This will start {agents} agent runs and evaluate {cases} cases.` |
| `dashboard.neverRun` | `Never run` |
| `dashboard.inProgress` | `Run in progress — showing the last completed run` |
| `dashboard.progress` | `{done} of {total} cases evaluated` |
| `dashboard.compare` | `Compare` |
| `dashboard.compareTitle` | `Compare runs` |
| `dashboard.promptDiff` | `System prompt diff` |
| `dashboard.caseSetsDiffer` | `These runs evaluated different case sets — {earlier} cases and {later} cases.` |
| `dashboard.contextDiffers` | `These runs used different project context.` |
| `dashboard.selectRun` | `Select the run started at {at} for comparison` |
| `dashboard.runFailed` | `Run failed — every case errored, so no metrics were computed.` |
| `dashboard.deltaUp` | `up {value}` |
| `dashboard.deltaDown` | `down {value}` |
| `dashboard.deltaNone` | `no earlier run to compare` |
| `evalsTab.viewDashboard` | `View full dashboard` |
| `evalsTab.runAll` | `Run all evals` |
| `evalsTab.subtext` | `expected {expected}, got {got}` |
| `evalsTab.errored` | `errored` |
| `evalsTab.previewNotStored` | `Preview — not stored` |
| `evalsTab.noContext` | `No project context will be resolved for this case.` |
| `evalsTab.runCaseAria` | `Run the eval case {name}` |
| `evalsTab.editCaseAria` | `Edit the eval case {name}` |
| `evalsTab.deleteCaseAria` | `Delete the eval case {name}` |
| `caseEditor.positiveBanner` | `POSITIVE CASE — MUST find "{title}" at {file}:{line}` |
| `caseEditor.negativeBanner` | `NEGATIVE CASE — MUST NOT flag {file}:{line}` |
| `caseEditor.forbiddenZones` | `Forbidden zones (read-only)` |
| `caseEditor.repoLabel` | `Repository` |
| `caseEditor.repoNone` | `No repository — no project context` |
| `caseEditor.expectedInvalid` | `Expected output must be a non-empty list of expectations of one kind, each with a file, a start line and an end line.` |
| `caseEditor.announceComplete` | `Eval run finished: {outcome}` |

`messages/en/prReview.json`, next to `finding.dismiss` (line 7):
`"turnIntoEvalCase": "Turn into eval case"`.

## Tasks

### Step 0 — freeze the shared surface

- [ ] T1 `useEvals*` hooks exactly per the Step 0 surface, including the
      terminal-state polling and the invalidation set; add `export * from
      "./evals"` to the barrel — `client/src/lib/hooks/evals.ts`,
      `client/src/lib/hooks/index.ts` — owner: `implementer` — skill:
      `react-best-practices` — → AC-26 → `evals_tab_unit`
- [ ] T2 Add every new key in the table above to `client/messages/en/eval.json`
      and `finding.turnIntoEvalCase` to `client/messages/en/prReview.json`;
      change no existing value — `client/messages/en/eval.json`,
      `client/messages/en/prReview.json` — owner: `implementer` — skill:
      `next-best-practices` — → AC-35 → `eval_dashboard_unit`
- [ ] T3 Add `{ key: "eval", label: "Eval Dashboard", icon: "Gauge", href:
      "/evals", gKey: "e" }` to the **SKILLS LAB** group of `NAV`, and derive
      the `Navigation` group of `SHORTCUTS` from `NAV` instead of listing it
      by hand (the `Global`/`Findings`/`Actions` entries stay literal) —
      `client/src/vendor/ui/nav.ts` — owner: `implementer` — skill:
      `frontend-ui-architecture` — → AC-35 → `eval_dashboard_e2e`
- [ ] T4 `useFocusTrap` per the Step 0 signature —
      `client/src/lib/use-focus-trap.ts` — owner: `implementer` — skill:
      `react-best-practices` — → AC-43, AC-44 → `focus_trap_unit`

### Track A — cases, the dialog, the Evals tab, the finding action

- [ ] T5 `EvalCaseDialog`: name field, repository select (`useRepos`, with an explicit "no repository" option — AC-47's client half and `caseEditor.repoNone`), a scrollable frozen-diff textarea, the expected-output JSON editor, and a `padding: 24` wrapper inside `<Modal>` (constraint 2). Calls `useFocusTrap` — `client/src/components/eval-case-dialog/EvalCaseDialog/{EvalCaseDialog.tsx,styles.ts}` — owner: `implementer` — skill: `react-best-practices` — → AC-6, AC-43, AC-44 → `eval_case_dialog_unit`
- [ ] T6 Dialog polarity behaviour, all in `helpers.ts` + the dialog: derive polarity from the stored/prefilled expectations; render the banner naming the finding, file and line for a positive case and "must not be flagged" for a negative one (**AC-48**, design refs 06/07); project a `must_not_flag` case's editor content as `[]` (**AC-7**); render the stored forbidden zones' file and line range as read-only content beside the projection (**AC-10**); on save, send `expectations: []` unchanged for a negative case so the server keeps them (**AC-8**, Phase A); reject and show `caseEditor.expectedInvalid` **next to the editor** for anything that is not a non-empty one-kind list with file/start/end (**AC-9**, client half) — `client/src/components/eval-case-dialog/EvalCaseDialog/{EvalCaseDialog.tsx,helpers.ts}` — owner: `implementer` — skill: `react-best-practices` — → AC-7, AC-9, AC-10, AC-48 → `eval_case_dialog_unit`
- [ ] T7 Evals tab: add `{ key: "evals", labelKey: "editor.tabs.evals", icon: "Activity" }` to `TABS` **and** the matching branch to the render ternary (constraint 3; `page.tsx` needs no edit). The tab lists the agent's cases with name, status **as text as well as icon** (`passed`/`failed`/`errored`/`never run` — NFR), the AC-20 subtext from `expected_count`/`matched_count`, the severity and category when the expectations carry them (**AC-56**), the `evalsTab.noContext` note for a case with no repository (**AC-50**), and per-case Run / Edit / Delete controls whose `aria-label`s name both the action and the case (NFR, constraint 14) — `client/src/app/agents/[id]/_components/AgentEditor/constants.ts`, `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx`, `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/{EvalsTab.tsx,styles.ts}` — owner: `implementer` — skill: `frontend-ui-architecture` — → AC-20, AC-37, AC-50, AC-56 → `evals_tab_unit`
- [ ] T8 Evals tab run controls: the run-all control is **absent when the agent has no case** (**AC-22**) and **not activatable while a run is in progress** (**AC-23**); while a run is in progress the tab shows `dashboard.progress` with `cases_done`/`cases_total` (**AC-24**) and keeps rendering the **last completed run's** metrics and per-case outcomes, or "never run" where there is none (**AC-25**); the metric header carries the `evalsTab.viewDashboard` link to `/evals/[agentId]` (**AC-55**); when the run reaches a terminal state the outcome replaces the progress without a reload (**AC-26**) and is announced through an `aria-live="polite"` region that never moves focus (**AC-45**); the in-progress indicator uses a stepped, non-animated form under `prefers-reduced-motion` (NFR) — `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.tsx` — owner: `implementer` — skill: `react-best-practices` — → AC-22, AC-23, AC-24, AC-25, AC-26, AC-45, AC-55 → `evals_tab_unit`
- [ ] T9 Preview run: the per-case Run control calls `usePreviewEvalCase`, stores the result in `EvalsTab`'s own `Map<caseId, EvalPerTrace>` (never in the query cache), and the row renders it labelled `evalsTab.previewNotStored` (**AC-33**); a case with no preview in this session renders the persisted `last_outcome`, or "never run" (**AC-34**) — `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.tsx` — owner: `implementer` — skill: `react-best-practices` — → AC-33, AC-34 → `evals_tab_unit`
- [ ] T10 Finding action: add a `Button` labelled `finding.turnIntoEvalCase` to `FindingCard`'s action row, always rendered and `disabled` unless `accepted_at || dismissed_at` (**AC-2**); clicking it opens `EvalCaseDialog` in `from-finding` mode prefilled from `useEvalCaseSeed` (**AC-1**), and closing it returns focus to that button (**AC-44**). Do **not** add the Learn or Reply-to-author controls from mockup 01 — `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx` — owner: `implementer` — skill: `react-best-practices` — → AC-1, AC-2 → `finding_card_unit`

### Track B — the two dashboards and the comparison (files disjoint from Track A)

- [ ] T11 `/evals`: one `AgentEvalRow` per agent in `dashboard.agents`, each showing the agent name, model, last completed run's start time, its passed/total counts and its recall / precision / citation accuracy **with the numeric value as text next to every bar** (NFR); an agent with cases and no completed run renders `dashboard.neverRun` rather than being hidden (**AC-35**); the page renders `dashboard.emptyAgents` when the list is empty; activating a row navigates to `/evals/[agentId]` (**AC-36**'s entry point) — `client/src/app/evals/page.tsx`, `client/src/app/evals/_components/AgentEvalRow/{AgentEvalRow.tsx,styles.ts}` — owner: `implementer` — skill: `frontend-ui-architecture` — → AC-35 → `eval_dashboard_unit`
- [ ] T12 Run-all-agents: the control opens `RunAllAgentsDialog` stating `dashboard.runAllConfirmBody` with `run_all.agent_count` and `run_all.case_count` **before anything starts** (**AC-32**); confirming calls `useRunAllAgents` (**AC-31**); the dialog is not activatable when `agent_count` is 0 — `client/src/app/evals/_components/RunAllAgentsDialog/RunAllAgentsDialog.tsx`, `client/src/app/evals/page.tsx` — owner: `implementer` — skill: `react-best-practices` — → AC-31, AC-32 → `eval_dashboard_unit`
- [ ] T13 `/evals/[agentId]`: the agent's completed runs, most recently started first (**AC-36**); each row shows recall, precision, citation accuracy, passed/total, cost, errored count, and each metric's **delta against the immediately preceding completed run stated in words** (`dashboard.deltaUp`/`deltaDown`), with `dashboard.deltaNone` and no arrow for the earliest run (**AC-38**, NFR "not by arrow colour alone"); a failed run renders `dashboard.runFailed` and **no metrics** (**AC-29**'s presentation); each row's selection control has the accessible name `dashboard.selectRun` naming the start time (NFR) and is at least 24×24 CSS px (NFR) — `client/src/app/evals/[agentId]/page.tsx`, `client/src/app/evals/[agentId]/_components/RunHistoryTable/{RunHistoryTable.tsx,styles.ts}` — owner: `implementer` — skill: `frontend-ui-architecture` — → AC-36, AC-38 → `run_history_unit`
- [ ] T14 Compare: the Compare control is activatable **exactly when two runs are selected** (**AC-39**); activating it opens `CompareRunsDialog` showing the two runs earlier-first with both values and the difference for recall, precision, citation accuracy and cost (**AC-40**), the `prompt_diff` lines rendered as inert text with added/removed conveyed by a text marker as well as colour (**AC-41**, NFR), `dashboard.caseSetsDiffer` with both counts when `case_sets_differ` (**AC-42**), and `dashboard.contextDiffers` when `context_differs` (**AC-54**); the dialog uses `useFocusTrap` and a `padding: 24` wrapper (**AC-43**, **AC-44**, constraint 2). Do **not** render the Promote button from mockup 04 — `client/src/app/evals/[agentId]/_components/CompareRunsDialog/CompareRunsDialog.tsx` — owner: `implementer` — skill: `react-best-practices` — → AC-39, AC-40, AC-41, AC-42, AC-43, AC-44, AC-54 → `compare_dialog_unit`

### Track C — tests, e2e and the course command

- [ ] T15 `focus_trap_unit` — Tab from the last focusable node wraps to the first and Shift-Tab from the first wraps to the last while active; Escape calls `onClose`; focus returns to the element that was active at open time when `active` goes false — `client/src/lib/use-focus-trap.test.ts` — owner: `test-writer` — skill: `react-testing-library` — → AC-43, AC-44 → `focus_trap_unit`
- [ ] T16 `eval_case_dialog_unit` — a negative case renders `[]` in the editor (**AC-7**) with its stored zones listed read-only beside it (**AC-10**); saving that unchanged sends `expectations: []` (**AC-8** client half, asserted on the mocked `api.put` **after** awaiting a post-mutation assertion, constraint 12); a mixed-kind list and an empty list on a positive case both render `caseEditor.expectedInvalid` next to the editor and send **no** request (**AC-9**); the banner names the finding, file and line for a positive case and states the forbidden zone for a negative one (**AC-48**); opening from the Evals tab's new-case control renders an empty dialog owned by that agent (**AC-6**); focus is confined while open and returns to the opener on close (**AC-43**, **AC-44**). Use `fireEvent`, not `user-event` (constraint 11) — `client/src/components/eval-case-dialog/EvalCaseDialog/EvalCaseDialog.test.tsx` — owner: `test-writer` — skill: `react-testing-library` — → AC-6, AC-7, AC-8, AC-9, AC-10, AC-43, AC-44, AC-48 → `eval_case_dialog_unit`
- [ ] T17 `evals_tab_unit` — an agent with zero cases renders no activatable run-all control (**AC-22**); with an active run the control is not activatable (**AC-23**), `dashboard.progress` shows `cases_done`/`cases_total` (**AC-24**) and the **previous** completed run's metrics and per-case outcomes still render, or `evalsTab.neverRun` where there is none (**AC-25**); driving the mocked `GET /eval-runs/:id` through `pending → running → completed` re-renders the outcome **without remounting the tab** and fires the `aria-live` announcement without moving `document.activeElement` (**AC-26**, **AC-45**); the subtext reads `expected {n}, got {m}` for both polarities (**AC-20**); a preview result renders labelled `evalsTab.previewNotStored` and a second case with only a persisted outcome renders that instead (**AC-33**, **AC-34**); a case with `resolves_context: false` renders `evalsTab.noContext` (**AC-50**); expectations carrying severity and category render both (**AC-56**); the `evalsTab.viewDashboard` control links to `/evals/{agentId}` (**AC-55**); the tab renders the agent's cases (**AC-37**) — `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.test.tsx` — owner: `test-writer` — skill: `react-testing-library` — → AC-20, AC-22, AC-23, AC-24, AC-25, AC-26, AC-33, AC-34, AC-37, AC-45, AC-50, AC-55, AC-56 → `evals_tab_unit`
- [ ] T18 `finding_card_unit` — extend the existing file: a finding with neither timestamp renders the control **disabled** (**AC-2**); an accepted finding's control opens the dialog prefilled from the mocked seed response (**AC-1**); a dismissed finding's does too; closing returns focus to the control (**AC-44**) — `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.test.tsx` — owner: `test-writer` — skill: `react-testing-library` — → AC-1, AC-2 → `finding_card_unit`
- [ ] T19 `eval_dashboard_unit` — one row per agent in the mocked payload including an agent with `never_run: true` (**AC-35**); the empty payload renders `dashboard.emptyAgents` and a non-activatable run-all control; activating run-all shows the confirmation naming `agent_count` and `cases_count` **before** any `api.post` fires (**AC-32**), and confirming posts once (**AC-31**) — `client/src/app/evals/page.test.tsx` — owner: `test-writer` — skill: `react-testing-library` — → AC-31, AC-32, AC-35 → `eval_dashboard_unit`
- [ ] T20 `run_history_unit` — runs render newest-first (**AC-36**); every metric carries its delta as text with a direction word, and the earliest run carries `dashboard.deltaNone` and no delta (**AC-38**); a `failed` run renders `dashboard.runFailed` and no metric values; each selection control's accessible name contains its run's start time; the Compare control is inert with 0, 1 and 3 selections and activatable with exactly 2 (**AC-39**) — `client/src/app/evals/[agentId]/_components/RunHistoryTable/RunHistoryTable.test.tsx` — owner: `test-writer` — skill: `react-testing-library` — → AC-36, AC-38, AC-39 → `run_history_unit`
- [ ] T21 `compare_dialog_unit` — the two runs render earlier-first even when selected later-first, with both values and the difference for all four metrics (**AC-40**); the prompt diff renders added and removed lines with a text marker (**AC-41**); `case_sets_differ` renders `dashboard.caseSetsDiffer` with both counts and is absent when the sets match (**AC-42**); `context_differs` renders `dashboard.contextDiffers` and is absent when it is false (**AC-54**); focus is confined and restored (**AC-43**, **AC-44**) — `client/src/app/evals/[agentId]/_components/CompareRunsDialog/CompareRunsDialog.test.tsx` — owner: `test-writer` — skill: `react-testing-library` — → AC-40, AC-41, AC-42, AC-43, AC-44, AC-54 → `compare_dialog_unit`
- [ ] T22 `eval_dashboard_e2e` — open `{BASE}/`, click the **Eval Dashboard** nav item, `wait --url /evals`, then `wait --text "No agent has an eval set yet."` — copy that exists **only** on the new dashboard, so the flow fails on a build where the route renders a fallback even though the URL is right (constraint 4). No control that starts a run is clicked (constraint 17) — `e2e/specs/13-eval-dashboard.flow.json` — owner: `test-writer` — skill: `frontend-ui-architecture` — → AC-35 → `eval_dashboard_e2e`
- [ ] T23 `agent_evals_tab_e2e` — open `{BASE}/agents`, `wait --load networkidle`, click the seeded `Test Quality Reviewer`, `wait --url /agents/`, click the **Evals** button, `wait --url tab=evals`, then `wait --text "No eval cases yet."` — the `evalsTab.emptyCases` copy, which no other tab renders. Model on `e2e/specs/11-agent-context-tab.flow.json`, including its description of why the URL assertion alone is insufficient — `e2e/specs/14-agent-evals-tab.flow.json` — owner: `test-writer` — skill: `frontend-ui-architecture` — → AC-37 → `agent_evals_tab_e2e`
- [ ] T24 `verify:l06` — add `"verify:l06": "node scripts/verify-l06.mjs"` to `server/package.json` and write the runner. It spawns each step with an explicit `cwd` (no shell `&&`, no `cd`, so it behaves identically under PowerShell, cmd and bash — constraint 16) and fails on the first non-zero exit: (1) `pnpm typecheck` in `server/`; (2) `pnpm typecheck` in `client/`; (3) `pnpm exec vitest run --reporter=dot test/eval-scoring.test.ts test/eval-helpers.test.ts test/eval-metrics.test.ts test/eval-compare.test.ts test/eval-contracts.test.ts` in `server/` — the deterministic scorer tests; (4) `pnpm exec vitest run --reporter=dot test/eval-runs.it.test.ts` in `server/` — the suite-run integration test (**requires Docker**); (5) `pnpm exec vitest run --reporter=dot src/app/evals src/components/eval-case-dialog src/app/agents` in `client/` — the client eval-surface smoke; (6) the **static purity check**: read `server/src/modules/evals/scoring.ts`, take only the lines matching `/^\s*import\b/`, and fail if any of them names `openai`, `@anthropic-ai/sdk`, `reviewer-core`, `adapters/llm`, `LLMProvider` or `container`. Scanning import lines only — rather than the raw file — is what stops a doc comment from tripping the guard (`server/insights.md` 2026-08-07) — `server/package.json`, `server/scripts/verify-l06.mjs` — owner: `implementer` — skill: `typescript-expert` — → AC-57 → `verify_l06`

### Integration

- [ ] T25 Run the Full block; then confirm `grep -rn "fetch(" client/src/app/evals client/src/components/eval-case-dialog` returns nothing but a `refetch` renamed away from the guard (`client/insights.md` 2026-08-07), and that `git diff --name-only server/src client/src/vendor/shared` shows only `server/package.json`, `server/scripts/` and no contract file — owner: `implementer` — skill: `frontend-ui-architecture` — → AC-57 → `verify_l06`
- [ ] T26 `./scripts/e2e.sh` (hermetic runner, isolated Postgres :5433 / API :3101 / web :3100) — all fourteen flows green, including the two new ones. Do **not** run `cd e2e && npm test` against a dev stack (`e2e/CLAUDE.md:42-44`) — owner: `implementer` — skill: `frontend-ui-architecture` — → AC-35, AC-37 → `eval_dashboard_e2e`, `agent_evals_tab_e2e`
- [ ] T27 Manual walkthrough of one full loop against a real API key: accept a finding, turn it into a case, run all evals for that agent, watch the progress, compare two runs — **owner: `human`** (needs a browser and a paid model call; no automated agent in this chain can drive one). This is **supplementary evidence only**: every AC above is already bound to a test that runs — owner: `human` — skill: — → AC-26 → `evals_tab_unit`

## Traceability

| AC | Tasks | Verified by |
|----|-------|-------------|
| AC-1 | T10, T18 | `finding_card_unit` |
| AC-2 | T10, T18 | `finding_card_unit` |
| AC-6 | T5, T16 | `eval_case_dialog_unit` |
| AC-7 | T6, T16 | `eval_case_dialog_unit` |
| AC-8 | T6, T16 | `eval_case_dialog_unit` |
| AC-9 | T6, T16 | `eval_case_dialog_unit` |
| AC-10 | T6, T16 | `eval_case_dialog_unit` |
| AC-20 | T7, T17 | `evals_tab_unit` |
| AC-22 | T8, T17 | `evals_tab_unit` |
| AC-23 | T8, T17 | `evals_tab_unit` |
| AC-24 | T8, T17 | `evals_tab_unit` |
| AC-25 | T8, T17 | `evals_tab_unit` |
| AC-26 | T1, T8, T17 | `evals_tab_unit` |
| AC-29 | T13, T20 | `run_history_unit` |
| AC-31 | T12, T19 | `eval_dashboard_unit` |
| AC-32 | T12, T19 | `eval_dashboard_unit` |
| AC-33 | T9, T17 | `evals_tab_unit` |
| AC-34 | T9, T17 | `evals_tab_unit` |
| AC-35 | T2, T3, T11, T19, T22, T26 | `eval_dashboard_unit`, `eval_dashboard_e2e` |
| AC-36 | T11, T13, T20 | `run_history_unit` |
| AC-37 | T7, T17, T23, T26 | `evals_tab_unit`, `agent_evals_tab_e2e` |
| AC-38 | T13, T20 | `run_history_unit` |
| AC-39 | T14, T20 | `run_history_unit` |
| AC-40 | T14, T21 | `compare_dialog_unit` |
| AC-41 | T14, T21 | `compare_dialog_unit` |
| AC-42 | T14, T21 | `compare_dialog_unit` |
| AC-43 | T4, T5, T14, T15, T16, T21 | `focus_trap_unit`, `eval_case_dialog_unit`, `compare_dialog_unit` |
| AC-44 | T4, T5, T10, T14, T15, T16, T18, T21 | `focus_trap_unit`, `eval_case_dialog_unit`, `finding_card_unit`, `compare_dialog_unit` |
| AC-45 | T8, T17 | `evals_tab_unit` |
| AC-48 | T6, T16 | `eval_case_dialog_unit` |
| AC-50 | T7, T17 | `evals_tab_unit` |
| AC-54 | T14, T21 | `compare_dialog_unit` |
| AC-55 | T8, T17 | `evals_tab_unit` |
| AC-56 | T7, T17 | `evals_tab_unit` |
| AC-57 | T24, T25 | `verify_l06` |

`verify_l06` is the successful exit of `cd server && pnpm verify:l06` — the
AC-57 evidence, run by `plan-verifier` in the Full block below, not by a
human.

## Verification

### Fast loop (implementer / test-writer, after every step)

- `cd client && pnpm typecheck`
- `cd client && pnpm test:unit --reporter=dot`
- `cd server && pnpm typecheck` (T24 touches `server/package.json` only, but
  keeps the command honest)

### Full (plan-verifier, once at the end)

- `cd server && pnpm typecheck`
- `cd client && pnpm typecheck`
- `cd e2e && pnpm typecheck`
- `cd server && pnpm test:unit --reporter=dot`
- `cd client && pnpm test:unit --reporter=dot`
- `cd server && pnpm test:integration --reporter=dot` (Docker; the three
  DB-backed eval files from Phases A and B)
- `./scripts/e2e.sh` — this plan adds two UI entry points (a nav item + two
  routes, and an agent-editor tab), so the e2e suite is mandatory here.
- `cd server && pnpm verify:l06` — **the AC-57 evidence.** Requires Docker,
  because step 4 is the suite-run integration test the spec's Course
  verification section names.
- Manual browser walkthrough (T27) — **owner: `human`**, supplementary only.

## Explicit note

Architecture and security review are out of scope for `implementer` and are
handled by separate review agents/skills after implementation.

## Open questions / assumptions

- **AC-26 and AC-1 are bound to component tests, not to e2e flows, contrary
  to the spec's Traceability table.** `e2e/CLAUDE.md:37-39` requires flows to
  target read-only seeded data so that no flow triggers a model call, and
  decision 4 forbids seeding eval cases — so no e2e flow can reach a terminal
  eval run (AC-26) or a prefilled case dialog (AC-1) without either seeding
  cases or spending money on every CI e2e run. The component tests drive the
  same states deterministically through the mocked API. The e2e flows still
  exist and still guard the two new **entry points** (AC-35, AC-37), which is
  what an e2e flow is for in this repo. Flagged rather than silently
  reinterpreted.
- **`verify:l06` requires Docker**, because the spec's Course verification
  list names "an integration test of a suite run, proving that the run and its
  case results are persisted". There is no way to satisfy that clause
  hermetically with the repo's testcontainers-based integration setup.
- **The nav item's `gKey` is `e`.** `e` is unused by the current chord set
  (`nav.ts:25-43`, `SETTINGS_ITEM.gKey = ","`). Assumed; nothing in the spec
  asks for a shortcut, and T3 derives the help entry from `NAV` so it cannot
  drift.
- **The nav icon is `Gauge`**, verified present at
  `client/src/vendor/ui/icons.tsx:58,140`; it matches mockup 02's gauge. Not
  an open question, recorded here only so the choice is traceable.
- **`useFocusTrap` is not retrofitted onto `Modal`**, so `CreateAgentModal`
  and `CreateSkillModal` keep their current (untrapped) behaviour. That is a
  known a11y gap in code this feature does not own; see the placement
  decision.
