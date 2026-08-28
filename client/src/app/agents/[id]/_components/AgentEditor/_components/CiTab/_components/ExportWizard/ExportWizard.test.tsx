import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent, CiExport, CiExportPreview, CiWorkflowValidation, Repo } from "@devdigest/shared";
import ciMessages from "../../../../../../../../../../messages/en/ci.json";
import commonMessages from "../../../../../../../../../../messages/en/common.json";

// Only "@/lib/api" is mocked (no `@testing-library/user-event` — it's not an
// installed dependency in this package, client/insights.md Tool & Library
// Notes 2026-08-08 — `fireEvent` is this suite's convention instead). The
// wizard's own reducer/effects (which file is auto-selected, when preview
// re-fires, what each Continue press validates) are the behavior under test,
// so the hooks are exercised for real against a stubbed transport.
const get = vi.fn();
const post = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    get: (p: string) => get(p),
    post: (p: string, body?: unknown) => post(p, body),
    put: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class extends Error {},
  API_BASE: "http://localhost:3001",
}));

import { ExportWizard } from "./ExportWizard";

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

const REPO: Repo = {
  id: "repo1",
  workspace_id: "ws1",
  owner: "acme",
  name: "payments-api",
  full_name: "acme/payments-api",
  default_branch: "main",
  clone_path: null,
  last_polled_at: null,
  created_by: null,
};

const WORKFLOW_PATH = ".github/workflows/devdigest-review.yml";
const MANIFEST_PATH = ".devdigest/agents/security-reviewer.yml";

const PREVIEW: CiExportPreview = {
  files: [
    { path: WORKFLOW_PATH, contents: "name: DevDigest Review\non: pull_request\n", editable: true },
    { path: MANIFEST_PATH, contents: "name: Security Reviewer\nmodel: gpt-4.1\n", editable: false },
  ],
  workflow_version: "1",
  expected_secrets: [
    { key: "OPENAI_API_KEY", provided_by_platform: false },
    { key: "GITHUB_TOKEN", provided_by_platform: true },
  ],
  repo: "acme/payments-api",
  base: "main",
  ci_fail_on: "critical",
  skill_count: 2,
};

const INSTALL_RESULT: CiExport = {
  installation: {
    id: "inst1",
    agent_id: "ag1",
    agent_name: "Security Reviewer",
    repo: "acme/payments-api",
    target_type: "gha",
    installed_at: "2026-08-28T00:00:00Z",
    updated_at: "2026-08-28T00:00:00Z",
    workflow_version: "1",
    pr_url: "https://github.com/acme/payments-api/pull/99",
    ci_fail_on: "critical",
    current: true,
  },
  files: PREVIEW.files,
  pr_url: "https://github.com/acme/payments-api/pull/99",
};

type MockApiOpts = {
  validate?: (body: { contents: string }) => CiWorkflowValidation;
  install?: (body: unknown) => Promise<CiExport>;
};

function mockApi(opts: MockApiOpts = {}) {
  get.mockImplementation((path: string) => {
    if (path === "/repos") return Promise.resolve([REPO]);
    throw new Error(`unexpected GET ${path}`);
  });
  post.mockImplementation((path: string, body?: unknown) => {
    if (path === "/agents/ag1/ci-export/preview") return Promise.resolve(PREVIEW);
    if (path === "/ci/workflow/validate") {
      const result: CiWorkflowValidation = opts.validate
        ? opts.validate(body as { contents: string })
        : { valid: true, error: null };
      return Promise.resolve(result);
    }
    if (path === "/agents/ag1/ci-export/install") {
      return opts.install ? opts.install(body) : Promise.resolve(INSTALL_RESULT);
    }
    throw new Error(`unexpected POST ${path}`);
  });
}

function renderWizard(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ ci: ciMessages, common: commonMessages }}>
        <ExportWizard agent={AGENT} initialStep={0} onClose={onClose} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return onClose;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function selectRepo() {
  await waitFor(() => expect(screen.getByRole("option", { name: "acme/payments-api" })).toBeInTheDocument());
  fireEvent.click(screen.getByRole("option", { name: "acme/payments-api" }));
}

