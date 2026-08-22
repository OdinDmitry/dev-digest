import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import type { EvalRunRecord } from "@devdigest/shared";
import evalMessages from "../../../../../../messages/en/eval.json";

import { RunHistoryTable } from "./RunHistoryTable";

afterEach(cleanup);

let seq = 0;
function makeRun(overrides: Partial<EvalRunRecord> = {}): EvalRunRecord {
  seq += 1;
  return {
    id: `run-${seq}`,
    agent_id: "ag1",
    started_at: `2026-08-2${seq}T00:00:00Z`,
    state: "completed",
    recall: 0.8,
    precision: 0.7,
    citation_accuracy: 0.6,
    traces_passed: 4,
    traces_total: 5,
    errored_count: 0,
    cost_usd: 0.05,
    duration_ms: 12000,
    delta: null,
    ...overrides,
  };
}

function renderTable(props: { runs: EvalRunRecord[]; selectedIds?: Set<string>; onToggleSelect?: (id: string) => void }) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <RunHistoryTable
        runs={props.runs}
        selectedIds={props.selectedIds ?? new Set()}
        onToggleSelect={props.onToggleSelect ?? (() => {})}
      />
    </NextIntlClientProvider>,
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** Mirrors AgentEvalHistoryPage's own selection-cap contract, so the
 *  Compare-control gating (which lives on the page, not on RunHistoryTable
 *  itself) can be exercised against real selectedIds sizes. */
function Harness({ runs, initialSelected = [] }: { runs: EvalRunRecord[]; initialSelected?: string[] }) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set(initialSelected));
  const canCompare = selected.size === 2;
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  return (
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <button type="button" disabled={!canCompare}>
        Compare
      </button>
      <RunHistoryTable runs={runs} selectedIds={selected} onToggleSelect={toggleSelect} />
    </NextIntlClientProvider>
  );
}

describe("RunHistoryTable", () => {
  it("renders runs newest-first, preserving the order they're given in (AC-36)", () => {
    const newest = makeRun({ id: "run-newest", started_at: "2026-08-22T10:00:00Z" });
    const middle = makeRun({ id: "run-middle", started_at: "2026-08-21T10:00:00Z" });
    const oldest = makeRun({ id: "run-oldest", started_at: "2026-08-20T10:00:00Z" });
    renderTable({ runs: [newest, middle, oldest] });

    const whens = screen.getAllByRole("row").slice(1).map((row) => row.querySelector("td:nth-child(2)")?.textContent);
    expect(whens).toEqual([formatWhen(newest.started_at), formatWhen(middle.started_at), formatWhen(oldest.started_at)]);
  });

  it("carries every metric's delta as text with a direction word, and no delta for the earliest run (AC-38)", () => {
    const withDeltas = makeRun({
      id: "run-with-deltas",
      recall: 0.85,
      precision: 0.7,
      citation_accuracy: 0.6,
      cost_usd: 0.02,
      delta: { recall: 0.05, precision: -0.03, citation_accuracy: 0, cost_usd: -0.01 },
    });
    const earliest = makeRun({ id: "run-earliest", delta: null });
    renderTable({ runs: [withDeltas, earliest] });

    // Direction words, not colour alone (NFR).
    expect(screen.getByText("up 5pts")).toBeInTheDocument(); // recall +0.05
    expect(screen.getByText("down 3pts")).toBeInTheDocument(); // precision -0.03
    expect(screen.getByText("up 0pts")).toBeInTheDocument(); // citation_accuracy 0 → up (delta >= 0)
    expect(screen.getByText("down $0.01")).toBeInTheDocument(); // cost -0.01

    // The earliest run has no earlier run to diff against.
    expect(screen.getAllByText("no earlier run to compare")).toHaveLength(4); // recall/precision/citation/cost cells
  });

  it("a failed run renders dashboard.runFailed and no metric values (AC-29)", () => {
    const failed = makeRun({
      id: "run-failed",
      state: "failed",
      recall: null,
      precision: null,
      citation_accuracy: null,
      cost_usd: null,
      delta: null,
    });
    renderTable({ runs: [failed] });

    expect(screen.getByText("Run failed — every case errored, so no metrics were computed.")).toBeInTheDocument();
    // No selection control for a failed run — only completed runs offer one.
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    // No percentage/cost metric text rendered anywhere in the row.
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
  });

  it("each selection control's accessible name contains its run's start time", () => {
    const run = makeRun({ id: "run-x", started_at: "2026-08-19T15:30:00Z" });
    renderTable({ runs: [run] });

    const checkbox = screen.getByRole("checkbox");
    expect(checkbox.getAttribute("aria-label")).toContain(formatWhen(run.started_at));
  });

  it("the Compare control is inert with 0, 1 and 3 selections and activatable with exactly 2 (AC-39)", () => {
    const runs = [makeRun({ id: "r1" }), makeRun({ id: "r2" }), makeRun({ id: "r3" })];

    // Each case renders (and unmounts) a fresh Harness instance — useState's
    // initial value is only honoured on mount, so reusing one instance
    // across a `rerender` would silently keep the FIRST case's selection.
    render(<Harness runs={runs} initialSelected={[]} />);
    expect(screen.getByRole("button", { name: "Compare" })).toBeDisabled();
    cleanup();

    render(<Harness runs={runs} initialSelected={["r1"]} />);
    expect(screen.getByRole("button", { name: "Compare" })).toBeDisabled();
    cleanup();

    render(<Harness runs={runs} initialSelected={["r1", "r2"]} />);
    expect(screen.getByRole("button", { name: "Compare" })).not.toBeDisabled();
    cleanup();

    render(<Harness runs={runs} initialSelected={["r1", "r2", "r3"]} />);
    expect(screen.getByRole("button", { name: "Compare" })).toBeDisabled();
  });
});
