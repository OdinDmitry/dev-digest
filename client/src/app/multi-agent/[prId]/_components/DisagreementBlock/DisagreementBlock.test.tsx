import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Conflict } from "@devdigest/shared";
import runsMessages from "../../../../../../messages/en/runs.json";
import { DisagreementBlock } from "./DisagreementBlock";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: runsMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

/** Controlled wrapper — mirrors how the real page owns `onlyConflicts`
 *  (`?conflicts=1` in the URL) and re-renders DisagreementBlock on toggle. */
function Wrapper({ conflicts }: { conflicts: Conflict[] }) {
  const [onlyConflicts, setOnlyConflicts] = React.useState(false);
  return <DisagreementBlock conflicts={conflicts} onlyConflicts={onlyConflicts} onToggle={setOnlyConflicts} />;
}

const WEIRD_NOTE = 'Uses **raw** SQL <b>string concatenation</b> — see #123 for context.';

const CONFLICT_ROW: Conflict = {
  file: "src/db.ts",
  start_line: 42,
  end_line: 42,
  is_conflict: true,
  takes: [
    { agent_id: "a1", agent_name: "Security Reviewer", verdict: "CRITICAL", note: WEIRD_NOTE },
    { agent_id: "a2", agent_name: "Perf Reviewer", verdict: "ignored", note: null },
  ],
};

const AGREEMENT_ROW: Conflict = {
  file: "src/config.ts",
  start_line: 7,
  end_line: 7,
  is_conflict: false,
  takes: [
    { agent_id: "a1", agent_name: "Security Reviewer", verdict: "WARNING", note: "Same note from both" },
    { agent_id: "a2", agent_name: "Perf Reviewer", verdict: "WARNING", note: "Same note from both" },
  ],
};

describe("DisagreementBlock — take rendering (AC-19)", () => {
  it("a take with a severity renders that severity as text plus the note verbatim (markdown/HTML/# untouched)", () => {
    renderWithIntl(<DisagreementBlock conflicts={[CONFLICT_ROW]} onlyConflicts={false} onToggle={() => {}} />);

    expect(screen.getByText("Critical")).toBeInTheDocument();
    // Exact-string query: any truncation, markdown-stripping or reformatting
    // (e.g. dropping the `**`/`<b>` or treating `#123` as a heading) fails this.
    expect(screen.getByText(WEIRD_NOTE)).toBeInTheDocument();
  });

  it("an ignored take renders only \"did not flag\" — no severity, no note", () => {
    renderWithIntl(<DisagreementBlock conflicts={[CONFLICT_ROW]} onlyConflicts={false} onToggle={() => {}} />);

    expect(screen.getByText("did not flag")).toBeInTheDocument();
    // The ignored take's agent name is present, but Ignored gets no severity
    // word rendered as a distinct node the way the flagging take does.
    expect(screen.queryByText("Ignored")).not.toBeInTheDocument();
  });
});

describe("DisagreementBlock — only-conflicts filter (AC-22)", () => {
  it("the filter is off on first render, and every row is present", () => {
    renderWithIntl(<Wrapper conflicts={[CONFLICT_ROW, AGREEMENT_ROW]} />);

    expect(screen.getByRole("checkbox", { name: "Show only conflicts" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("src/db.ts:42")).toBeInTheDocument();
    expect(screen.getByText("src/config.ts:7")).toBeInTheDocument();
  });

  it("turning it on hides rows whose is_conflict is false and keeps the rest", () => {
    renderWithIntl(<Wrapper conflicts={[CONFLICT_ROW, AGREEMENT_ROW]} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Show only conflicts" }));

    expect(screen.getByText("src/db.ts:42")).toBeInTheDocument(); // is_conflict: true — kept
    expect(screen.queryByText("src/config.ts:7")).not.toBeInTheDocument(); // is_conflict: false — hidden
  });
});

describe("DisagreementBlock — toggle accessibility", () => {
  it("the toggle exposes its checked state via aria-checked and updates it after activation", () => {
    renderWithIntl(<Wrapper conflicts={[CONFLICT_ROW, AGREEMENT_ROW]} />);

    const toggle = screen.getByRole("checkbox", { name: "Show only conflicts" });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("every row control is reachable by keyboard — the toggle is a native, focusable button", () => {
    renderWithIntl(<Wrapper conflicts={[CONFLICT_ROW, AGREEMENT_ROW]} />);

    const toggle = screen.getByRole("checkbox", { name: "Show only conflicts" });
    // Real <button> elements are in the default tab order without any extra
    // tabIndex wiring — confirm this one actually receives focus.
    toggle.focus();
    expect(document.activeElement).toBe(toggle);
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle).not.toHaveAttribute("tabindex", "-1");
  });
});