/** Waits for the preview MUTATION to actually resolve, not just for the step
 *  to mount — the "FILES TO CREATE" heading renders immediately on entering
 *  step 1, before `preview.data` arrives, so it's not a reliable "loaded"
 *  signal. The manifest file's path is a safe one to wait on: it only
 *  renders once `preview.data` exists, and — unlike the workflow file's path
 *  — it is never ALSO echoed in the contents-pane header (that file isn't
 *  auto-selected), so it never matches more than once. */
async function waitForPreviewLoaded() {
  await screen.findByText(MANIFEST_PATH);
}

/** The file-list row button for `path` — as opposed to the (possibly
 *  duplicate) mention of the same path in the contents-pane header when that
 *  file is the selected one. */
function fileRow(path: string): HTMLElement {
  const row = screen.getAllByText(path).map((el) => el.closest("button")).find((b): b is HTMLButtonElement => !!b);
  if (!row) throw new Error(`no file-list row button found for ${path}`);
  return row;
}

/** Drives the wizard from step 0 through to step 2 (configure) with no
 *  workflow edit, so tests that only care about step 2/3 behavior don't have
 *  to re-derive the target/preview transition themselves. */
async function advanceToConfigureStep() {
  await selectRepo();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitForPreviewLoaded();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByText("Trigger");
}

