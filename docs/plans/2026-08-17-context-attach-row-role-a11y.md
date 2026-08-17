# Development Plan: Context attach panel — row role and nested controls (a11y)

Spec: docs/specs/cross/SPEC-01-project-context.md
Date: 2026-08-17
Execution mode: single-agent, but code and tests are a coordinated pair — see Ownership

Follow-up to [2026-08-16-project-context-browse-attach.md](2026-08-16-project-context-browse-attach.md),
raised by a `pr-self-review` pass on that plan's implementation. Two of its
WARNING findings are one defect with one cause; this plan fixes that cause.

## Goal

Make every control in a `ContextAttachPanel` row reachable and correctly named
for assistive technology, without losing the keyboard reorder path AC-15
requires or the announcement AC-16 requires.

## The defect

`ContextAttachPanel.tsx:154` puts `role="checkbox"` on the whole row `<div>`.
Two interactive things live inside it:

- the preview control, a real `<button>` with an `aria-label` (`:196`)
- the reorder grip, marked `role="img"` with an `aria-label` (`:175`)

ARIA's **presentational-children rule** makes the children of a `checkbox`
presentational: assistive technology is permitted to expose none of them. So
the preview button — the control whose accessible name the spec's NFR
specifically requires to identify both the action and the document — may never
be announced at all. The grip is worse than inert: `role="img"` advertises a
drag affordance to sighted users while being neither focusable nor operable,
and the keyboard reorder it appears to offer actually lives on the row.

**This is the part worth naming for `test-writer`: AC-16's test is green and the
criterion is not met.** `ContextAttachPanel.test.tsx:187` ("announces the
document and its new position to assistive technology") asserts the text of the
live region after an `Alt+Arrow` — which is real, and passes. It does not assert
that a screen-reader user can reach the row's controls in the first place. A
green test over a real defect means the test asserts the wrong thing; fixing the
markup without fixing that assertion would leave the same hole for the next
change.

## Out of scope

- Any change to `ProjectContextView` — its empty/no-match handling is already
  correct and was verified in the review.
- Re-styling the row. If the fix needs a layout change to keep the preview
  control outside the checkbox, the visual result must still match mockups 02
  and 03; changing the design is a separate decision.
- The `role="alert"` budget warning and the `role="status"` live region — both
  are correct as written and must keep behaving identically.

## Constraints

- **AC-15 must survive.** The `Alt+ArrowUp` / `Alt+ArrowDown` handler and the
  focus-retention behaviour currently live on the row element; whatever element
  ends up carrying the role, a keyboard user must still move a focused row and
  keep focus on it.
- **AC-14 must survive.** Reordering stays disabled while the filter is
  non-empty (`draggable = row.attached && !row.missing && !filtering`).
- **AC-16 must survive.** The live region keeps announcing document and new
  position; only its trustworthiness improves.
- Drag-and-drop (`drag.rowProps`) must keep working for pointer users.
- `client/messages/en/context.json` already has `attachAria`, `reorderAria`,
  `previewAria`, `noMatch` — reuse them; do not invent new keys without need.

## Ownership

Two agents, in this order — the test file is not the implementer's to edit:

1. `implementer` — `ContextAttachPanel.tsx` and, if required, `styles.ts`.
2. `test-writer` — `ContextAttachPanel.test.tsx`: retarget selectors, add the
   missing coverage. **9 assertions across 6 tests currently select the row via
   `.closest('[role="checkbox"]')`**; they are expected to change, and changing
   them is not a regression.

Do not skip step 2 or land step 1 alone: the suite will go red by design.

## Tasks

- [ ] **A1** Move `role="checkbox"` off the row container so that no
      interactive descendant is nested inside the checkbox role. The row keeps
      `tabIndex`, the `onKeyDown` handler, and `drag.rowProps`; the checkbox
      role, `aria-checked`, and `attachAria` name move to the element that
      actually represents the attach state. Verify against mockups 02 and 03
      that the rendered row is unchanged. — `client/src/components/context-attach/ContextAttachPanel/ContextAttachPanel.tsx`
      (and `styles.ts` if positioning is needed) — owner: `implementer` — skills:
      `react-best-practices`, `frontend-ui-architecture` — → AC-15, AC-16
- [ ] **A2** Resolve the grip. Either promote it to a real `<button>` that
      performs the same move as `Alt+Arrow` (and give it an accessible name
      stating the action, not just the document), or drop the `role="img"` and
      mark it `aria-hidden` as pure decoration. **Do not leave it as a named
      `img`** — that is the current state and it advertises an affordance it
      does not provide. If it becomes a button, it must not sit inside the
      checkbox role. — same files — owner: `implementer` — skill:
      `accessibility-requirements` — → AC-15
- [ ] **A3** Retarget the 9 row selectors in the test file to whatever A1
      settled on, and assert what the old ones could not: that the preview
      control is exposed and named, and that the row's controls are reachable
      by keyboard alone. — `client/src/components/context-attach/ContextAttachPanel/ContextAttachPanel.test.tsx`
      — owner: `test-writer` — skill: `react-testing-library` — → AC-15, AC-16
- [ ] **A4** Add the missing no-match test: with a filter that matches nothing,
      the panel renders `t("noMatch")` and not a blank list. The behaviour
      landed during self-review with no test attached. — same test file —
      owner: `test-writer` — skill: `react-testing-library` — → AC-14

## Traceability

| AC | Tasks | Verified by |
|----|-------|-------------|
| AC-14 | A4 | `ContextAttachPanel.test.tsx > states that the filter matched no documents` |
| AC-15 | A1, A2, A3 | `ContextAttachPanel.test.tsx > moves a focused row one position with the keyboard and keeps focus on it` **and** a new case asserting every row control is keyboard-reachable and named |
| AC-16 | A1, A3 | `ContextAttachPanel.test.tsx > announces the document and its new position to assistive technology`, strengthened per A3 |

AC-14's existing "does not permit reordering while the filter is non-empty" case
stays as-is; A4 adds the sibling case for the same criterion.

## Verification

- `cd client && pnpm typecheck`
- `cd client && pnpm test:unit --reporter=dot` — expected 128 + the new cases
- `cd server && pnpm typecheck && pnpm test:unit --reporter=dot` (188) — should
  be untouched; run it to prove this change is client-only
- Manual keyboard pass, since jsdom cannot prove this one: `./scripts/dev.sh`,
  open an agent's **Context** tab, and with the keyboard alone — reach a row,
  toggle attachment, reach and activate its preview control, move it with
  `Alt+ArrowDown`, and confirm focus stays on the moved row. This step is the
  actual acceptance test for the defect; the unit tests are the regression net.

## Explicit note

Architecture and security review are out of scope for `implementer` and are
handled by separate review agents/skills after implementation.

## Open questions / assumptions

- **Whether the preview control can stay inside the row without absolute
  positioning is unresolved** and is the reason this was not fixed inside the
  self-review pass. A1 says "verify against mockups 02 and 03" rather than
  prescribing the markup, because that check needs a browser.
- **Assumed the grip should become a real button** rather than decoration —
  mockups 02 and 03 draw it as a drag handle, and a visible handle that only
  works for pointer users is the narrower reading of AC-15. If the reviewer
  disagrees, A2's second branch is the one-line alternative.
- This plan does not renumber or reinterpret any acceptance criterion; it
  changes how three of them are verified, which the spec permits and its own
  traceability table anticipates.
