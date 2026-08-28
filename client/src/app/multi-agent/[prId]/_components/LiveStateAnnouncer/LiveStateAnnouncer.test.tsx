import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentColumn } from "@devdigest/shared";
import runsMessages from "../../../../../../messages/en/runs.json";
import { LiveStateAnnouncer } from "./LiveStateAnnouncer";

afterEach(cleanup);

function column(overrides: Partial<AgentColumn> = {}): AgentColumn {
  return {
    run_id: "run-1",
    agent_id: "agent-1",
    agent_name: "Security",
    agent_description: null,
    provider: "anthropic",
    model: "claude",
    status: "running",
    verdict: null,
    score: null,
    summary: null,
    duration_ms: null,
    cost_usd: null,
    error: null,
    findings: [],
    ...overrides,
  };
}

function Scene({ columns }: { columns: AgentColumn[] }) {
  return (
    <NextIntlClientProvider locale="en" messages={{ runs: runsMessages }}>
      <button type="button">A control elsewhere on the page</button>
      <LiveStateAnnouncer columns={columns} />
    </NextIntlClientProvider>
  );
}

describe("LiveStateAnnouncer — announces a status change without moving focus (AC-23)", () => {
  it("names the agent and its new state in the live region, and leaves focus on the SAME node it was on before the rerender", () => {
    const { rerender } = render(<Scene columns={[column({ status: "running" })]} />);

    const control = screen.getByRole("button", { name: "A control elsewhere on the page" });
    control.focus();
    expect(document.activeElement).toBe(control);

    // No announcement yet — this is the FIRST time this run_id's status was
    // observed, not a change.
    const liveRegion = document.querySelector('[aria-live="polite"]')!;
    expect(liveRegion.textContent).toBe("");

    rerender(<Scene columns={[column({ status: "done" })]} />);

    expect(liveRegion.textContent).toBe("Security is now Done");

    // Same DOM node, not merely "still focused on a button with the same
    // text" — proves the rerender didn't remount/replace it.
    expect(document.activeElement).toBe(control);
  });
});
