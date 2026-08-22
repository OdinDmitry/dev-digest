"use client";

import React from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Local focus trap + focus restore + Escape-to-close for the comparison
 * dialog. `Modal` (`vendor/ui/kit/Modal.tsx:26-27`) provides none of the
 * three — it has five other callers and its own tests, so this is added here
 * rather than widening the shared primitive for one caller's NFR (Placement
 * decision 13).
 *
 * `anchorRef` is any element INSIDE the dialog's children (this component's
 * own padded wrapper) — the trap resolves `.closest('[role="dialog"]')` from
 * it to reach `Modal`'s own root, so the header's Close (X) button is part of
 * the trapped tab order too, not just this component's own content.
 */
export function useFocusTrap(anchorRef: React.RefObject<HTMLElement | null>, onClose: () => void) {
  React.useEffect(() => {
    const dialog = anchorRef.current?.closest<HTMLElement>('[role="dialog"]');
    if (!dialog) return;

    const opener = document.activeElement as HTMLElement | null;

    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    focusables()[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const nodes = focusables();
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      opener?.focus();
    };
    // Runs once for the dialog's lifetime — `onClose` is stable enough for a
    // mount/unmount effect (the dialog itself unmounts to close).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
