import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { FindingCard } from "./FindingCard";

afterEach(cleanup);

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });

  it("finding_card_offers_the_eval_case_action", () => {
    // AC-42: the control is disabled on an undecided finding, so this needs a
    // decided one — both directions of the decision offer it.
    const acceptedFinding: FindingRecord = { ...FINDING, accepted_at: "2026-08-20T10:00:00.000Z" };
    const onCreateEvalCase = vi.fn();
    const { unmount } = renderWithIntl(
      <FindingCard
        f={acceptedFinding}
        defaultExpanded
        onAction={() => {}}
        onCreateEvalCase={onCreateEvalCase}
      />,
    );
    const acceptedAction = screen.getByRole("button", { name: "Turn into eval case" });
    expect(acceptedAction).toBeEnabled();
    fireEvent.click(acceptedAction);
    expect(onCreateEvalCase).toHaveBeenCalledTimes(1);
    unmount();

    const dismissedFinding: FindingRecord = { ...FINDING, dismissed_at: "2026-08-20T10:00:00.000Z" };
    const onCreateEvalCase2 = vi.fn();
    renderWithIntl(
      <FindingCard
        f={dismissedFinding}
        defaultExpanded
        onAction={() => {}}
        onCreateEvalCase={onCreateEvalCase2}
      />,
    );
    const dismissedAction = screen.getByRole("button", { name: "Turn into eval case" });
    expect(dismissedAction).toBeEnabled();
    fireEvent.click(dismissedAction);
    expect(onCreateEvalCase2).toHaveBeenCalledTimes(1);
  });

  it("finding_card_eval_action_unavailable_without_a_decision", () => {
    // AC-42: a finding with neither an accepted nor a dismissed decision
    // renders the control disabled, states why, and never calls the handler.
    const onCreateEvalCase = vi.fn();
    renderWithIntl(
      <FindingCard f={FINDING} defaultExpanded onAction={() => {}} onCreateEvalCase={onCreateEvalCase} />,
    );
    const action = screen.getByRole("button", { name: "Turn into eval case" });
    expect(action).toBeDisabled();
    expect(
      screen.getByText("Accept or dismiss this finding first to turn it into an eval case."),
    ).toBeInTheDocument();
    fireEvent.click(action);
    expect(onCreateEvalCase).not.toHaveBeenCalled();
  });

  it("does not render the eval-case action when no handler is supplied", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={() => {}} />);
    expect(screen.queryByRole("button", { name: "Turn into eval case" })).not.toBeInTheDocument();
  });
});
