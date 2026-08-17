import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ContextAttachmentSet, ContextListing } from "@devdigest/shared";
import contextMessages from "../../../../messages/en/context.json";

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    get: (p: string) => get(p),
    post: (p: string, b?: unknown) => post(p, b),
    put: (p: string, b?: unknown) => put(p, b),
    del: vi.fn(),
  },
  ApiError: class extends Error {},
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    repoId: "r1",
    activeRepo: { id: "r1", full_name: "acme/payments-api", default_branch: "main" },
  }),
}));

import { ContextAttachPanel } from "./ContextAttachPanel";

// The row `<div>` carries `tabIndex={0}`, the click/keydown handlers, and
// `dragProps`, but no `role` of its own — `role="checkbox"` lives on the
// leaf state-indicator `<span>` inside it instead (client/insights.md,
// 2026-08-17). `[tabindex="0"]` is therefore the only stable, non-coincidental
// way to locate "the row" itself for tests that need to focus it or read
// `draggable` off it; every other row selector below goes through an
// accessible query (`getByRole`) against the leaf controls.
function getRow(path: string): HTMLElement {
  return screen.getByText(path).closest('[tabindex="0"]') as HTMLElement;
}

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ context: contextMessages }}>
        <ContextAttachPanel ownerKind="agent" ownerId="a1" hint="Order matters." />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const LISTING: ContextListing = {
  documents: [
    { path: "a.md", folder: "", size_bytes: 10, token_count: 100, usage_count: 1 },
    { path: "b.md", folder: "", size_bytes: 10, token_count: 50, usage_count: 0 },
    { path: "c.md", folder: "docs", size_bytes: 10, token_count: 30, usage_count: 0 },
  ],
  document_count: 3,
  total_tokens: 180,
  partial: false,
  not_listed: 0,
  last_synced_at: "2026-08-16T10:00:00Z",
  synced: true,
};

function attachmentSet(over: Partial<ContextAttachmentSet> = {}): ContextAttachmentSet {
  return {
    attachments: [
      {
        owner_kind: "agent",
        owner_id: "a1",
        repo_id: "r1",
        path: "a.md",
        order: 0,
        missing: false,
        token_count: 100,
      },
    ],
    total_tokens: 100,
    budget: 20000,
    over_budget: false,
    ...over,
  };
}

