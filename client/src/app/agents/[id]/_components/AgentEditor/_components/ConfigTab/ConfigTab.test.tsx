import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import agentMessages from "../../../../../../../../messages/en/agents.json";
// The CI-threshold re-export notice's copy lives in ci.json, not agents.json
// (ConfigTab calls a second `useTranslations("ci")` — same cross-namespace-tab
// shape as CiTab itself, client/insights.md Codebase Patterns 2026-08-16).
import ciMessages from "../../../../../../../../messages/en/ci.json";

vi.mock("../../../../../../../lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
  useProviderModels: () => ({ data: [{ id: "gpt-4.1", provider: "openai" }] }),
}));

import { ToastProvider } from "../../../../../../../lib/toast";
import { ConfigTab } from "./ConfigTab";

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: agentMessages, ci: ciMessages }}>
      <ToastProvider>
        <ConfigTab agent={AGENT} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

/** The CI-gate `<select>` — SelectInput renders no `<label htmlFor>` /
 *  `id` pairing (vendor/ui/kit/SelectInput.tsx), so it isn't reachable via
 *  getByLabelText; found instead by its own option text among the several
 *  comboboxes ConfigTab renders (provider, strategy, ci gate, output schema). */
function ciGateSelect(): HTMLElement {
  const select = screen
    .getAllByRole("combobox")
    .find((el) => within(el).queryByText("Block on critical (recommended)"));
  if (!select) throw new Error("CI gate select not found");
  return select;
}

afterEach(cleanup);

describe("ConfigTab — CI-threshold re-export notice (AC-10)", () => {
  it("is absent before any change, and renders once the CI gate value diverges from the saved one", () => {
    renderTab();

    expect(
      screen.queryByText("This change reaches CI only after the agent is exported to that repository again."),
    ).not.toBeInTheDocument();

    fireEvent.change(ciGateSelect(), { target: { value: "warning" } });

    expect(
      screen.getByText("This change reaches CI only after the agent is exported to that repository again."),
    ).toBeInTheDocument();
  });

  it("is absent again once the value is changed back to the agent's saved threshold", () => {
    renderTab();

    fireEvent.change(ciGateSelect(), { target: { value: "warning" } });
    expect(
      screen.getByText("This change reaches CI only after the agent is exported to that repository again."),
    ).toBeInTheDocument();

    fireEvent.change(ciGateSelect(), { target: { value: "critical" } });
    expect(
      screen.queryByText("This change reaches CI only after the agent is exported to that repository again."),
    ).not.toBeInTheDocument();
  });
});