describe("ExportWizard — target step (AC-19)", () => {
  it("disables Continue until a repository is chosen, then enables it", async () => {
    mockApi();
    renderWizard();

    await waitFor(() => expect(screen.getByRole("option", { name: "acme/payments-api" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();

    fireEvent.click(screen.getByRole("option", { name: "acme/payments-api" }));

    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });
});

describe("ExportWizard — preview step (AC-2)", () => {
  it("renders one entry per generated file with only the workflow marked editable", async () => {
    mockApi();
    renderWizard();
    await selectRepo();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitForPreviewLoaded();

    const workflowRow = fileRow(WORKFLOW_PATH);
    const manifestRow = fileRow(MANIFEST_PATH);
    // Only the workflow row carries the "editable" tag; the manifest row
    // never does. (The workflow file is also auto-selected on entry, so its
    // "editable" tag is echoed a second time in the contents-pane header —
    // that second copy is asserted on its own in the AC-3/AC-22 test below,
    // not re-counted here.)
    expect(workflowRow.textContent).toContain("editable");
    expect(manifestRow.textContent).not.toContain("editable");
  });
});

describe("ExportWizard — workflow edit + validation gate (AC-3, AC-22)", () => {
  it("an invalid edit keeps the step, shows the reason inside the workflow pane, and calls no install — a valid retry then advances and Install posts the edited contents", async () => {
    mockApi({
      validate: (body) =>
        body.contents.includes("BROKEN") ? { valid: false, error: "bad yaml" } : { valid: true, error: null },
    });
    renderWizard();
    await selectRepo();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitForPreviewLoaded();

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "BROKEN CONTENTS" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const invalidAlert = await screen.findByRole("alert");
    expect(invalidAlert.textContent).toContain("This workflow is not valid:");
    expect(invalidAlert.textContent).toContain("bad yaml");
    // Inside the same contents pane as the textarea, not the file list.
    expect(textarea.parentElement).toContainElement(invalidAlert);
    // Still on the preview step.
    expect(screen.getByText("FILES TO CREATE")).toBeInTheDocument();
    expect(post.mock.calls.some(([p]) => String(p).includes("ci-export/install"))).toBe(false);

    fireEvent.change(textarea, { target: { value: "GOOD CONTENTS" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await screen.findByText("Trigger"); // advanced to the configure step
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("button", { name: "Install" });
    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/agents/ag1/ci-export/install",
        expect.objectContaining({ workflow_contents: "GOOD CONTENTS" }),
      ),
    );
  });
});

describe("ExportWizard — configure step triggers (AC-20)", () => {
  it("toggles each trigger independently and disables Continue with a reason once none are selected", async () => {
    mockApi();
    renderWizard();
    await advanceToConfigureStep();

    const opened = screen.getByRole("checkbox", { name: /Pull request opened/ });
    const synchronize = screen.getByRole("checkbox", { name: /New commits pushed/ });
    const reopened = screen.getByRole("checkbox", { name: /Pull request reopened/ });
    // Defaults: opened + synchronize checked, reopened not.
    expect(opened).toBeChecked();
    expect(synchronize).toBeChecked();
    expect(reopened).not.toBeChecked();

    fireEvent.click(reopened);
    expect(reopened).toBeChecked();
    // Toggling reopened does not touch the other two.
    expect(opened).toBeChecked();
    expect(synchronize).toBeChecked();

    fireEvent.click(opened);
    fireEvent.click(synchronize);
    expect(opened).not.toBeChecked();
    expect(synchronize).not.toBeChecked();
    expect(reopened).toBeChecked();

    fireEvent.click(reopened);

    expect(screen.getByText("Select at least one trigger to continue.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });
});

describe("ExportWizard — secrets readiness (AC-4)", () => {
  it("renders both expected secrets with distinct readiness words, no value and no colour-only cue", async () => {
    mockApi();
    renderWizard();
    await advanceToConfigureStep();

    expect(screen.getByText("OPENAI_API_KEY")).toBeInTheDocument();
    expect(screen.getByText("GITHUB_TOKEN")).toBeInTheDocument();
    // Distinct words, not a shared/ambiguous label — and no secret VALUE is
    // ever rendered (the contract carries no value field to leak).
    expect(screen.getByText("you must add this")).toBeInTheDocument();
    expect(screen.getByText("provided by Actions")).toBeInTheDocument();
  });
});

describe("ExportWizard — install (AC-7)", () => {
  it("a successful install renders the returned pull-request link", async () => {
    mockApi();
    renderWizard();
    await advanceToConfigureStep();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("button", { name: "Install" });

    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    const link = await screen.findByRole("link", { name: /View pull request/ });
    expect(link).toHaveAttribute("href", INSTALL_RESULT.pr_url);
  });

  it("an install failure renders in the alert region without moving focus off the step container", async () => {
    mockApi({ install: () => Promise.reject(new Error("network down")) });
    renderWizard();
    await advanceToConfigureStep();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("button", { name: "Install" });

    const stepContainer = document.querySelector('[tabindex="-1"]');
    const activeBefore = document.activeElement;

    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not open the pull request:");
    expect(alert.textContent).toContain("network down");
    expect(document.querySelector('[tabindex="-1"]')).toBe(stepContainer);
    expect(document.activeElement).toBe(activeBefore);
  });
});

describe("ExportWizard — focus trap (AC-17, AC-18)", () => {
  it("puts document.activeElement on the new step's container after a transition", async () => {
    mockApi();
    renderWizard();
    await selectRepo();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitForPreviewLoaded();

    const container = document.querySelector('[tabindex="-1"]');
    expect(container).not.toBeNull();
    expect(document.activeElement).toBe(container);
    expect(container?.textContent).toContain("FILES TO CREATE");
  });

  it("Tab from the last focusable element wraps to the first (Close), and Escape closes", async () => {
    const onClose = vi.fn();
    mockApi();
    renderWizard(onClose);
    await selectRepo();

    const closeButton = screen.getByRole("button", { name: "Close" });
    const continueButton = screen.getByRole("button", { name: "Continue" });
    expect(continueButton).toBeEnabled();

    continueButton.focus();
    expect(document.activeElement).toBe(continueButton);

    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(closeButton);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ExportWizard — an edit survives navigating back and forward (AC-19 adjacent)", () => {
  it("keeps the edited workflow contents after Back to target then Continue back to preview", async () => {
    mockApi();
    renderWizard();
    await selectRepo();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitForPreviewLoaded();

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "EDITED CONTENTS" } });
    expect(textarea).toHaveValue("EDITED CONTENTS");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByText("Target repository");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitForPreviewLoaded();

    expect(screen.getByRole("textbox")).toHaveValue("EDITED CONTENTS");
  });
});
