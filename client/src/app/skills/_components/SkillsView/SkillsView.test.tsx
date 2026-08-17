import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Skill, SkillListStats, SkillVersion } from "@devdigest/shared";
import skillMessages from "../../../../../messages/en/skills.json";
import shellMessages from "../../../../../messages/en/shell.json";
// SkillDetail's Context tab (`ContextAttachPanel`) calls `useTranslations("context")`
// unconditionally, even though this suite never selects that tab — without
// this the `NextIntlClientProvider` below throws a MISSING_MESSAGE error to
// stderr on every render (client/insights.md 2026-08-16).
import contextMessages from "../../../../../messages/en/context.json";
import { ToastProvider } from "../../../../lib/toast";

const get = vi.fn();
vi.mock("../../../../lib/api", () => ({
  api: { get: (p: string) => get(p), post: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
}));

// The shell pulls in repo/theme context and nav chrome that this test does not
// exercise; render only the page body.
vi.mock("../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { SkillsView } from "./SkillsView";

const SKILLS: Skill[] = [
  {
    id: "s1",
    name: "test-coverage-rubric",
    description: "Use when a diff adds or changes tests.",
    type: "rubric",
    source: "manual",
    body: "## test-coverage-rubric\n\nEnumerate every branch.",
    enabled: true,
    version: 2,
    evidence_files: null,
  },
  {
    id: "s2",
    name: "flake-radar",
    description: "Use when tests touch time or ordering.",
    type: "custom",
    source: "imported_url",
    body: "## flake-radar\n\nLook for non-determinism.",
    enabled: false,
    version: 1,
    evidence_files: ["README.md"],
  },
];

const STATS: SkillListStats[] = [
  { skill_id: "s1", agent_count: 3 },
  { skill_id: "s2", agent_count: 0 },
];

const VERSIONS: SkillVersion[] = [
  { skill_id: "s1", version: 2, note: "Tightened the rubric", created_at: "2026-05-30T00:00:00Z", lines_added: 4, lines_removed: 1 },
  { skill_id: "s1", version: 1, note: null, created_at: "2026-03-02T00:00:00Z", lines_added: 5, lines_removed: 0 },
];

// The mocked router mutates this module-level URLSearchParams directly rather
// than driving real Next.js navigation, so — like the app itself would need a
// re-render from a new page load — tests that act on a `replace()` call must
// force one (`cleanup()` + `renderView()`) to observe it; nothing here
// triggers a React re-render on its own.
let params: URLSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: (url: string) => {
      params = new URL(url, "http://x").searchParams;
    },
    push: vi.fn(),
  }),
  useSearchParams: () => params,
}));

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider
        locale="en"
        messages={{ skills: skillMessages, shell: shellMessages, context: contextMessages }}
      >
        <ToastProvider>
          <SkillsView />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

/** Simulate the URL update from a click actually taking effect on screen. */
function renderAfterNavigation() {
  cleanup();
  renderView();
}

beforeEach(() => {
  params = new URLSearchParams();
  get.mockImplementation((path: string) => {
    if (path === "/skills") return Promise.resolve(SKILLS);
    if (path === "/skills/stats") return Promise.resolve(STATS);
    if (path === "/skills/s1/versions") return Promise.resolve(VERSIONS);
    throw new Error(`unexpected GET ${path}`);
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SkillsView", () => {
  it("lists each skill in the rail with its type, source and agent count", async () => {
    renderView();
    await waitFor(() => expect(screen.getByText("test-coverage-rubric")).toBeInTheDocument());

    expect(screen.getByText("flake-radar")).toBeInTheDocument();
    expect(screen.getByText("Use when a diff adds or changes tests.")).toBeInTheDocument();
    expect(screen.getByText("rubric")).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
    expect(screen.getByText("Imported")).toBeInTheDocument();
    expect(screen.getByText("3 agents")).toBeInTheDocument();
    // Only the imported skill carries the vetting badge.
    expect(screen.getAllByText("needs vetting")).toHaveLength(1);
  });

  it("filters by name, description and type", async () => {
    renderView();
    await waitFor(() => expect(screen.getByText("flake-radar")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Search skills…"), { target: { value: "flake" } });
    expect(screen.queryByText("test-coverage-rubric")).not.toBeInTheDocument();
    expect(screen.getByText("flake-radar")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search skills…"), { target: { value: "zzz" } });
    expect(screen.getByText("No matching skills")).toBeInTheDocument();
  });

  it("selecting a skill shows its Config tab by default, with a live form", async () => {
    renderView();
    await waitFor(() => expect(screen.getByText("test-coverage-rubric")).toBeInTheDocument());

    // Nothing selected yet — the "pick a skill" prompt, not a form.
    expect(screen.getByText("Select a skill")).toBeInTheDocument();

    fireEvent.click(screen.getByText("test-coverage-rubric"));
    expect(params.get("id")).toBe("s1");

    renderAfterNavigation();
    await waitFor(() => expect(screen.getByText("Configuration")).toBeInTheDocument());
    // The version badge appears twice by design — once in the page header,
    // once in the Config tab's own header row.
    expect(screen.getAllByText("v2")).toHaveLength(2);
    expect(screen.getByDisplayValue("test-coverage-rubric")).toBeInTheDocument();
  });

  it("keeps the selection when a filter drops the selected item from the rail", async () => {
    renderView();
    await waitFor(() => expect(screen.getByText("flake-radar")).toBeInTheDocument());
    fireEvent.click(screen.getByText("test-coverage-rubric"));
    renderAfterNavigation();
    await waitFor(() => expect(screen.getByText("Configuration")).toBeInTheDocument());
    // Rail row + detail-pane header title both render the name before filtering.
    expect(screen.getAllByText("test-coverage-rubric")).toHaveLength(2);

    fireEvent.change(screen.getByLabelText("Search skills…"), { target: { value: "flake" } });
    // Only the detail-pane header remains — the rail row is filtered out.
    expect(screen.getAllByText("test-coverage-rubric")).toHaveLength(1);
    expect(screen.getByDisplayValue("test-coverage-rubric")).toBeInTheDocument(); // still in the detail form
  });

  it("switches to the Preview tab and renders the body as markdown", async () => {
    renderView();
    fireEvent.click(await screen.findByText("test-coverage-rubric"));
    renderAfterNavigation();
    await waitFor(() => expect(screen.getByText("Configuration")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(params.get("tab")).toBe("preview");

    renderAfterNavigation();
    await waitFor(() => expect(screen.getByText("Enumerate every branch.")).toBeInTheDocument());
  });

  it("switches to the Versions tab and lists version history newest first", async () => {
    renderView();
    fireEvent.click(await screen.findByText("test-coverage-rubric"));
    renderAfterNavigation();
    await waitFor(() => expect(screen.getByText("Configuration")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Versions" }));
    renderAfterNavigation();

    await waitFor(() => expect(screen.getByText("Version history")).toBeInTheDocument());
    expect(screen.getByText("Tightened the rubric")).toBeInTheDocument();
    expect(screen.getByText("Initial version")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
  });

  it("shows the full empty state (with an import CTA), not a duplicated message in the rail", async () => {
    get.mockImplementation((path: string) => {
      if (path === "/skills") return Promise.resolve([]);
      if (path === "/skills/stats") return Promise.resolve([]);
      throw new Error(`unexpected GET ${path}`);
    });
    renderView();
    await waitFor(() => expect(screen.getByText("No skills yet")).toBeInTheDocument());
    expect(screen.getAllByText("No skills yet")).toHaveLength(1);
    expect(screen.getByText("Import from file")).toBeInTheDocument();
  });
});