function mockGets(set: ContextAttachmentSet, listing: ContextListing = LISTING) {
  get.mockImplementation((p: string) => {
    if (p === "/repos/r1/context/documents") return Promise.resolve(listing);
    if (p === "/agents/a1/context") return Promise.resolve(set);
    throw new Error(`unexpected GET ${p}`);
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ContextAttachPanel", () => {
  it("updates the combined token count on attach and on detach without starting a run", async () => {
    mockGets(attachmentSet());
    let resolvePut: (v: unknown) => void = () => {};
    put.mockImplementation(() => new Promise((res) => (resolvePut = res)));

    renderPanel();
    await waitFor(() => expect(screen.getByText("a.md")).toBeInTheDocument());
    expect(screen.getByText("≈ 100 tokens")).toBeInTheDocument();

    // Detach the only attached document — its known token count is dropped
    // from the footer total immediately, while the PUT is still pending.
    // Clicking the accessibly-named checkbox indicator bubbles to the row's
    // own onClick, which owns the actual toggle.
    fireEvent.click(screen.getByRole("checkbox", { name: "Detach a.md" }));

    await waitFor(() =>
      expect(put).toHaveBeenNthCalledWith(1, "/agents/a1/context", { repo_id: "r1", paths: [] }),
    );
    expect(screen.getByText("≈ 0 tokens")).toBeInTheDocument();
    resolvePut(attachmentSet({ attachments: [], total_tokens: 0 }));
    await waitFor(() => expect(screen.getByText("≈ 0 tokens")).toBeInTheDocument());

    // Attach a previously-unattached document — the footer total must move
    // again, still with no PUT resolved yet.
    put.mockImplementation(() => new Promise((res) => (resolvePut = res)));
    fireEvent.click(screen.getByRole("checkbox", { name: "Attach b.md" }));

    await waitFor(() =>
      expect(put).toHaveBeenNthCalledWith(2, "/agents/a1/context", { repo_id: "r1", paths: ["b.md"] }),
    );
    expect(screen.getByText("≈ 50 tokens")).toBeInTheDocument();
    resolvePut(attachmentSet({
      attachments: [
        { owner_kind: "agent", owner_id: "a1", repo_id: "r1", path: "b.md", order: 0, missing: false, token_count: 50 },
      ],
      total_tokens: 50,
    }));
    await waitFor(() => expect(screen.getByText("≈ 50 tokens")).toBeInTheDocument());

    // Nothing about attaching/detaching a document starts a review run.
    expect(post).not.toHaveBeenCalled();
  });

  it("does not permit reordering while the filter is non-empty", async () => {
    mockGets(
      attachmentSet({
        attachments: [
          { owner_kind: "agent", owner_id: "a1", repo_id: "r1", path: "a.md", order: 0, missing: false, token_count: 100 },
          { owner_kind: "agent", owner_id: "a1", repo_id: "r1", path: "b.md", order: 1, missing: false, token_count: 50 },
        ],
        total_tokens: 150,
      }),
    );

    renderPanel();
    await waitFor(() => expect(screen.getByText("a.md")).toBeInTheDocument());
    expect(getRow("a.md")).toHaveAttribute("draggable", "true");
    expect(screen.getAllByText("Order matters.").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Filter documents…"), { target: { value: "a." } });

    expect(screen.queryByText("b.md")).not.toBeInTheDocument();
    expect(getRow("a.md")).not.toHaveAttribute("draggable");
    expect(screen.getAllByText("Reordering is off while a filter is active.").length).toBeGreaterThan(0);

    // The keyboard move command is also gated off while filtering.
    fireEvent.keyDown(getRow("a.md"), {
      key: "ArrowDown",
      altKey: true,
    });
    expect(put).not.toHaveBeenCalled();
  });

  it("moves a focused row one position with the keyboard and keeps focus on it", async () => {
    mockGets(
      attachmentSet({
        attachments: [
          { owner_kind: "agent", owner_id: "a1", repo_id: "r1", path: "a.md", order: 0, missing: false, token_count: 100 },
          { owner_kind: "agent", owner_id: "a1", repo_id: "r1", path: "b.md", order: 1, missing: false, token_count: 50 },
        ],
        total_tokens: 150,
      }),
    );
    put.mockResolvedValue(attachmentSet());

    renderPanel();
    await waitFor(() => expect(screen.getByText("a.md")).toBeInTheDocument());

    const firstRow = getRow("a.md");
    firstRow.focus();
    expect(document.activeElement).toBe(firstRow);

    fireEvent.keyDown(firstRow, { key: "ArrowDown", altKey: true });

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith("/agents/a1/context", { repo_id: "r1", paths: ["b.md", "a.md"] }),
    );
    await waitFor(() => expect(document.activeElement).toBe(getRow("a.md")));
  });

  it("announces the document and its new position to assistive technology", async () => {
    mockGets(
      attachmentSet({
        attachments: [
          { owner_kind: "agent", owner_id: "a1", repo_id: "r1", path: "a.md", order: 0, missing: false, token_count: 100 },
          { owner_kind: "agent", owner_id: "a1", repo_id: "r1", path: "b.md", order: 1, missing: false, token_count: 50 },
        ],
        total_tokens: 150,
      }),
    );
    put.mockResolvedValue(attachmentSet());

    renderPanel();
    await waitFor(() => expect(screen.getByText("a.md")).toBeInTheDocument());

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("");

    // Prove the row that fires the move command is actually reachable by a
    // keyboard user first — firing `keyDown` at an element reference alone
    // (the old assertion) says nothing about whether a real Tab-only user
    // could ever have gotten there. Without this, the test would keep
    // passing even if the row were removed from the tab order entirely.
    const firstRow = getRow("a.md");
    firstRow.focus();
    expect(document.activeElement).toBe(firstRow);

    fireEvent.keyDown(firstRow, { key: "ArrowDown", altKey: true });

    await waitFor(() => expect(status).toHaveTextContent("a.md moved to position 2 of 2"));
  });

  it("warns when the attached set exceeds the project-context budget", async () => {
    mockGets(attachmentSet({ total_tokens: 25000, over_budget: true }));

    renderPanel();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This set exceeds the 20,000-token project-context budget.",
    );
  });

  it("marks an attachment absent from the working copy as missing", async () => {
    mockGets(
      attachmentSet({
        attachments: [
          {
            owner_kind: "agent",
            owner_id: "a1",
            repo_id: "r1",
            path: "gone.md",
            order: 0,
            missing: true,
            token_count: 20,
          },
        ],
        total_tokens: 20,
      }),
    );

    renderPanel();

    await waitFor(() => expect(screen.getByText("gone.md")).toBeInTheDocument());
    expect(screen.getByText("Missing from the working copy")).toBeInTheDocument();
    // A missing attachment is not draggable — nothing to reorder against a
    // document that no longer exists in the working copy.
    expect(getRow("gone.md")).not.toHaveAttribute("draggable");
  });

  it("states that the filter matched no documents", async () => {
    mockGets(attachmentSet());

    renderPanel();
    await waitFor(() => expect(screen.getByText("a.md")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Filter documents…"), {
      target: { value: "does-not-exist-anywhere" },
    });

    // The panel states no match instead of rendering an empty list box.
    expect(screen.getByText("No document matches your filter.")).toBeInTheDocument();
    expect(screen.queryByText("a.md")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("makes every row control keyboard-reachable and accessibly named", async () => {
    mockGets(attachmentSet());

    renderPanel();
    await waitFor(() => expect(screen.getByText("a.md")).toBeInTheDocument());

    // Preview control: a real, focusable button whose accessible name states
    // both the action and the document it acts on (spec NFR: "Every control
    // that acts on a single document … SHALL have an accessible name that
    // identifies both the action and the document it acts on").
    const preview = screen.getByRole("button", { name: "Preview a.md" });
    preview.focus();
    expect(document.activeElement).toBe(preview);

    // Reorder grip: same shape of requirement, and it must be a real,
    // independently focusable control — not merely a labelled image.
    const grip = screen.getByRole("button", { name: "Reorder a.md with Alt+Up or Alt+Down" });
    grip.focus();
    expect(document.activeElement).toBe(grip);

    // Attach-state indicator: exposed to assistive technology as a named,
    // stateful checkbox …
    const checkbox = screen.getByRole("checkbox", { name: "Detach a.md" });
    expect(checkbox).toHaveAttribute("aria-checked", "true");
    // … and, per WAI-ARIA's checkbox pattern, the element carrying
    // role="checkbox" must itself be in the tab sequence (tabindex="0" on
    // the SAME node) to be operable by a keyboard/AT user. Without that, a
    // keyboard user tabbing through the list never lands on an element AT
    // announces as "checkbox", and can't discover its checked state from
    // focus alone — the row `<div>` one level up carries no role.
    checkbox.focus();
    expect(document.activeElement).toBe(checkbox);
  });
});
