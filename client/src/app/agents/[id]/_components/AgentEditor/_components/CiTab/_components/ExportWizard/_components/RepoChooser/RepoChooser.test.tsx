import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Repo } from "@devdigest/shared";
import ciMessages from "../../../../../../../../../../../../messages/en/ci.json";

const get = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    get: (p: string) => get(p),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class extends Error {},
  API_BASE: "http://localhost:3001",
}));

import { RepoChooser } from "./RepoChooser";

const REPO_A: Repo = {
  id: "r-a",
  workspace_id: "ws1",
  owner: "acme",
  name: "payments-api",
  full_name: "acme/payments-api",
  default_branch: "main",
  clone_path: null,
  last_polled_at: null,
  created_by: null,
};
const REPO_B: Repo = {
  id: "r-b",
  workspace_id: "ws1",
  owner: "example",
  name: "other-repo",
  full_name: "example/other-repo",
  default_branch: "main",
  clone_path: null,
  last_polled_at: null,
  created_by: null,
};

function mockRepos(repos: Repo[]) {
  get.mockImplementation((path: string) => {
    if (path === "/repos") return Promise.resolve(repos);
    throw new Error(`unexpected GET ${path}`);
  });
}

/** Uncontrolled test wrapper — RepoChooser itself is controlled, so the
 *  "previous selection persists" assertion needs real state, not a mock
 *  onChange that's never wired back in. */
function Wrapper({ initial = null as string | null }) {
  const [value, setValue] = React.useState<string | null>(initial);
  return <RepoChooser value={value} onChange={setValue} required />;
}

function renderChooser(initial: string | null = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ ci: ciMessages }}>
        <Wrapper initial={initial} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("RepoChooser — keyboard reachability and selection", () => {
  it("the filter input is a normal Tab stop, and ArrowDown + Enter selects without a pointer", async () => {
    mockRepos([REPO_A, REPO_B]);
    renderChooser();

    const input = await screen.findByLabelText(/Target repository/);
    // A normal Tab stop: no explicit removal from tab order.
    expect(input).not.toHaveAttribute("tabindex", "-1");
    await screen.findByRole("option", { name: REPO_A.full_name });

    input.focus();
    expect(document.activeElement).toBe(input);

    // Options render in fetch order: REPO_A first, REPO_B second — ArrowDown
    // once moves the highlight onto REPO_B.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    const optionB = screen.getByRole("option", { name: REPO_B.full_name });
    expect(optionB).toHaveAttribute("aria-selected", "true");
  });
});

describe("RepoChooser — debounced match-count announcement", () => {
  it("announces the match count once per completed search, not once per keystroke", async () => {
    mockRepos([REPO_A, REPO_B]);
    renderChooser();
    const input = await screen.findByLabelText(/Target repository/);
    await screen.findByRole("option", { name: REPO_A.full_name });

    vi.useFakeTimers();
    const live = document.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toBe("");

    // First keystroke — a query that (if it completed) would report a
    // different match count than the second.
    fireEvent.change(input, { target: { value: "acm" } });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    // Second keystroke inside the 300ms debounce window restarts the timer.
    fireEvent.change(input, { target: { value: "acme" } });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    // Virtual time is now 300ms past the FIRST keystroke — the point the
    // stale "acm" timer would have fired had it not been cancelled. Nothing
    // should have been announced yet.
    expect(live.textContent).toBe("");

    act(() => {
      vi.advanceTimersByTime(150);
    });
    // Now 300ms past the second keystroke — exactly one announcement, for
    // the completed search.
    expect(live.textContent).toBe("1 repositories match");
  });
});

describe("RepoChooser — empty result (edge case: not a deselection)", () => {
  it("states nothing matched and leaves the previously chosen repository selected", async () => {
    mockRepos([REPO_A, REPO_B]);
    renderChooser(REPO_A.id);
    const input = await screen.findByLabelText(/Target repository/);
    await screen.findByRole("option", { name: REPO_A.full_name });
    expect(screen.getByRole("option", { name: REPO_A.full_name })).toHaveAttribute("aria-selected", "true");

    fireEvent.change(input, { target: { value: "zzz-does-not-exist" } });

    expect(screen.getByText("No repositories match your search.")).toBeInTheDocument();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();

    // Clear the filter — the earlier selection is still there, proving the
    // failed search never called onChange/deselected anything.
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByRole("option", { name: REPO_A.full_name })).toHaveAttribute("aria-selected", "true");
  });
});
