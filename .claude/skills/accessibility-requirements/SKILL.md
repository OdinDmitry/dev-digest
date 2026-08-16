---
name: accessibility-requirements
description: Turning accessibility into testable, implementation-free requirements — what to interrogate a design or a feature for (keyboard path, focus, naming, colour, motion, status announcements, forms and errors, target size) and how to phrase each finding as an acceptance criterion. Use when specifying a user-facing feature or reviewing a mockup for accessibility gaps. Does NOT cover implementation (ARIA attributes, roles, markup) — that is the frontend skills' job.
---

# Accessibility as requirements

This skill is about **what must be true** for a feature to be usable without a
mouse, without sight, or without fine motor control — phrased so it can be
tested. It deliberately says nothing about how to achieve it: naming an ARIA
attribute or a markup pattern in a spec is an implementation decision.

The distinction that matters:

- ❌ implementation — "The dialog SHALL have `role="dialog"` and `aria-modal`."
- ✅ requirement — "WHILE a modal dialog is open, the system SHALL confine
  keyboard focus to the dialog and SHALL return focus to the control that
  opened it when the dialog closes."

The second survives a rewrite of the component. The first does not.

## Eight things to interrogate

Work through these against the design or the described behaviour. Each one that
is not already answered is either an acceptance criterion, an edge case, or an
open question.

**1. Keyboard path.** Can every action be reached and performed without a
pointer? In what order? Is anything reachable only by hover, drag, right-click,
or a gesture? A drag-to-reorder list with no keyboard equivalent is the classic
miss.

**2. Focus management.** Where does focus go when something opens, closes,
appears, or is deleted? Deleting the focused row and dropping focus to the
document body loses the user's place entirely. Is focus visible at all times,
and is it trapped where it should be (modals) and not where it shouldn't
(everything else)?

**3. Accessible name and role.** Does every control have a name that says what
it does, not what it looks like? Icon-only buttons, controls whose meaning
comes only from position in a table, and links that all read "view" are the
usual offenders. Specify the *meaning* the name must convey, not the markup.

**4. Colour and contrast.** Is any information carried by colour alone —
status dots, severity, diff added/removed, chart series, required fields? Every
such signal needs a second channel (text, shape, pattern). Contrast is a
numeric threshold, so it belongs in non-functional requirements with the number
stated.

**5. Status and change announcements.** When something changes without the user
acting — a background job finishes, a count updates, a toast appears, a search
returns — how does a non-visual user learn about it? And equally: what must
*not* be announced, because a live counter that fires on every keystroke is
worse than silence.

**6. Forms and errors.** Is each error tied to the field it belongs to, stated
in text rather than colour, and reachable from where the user is now? After a
failed submit, where does focus go? Is anything validated only on blur, so a
keyboard user meets the error only after leaving the field?

**7. Motion and timing.** Anything auto-playing, auto-advancing, animating, or
expiring. Is there a way to stop or extend it? Does the interface respect a
reduced-motion preference? A session or a toast that disappears on a timer is a
requirement about time, so state the time.

**8. Target size and pointer alternatives.** Are interactive targets large
enough and far enough apart to hit reliably? Is any action available only
through a precise gesture (drag, pinch, long-press) with no simple alternative?

## Phrasing the findings

Most accessibility criteria land naturally in two EARS patterns:

- **State-driven** for anything that must hold while a condition lasts —
  focus containment, visible focus, an indicator that cannot be dismissed.
- **Unwanted behaviour** (`IF…THEN`) for what must happen when the
  accessible path is the one being used — a preference is set, a timer is about
  to expire, a submit fails.

Ubiquitous statements work for the invariants: "Every interactive control SHALL
have an accessible name that describes its action."

Contrast ratios, target sizes and timeouts are numbers — put them in
non-functional requirements, one testable statement each, rather than
scattering them through the acceptance criteria.

## What not to write

- A blanket "the feature SHALL be WCAG 2.2 AA compliant". It is not one
  criterion, nothing can be bound to it, and it lets every specific gap go
  unexamined. Name the specific requirements the feature actually raises.
- Requirements about markup, attributes, roles, or a component library's props.
- Requirements copied from a checklist that this feature does not raise. A
  read-only text panel does not need eight criteria; it may need one.
