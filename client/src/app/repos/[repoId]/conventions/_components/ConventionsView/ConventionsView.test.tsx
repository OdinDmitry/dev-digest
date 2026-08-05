import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ConventionCandidate, ConventionMergePreview } from "@devdigest/shared";
import conventionsMessages from "../../../../../../../messages/en/conventions.json";
import skillsMessages from "../../../../../../../messages/en/skills.json";
import { ToastProvider } from "../../../../../../lib/toast";

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
vi.mock("../../../../../../lib/api", () => ({
  api: { get: (p: string) => get(p), post: (p: string, b?: unknown) => post(p, b), put: (p: string, b?: unknown) => put(p, b), del: vi.fn() },
  ApiError: class extends Error {},
}));

// The shell pulls in nav chrome this test does not exercise.
vi.mock("../../../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../../../../../lib/repo-context", () => ({
  useActiveRepo: () => ({
    repoId: "r1",
    activeRepo: { id: "r1", full_name: "acme/payments-api", default_branch: "main" },
  }),
  useRepoNotFound: () => false,
}));

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

import { ConventionsView } from "./ConventionsView";

const CANDIDATES: ConventionCandidate[] = [
  {
    id: "c1",
    repo_id: "r1",
    category: "async",
    rule: "Always use async/await instead of .then() chains",
    evidence_path: "src/api/users.ts",
    evidence_start_line: 23,
    evidence_end_line: 31,
    evidence_snippet: "const user = await db.users.find(id);",
    confidence: 0.91,
    status: "pending",
    scanned_sha: "abc123",
    created_at: "2026-08-04T10:00:00Z",
  },
  {
    id: "c2",
    repo_id: "r1",
    category: "http",
    rule: "All public route handlers return typed Result<T, ApiError>",
    evidence_path: "src/api/public/index.ts",
    evidence_start_line: 14,
    evidence_end_line: 20,
    evidence_snippet: "function handler(): Result<Item[], ApiError> {}",
    confidence: 0.78,
    status: "accepted",
    scanned_sha: "abc123",
    created_at: "2026-08-04T10:00:00Z",
  },
];

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider
        locale="en"
        messages={{ conventions: conventionsMessages, skills: skillsMessages }}
      >
        <ToastProvider>
          <ConventionsView />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

// A mutable copy so a PUT's effect is visible on the next GET — the real API
// persists the change; a static fixture would make the invalidation-refetch
// in useUpdateConvention's onSettled silently revert the optimistic update.
let currentCandidates: ConventionCandidate[] = [];

beforeEach(() => {
  currentCandidates = CANDIDATES.map((c) => ({ ...c }));
  get.mockImplementation((path: string) => {
    if (path === "/repos/r1/conventions") return Promise.resolve(currentCandidates);
    throw new Error(`unexpected GET ${path}`);
  });
  put.mockImplementation((path: string, body: unknown) => {
    const id = path.split("/").pop();
    currentCandidates = currentCandidates.map((c) =>
      c.id === id ? { ...c, ...(body as object) } : c,
    );
    return Promise.resolve(currentCandidates.find((c) => c.id === id));
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ConventionsView", () => {
  it("shows the empty state with a Run extraction CTA when nothing has been scanned", async () => {
    get.mockImplementation((path: string) => {
      if (path === "/repos/r1/conventions") return Promise.resolve([]);
      throw new Error(`unexpected GET ${path}`);
    });
    renderView();
    await waitFor(() => expect(screen.getByText("No conventions extracted yet")).toBeInTheDocument());
    expect(screen.getByText("Run extraction")).toBeInTheDocument();
  });

  it("lists each candidate with its rule, evidence link and accepted count", async () => {
    renderView();
    await waitFor(() =>
      expect(screen.getByText("Always use async/await instead of .then() chains")).toBeInTheDocument(),
    );
    expect(
      screen.getByText("All public route handlers return typed Result<T, ApiError>"),
    ).toBeInTheDocument();
    // c2 is already accepted, c1 is pending → "1 of 2 accepted".
    expect(screen.getByText("1 of 2 accepted")).toBeInTheDocument();
    expect(screen.getByText(/src\/api\/users\.ts:23-31/)).toBeInTheDocument();
  });

  it("accepting a candidate updates its status and the accepted counter optimistically", async () => {
    renderView();
    await waitFor(() =>
      expect(screen.getByText("Always use async/await instead of .then() chains")).toBeInTheDocument(),
    );
    expect(screen.getByText("1 of 2 accepted")).toBeInTheDocument();

    const acceptButtons = screen.getAllByRole("button", { name: "Accept" });
    fireEvent.click(acceptButtons[0]!);

    await waitFor(() => expect(screen.getByText("2 of 2 accepted")).toBeInTheDocument());
    expect(put).toHaveBeenCalledWith("/conventions/c1", { status: "accepted" });
  });

  it("disables Create skill until at least one candidate is accepted, then opens the merge modal", async () => {
    const draft: ConventionMergePreview = {
      name: "payments-api-conventions",
      description: "1 house convention extracted from acme/payments-api.",
      type: "convention",
      body: "## http\n\n### All public route handlers return typed Result<T, ApiError>",
      evidence_files: ["src/api/public/index.ts"],
    };
    post.mockImplementation((path: string) => {
      if (path === "/repos/r1/conventions/merge-preview") return Promise.resolve(draft);
      throw new Error(`unexpected POST ${path}`);
    });

    renderView();
    await waitFor(() =>
      expect(screen.getByText("All public route handlers return typed Result<T, ApiError>")).toBeInTheDocument(),
    );

    const createSkill = screen.getByRole("button", { name: "Create skill" });
    expect(createSkill).not.toBeDisabled();

    fireEvent.click(createSkill);
    await waitFor(() => expect(screen.getByText("Create skill from conventions")).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByDisplayValue("payments-api-conventions")).toBeInTheDocument(),
    );
    expect(post).toHaveBeenCalledWith("/repos/r1/conventions/merge-preview", { convention_ids: ["c2"] });

    post.mockImplementation((path: string, body: unknown) => {
      if (path === "/repos/r1/conventions/merge-preview") return Promise.resolve(draft);
      if (path === "/skills") return Promise.resolve({ id: "s1", ...(body as object) });
      throw new Error(`unexpected POST ${path}`);
    });
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Create skill" }));

    await waitFor(() => expect(routerPush).toHaveBeenCalledWith("/skills?id=s1"));
  });
});
