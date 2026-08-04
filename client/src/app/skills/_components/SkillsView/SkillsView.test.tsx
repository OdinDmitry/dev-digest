import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Skill } from "@devdigest/shared";
import skillMessages from "../../../../../messages/en/skills.json";
import shellMessages from "../../../../../messages/en/shell.json";
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

let selectedId: string | null = null;
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: (url: string) => {
      selectedId = new URL(url, "http://x").searchParams.get("id");
    },
    push: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(selectedId ? { id: selectedId } : {}),
}));

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ skills: skillMessages, shell: shellMessages }}>
        <ToastProvider>
          <SkillsView />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  selectedId = null;
  get.mockImplementation((path: string) => {
    if (path === "/skills") return Promise.resolve(SKILLS);
    throw new Error(`unexpected GET ${path}`);
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SkillsView", () => {
  it("renders a card per skill with its type, and flags an imported one for vetting", async () => {
    renderView();
    await waitFor(() => expect(screen.getByText("test-coverage-rubric")).toBeInTheDocument());

    expect(screen.getByText("flake-radar")).toBeInTheDocument();
    expect(screen.getByText("Use when a diff adds or changes tests.")).toBeInTheDocument();
    expect(screen.getByText("rubric")).toBeInTheDocument();
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

  it("opens the preview pane for the selected skill", async () => {
    const { rerender } = renderView();
    await waitFor(() => expect(screen.getByText("test-coverage-rubric")).toBeInTheDocument());

    // Nothing is selected until a card is clicked.
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("test-coverage-rubric"));
    expect(selectedId).toBe("s1");

    // The route push is mocked, so re-render to reflect the new ?id=.
    rerender(<div />);
    cleanup();
    renderView();
    await waitFor(() => expect(screen.getByText("Edit")).toBeInTheDocument());
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByText("Enumerate every branch.")).toBeInTheDocument();
  });

  it("shows the empty state when the library has no skills", async () => {
    get.mockResolvedValue([]);
    renderView();
    await waitFor(() => expect(screen.getByText("No skills yet")).toBeInTheDocument());
  });
});
