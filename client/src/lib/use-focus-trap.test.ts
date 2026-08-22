/* use-focus-trap.test.ts — SPEC-03 AC-43/AC-44. Plain `.ts` (not `.tsx`, per
   the handoff's named path) so the harness component is built with
   `React.createElement` rather than JSX. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import React from "react";
import { useFocusTrap } from "./use-focus-trap";

afterEach(cleanup);

function Harness({ active, onClose }: { active: boolean; onClose: () => void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  useFocusTrap(ref, active, onClose);
  return React.createElement(
    "div",
    null,
    React.createElement("button", { "data-testid": "opener" }, "Opener"),
    React.createElement(
      "div",
      { ref, "data-testid": "trap" },
      React.createElement("button", { "data-testid": "first" }, "First"),
      React.createElement("button", { "data-testid": "second" }, "Second"),
      React.createElement("button", { "data-testid": "last" }, "Last"),
    ),
    React.createElement("button", { "data-testid": "after" }, "After"),
  );
}

function harness(props: { active: boolean; onClose: () => void }) {
  return React.createElement(Harness, props);
}

describe("useFocusTrap", () => {
  it("wraps Tab from the last focusable node to the first while active", () => {
    render(harness({ active: true, onClose: vi.fn() }));
    screen.getByTestId("last").focus();
    expect(document.activeElement).toBe(screen.getByTestId("last"));

    fireEvent.keyDown(document, { key: "Tab" });

    expect(document.activeElement).toBe(screen.getByTestId("first"));
  });

  it("wraps Shift-Tab from the first focusable node to the last while active", () => {
    render(harness({ active: true, onClose: vi.fn() }));
    // Opening the trap moves focus to the first focusable node automatically.
    expect(document.activeElement).toBe(screen.getByTestId("first"));

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });

    expect(document.activeElement).toBe(screen.getByTestId("last"));
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(harness({ active: true, onClose }));

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores focus to the element that was active at open time once active goes false", () => {
    const onClose = vi.fn();
    const { rerender } = render(harness({ active: false, onClose }));

    const opener = screen.getByTestId("opener");
    opener.focus();
    expect(document.activeElement).toBe(opener);

    rerender(harness({ active: true, onClose }));
    // The trap steals focus into its own subtree while open.
    expect(document.activeElement).toBe(screen.getByTestId("first"));

    rerender(harness({ active: false, onClose }));
    expect(document.activeElement).toBe(opener);
  });
});
