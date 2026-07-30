import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import type { FindingRecord } from "@devdigest/shared";
import { SeverityCounts } from "./SeverityCounts";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded secret",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A secret is committed.",
  suggestion: null,
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

describe("SeverityCounts", () => {
  it("renders only the non-zero severity badges", () => {
    render(<SeverityCounts counts={{ critical: 3, warning: 0, suggestion: 2 }} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("renders a dash when there are no findings at all", () => {
    render(<SeverityCounts counts={{ critical: 0, warning: 0, suggestion: 0 }} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("clicking a severity calls onSelect with that key", () => {
    const onSelect = vi.fn();
    render(
      <SeverityCounts counts={{ critical: 1, warning: 2, suggestion: 0 }} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByText("2").closest("button")!);
    expect(onSelect).toHaveBeenCalledWith("warning");
  });

  it("with no onSelect, badges render as non-interactive (disabled) buttons", () => {
    render(<SeverityCounts counts={{ critical: 1, warning: 0, suggestion: 0 }} />);
    expect(screen.getByText("1").closest("button")).toBeDisabled();
  });

  it("hover shows the popup with the passed findings; no hover, no popup", () => {
    const { container } = render(
      <SeverityCounts
        counts={{ critical: 1, warning: 0, suggestion: 0 }}
        popupFindings={[FINDING]}
      />,
    );
    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();
    fireEvent.mouseEnter(container.firstChild as Element);
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("popup shows a header with the singular/plural finding count, plus an optional heading suffix", () => {
    const { container } = render(
      <SeverityCounts
        counts={{ critical: 1, warning: 0, suggestion: 0 }}
        popupFindings={[FINDING]}
        popupHeading="in this run"
      />,
    );
    fireEvent.mouseEnter(container.firstChild as Element);
    expect(screen.getByText("1 FINDING in this run")).toBeInTheDocument();
  });

  it("the last popup item has no trailing divider, earlier items do", () => {
    const second: FindingRecord = { ...FINDING, id: "f2", title: "Second finding" };
    const { container } = render(
      <SeverityCounts
        counts={{ critical: 2, warning: 0, suggestion: 0 }}
        popupFindings={[FINDING, second]}
      />,
    );
    fireEvent.mouseEnter(container.firstChild as Element);
    const firstItem = screen.getByText("Hardcoded secret").closest("div")!.parentElement!;
    const lastItem = screen.getByText("Second finding").closest("div")!.parentElement!;
    expect(firstItem.getAttribute("style")).toContain("border-bottom: 1px solid");
    expect(lastItem.getAttribute("style")).not.toContain("border-bottom");
  });

  it("hover fires onHoverChange so the caller can lazily fetch popup data (close is debounced)", () => {
    vi.useFakeTimers();
    const onHoverChange = vi.fn();
    const { container } = render(
      <SeverityCounts counts={{ critical: 1, warning: 0, suggestion: 0 }} onHoverChange={onHoverChange} />,
    );
    const root = container.firstChild as Element;
    fireEvent.mouseEnter(root);
    expect(onHoverChange).toHaveBeenCalledWith(true);
    fireEvent.mouseLeave(root);
    expect(onHoverChange).not.toHaveBeenCalledWith(false); // not instant
    act(() => { vi.advanceTimersByTime(200); });
    expect(onHoverChange).toHaveBeenCalledWith(false);
  });

  it("moving the mouse from the trigger to the portaled popup within the debounce window keeps it open (no flicker-close)", () => {
    vi.useFakeTimers();
    const { container } = render(
      <SeverityCounts counts={{ critical: 1, warning: 0, suggestion: 0 }} popupFindings={[FINDING]} />,
    );
    const root = container.firstChild as Element;
    fireEvent.mouseEnter(root);
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();

    // Leave the trigger, then (within the debounce window) enter the popup —
    // the pending close must be cancelled, not fired.
    fireEvent.mouseLeave(root);
    const popupRoot = screen.getByText("Hardcoded secret").closest("div")!.parentElement!.parentElement!.parentElement!;
    fireEvent.mouseEnter(popupRoot);
    act(() => { vi.advanceTimersByTime(200); });

    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows a loading state in the popup while popupLoading is true", () => {
    const { container } = render(
      <SeverityCounts counts={{ critical: 1, warning: 0, suggestion: 0 }} popupLoading />,
    );
    fireEvent.mouseEnter(container.firstChild as Element);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });
});
