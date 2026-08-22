/* use-focus-trap.ts — confines keyboard focus to a dialog's subtree while it
   is open (SPEC-03 AC-43/AC-44). Used by both eval dialogs (compare-runs
   modal, case editor) — nothing else in the app needs it yet. */
"use client";

import React from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/** Confines Tab/Shift-Tab to `ref`'s subtree while `active`, focuses the first
 *  focusable node on open, closes on Escape, and restores focus to
 *  `document.activeElement` as it was at open time when `active` goes false. */
export function useFocusTrap(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  onClose: () => void,
): void {
  // Keep the latest onClose in a ref so the effect below only has to depend
  // on `active` — an inline `onClose` recreated every render must NOT
  // re-run the open/focus/listener setup on every render (react-best-practices:
  // an effect syncing an external system, not derived state).
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  const previouslyFocused = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!active) return;

    previouslyFocused.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const container = ref.current;
    if (container) {
      const [first] = getFocusable(container);
      (first ?? container).focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;

      const node = ref.current;
      if (!node) return;
      const focusable = getFocusable(node);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        e.preventDefault();
        return;
      }
      const current = document.activeElement;
      const insideTrap = current instanceof Node && node.contains(current);

      if (e.shiftKey) {
        if (!insideTrap || current === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (!insideTrap || current === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused.current?.focus();
    };
  }, [active, ref]);
}
