import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Skill, SkillVersion } from "@devdigest/shared";
import skillMessages from "../../../../../../../messages/en/skills.json";
import { ToastProvider } from "../../../../../../lib/toast";

const get = vi.fn();
const post = vi.fn();
vi.mock("../../../../../../lib/api", () => ({
  api: { get: (p: string) => get(p), post: (p: string, b: unknown) => post(p, b), put: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
}));

import { VersionsTab } from "./VersionsTab";

const SKILL: Skill = {
  id: "s1",
  name: "test-coverage-rubric",
  description: "Use when a diff adds or changes tests.",
  type: "rubric",
  source: "manual",
  body: "current body",
  enabled: true,
  version: 3,
  evidence_files: null,
};

const VERSIONS: SkillVersion[] = [
  { skill_id: "s1", version: 3, note: "Tightened scope", created_at: "2026-06-01T00:00:00Z", lines_added: 2, lines_removed: 1 },
  { skill_id: "s1", version: 2, note: null, created_at: "2026-05-01T00:00:00Z", lines_added: 3, lines_removed: 0 },
  { skill_id: "s1", version: 1, note: null, created_at: "2026-04-01T00:00:00Z", lines_added: 5, lines_removed: 0 },
];

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ skills: skillMessages }}>
        <ToastProvider>
          <VersionsTab skill={SKILL} />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockImplementation((path: string) => {
    if (path === "/skills/s1/versions") return Promise.resolve(VERSIONS);
    const versionDetail = path.match(/^\/skills\/s1\/versions\/(\d+)$/);
    if (versionDetail) {
      const version = Number(versionDetail[1]);
      const row = VERSIONS.find((v) => v.version === version)!;
      return Promise.resolve({ ...row, body: `body v${version}` });
    }
    throw new Error(`unexpected GET ${path}`);
  });
  post.mockResolvedValue({ ...SKILL, version: 4, body: "restored body" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("VersionsTab", () => {
  it("lists versions newest first with the current pill on v3 only", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText("Tightened scope")).toBeInTheDocument());

    expect(screen.getByText("Current")).toBeInTheDocument();
    // v2 has no note -> falls back to the computed line-delta summary.
    expect(screen.getByText("+3 −0 lines")).toBeInTheDocument();
    // v1 has no note and no predecessor -> "Initial version", not a delta.
    expect(screen.getByText("Initial version")).toBeInTheDocument();
  });

  it("offers Diff on every row with an older neighbour, including the current one; Restore everywhere but current", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText("Tightened scope")).toBeInTheDocument());

    const diffButtons = screen.getAllByRole("button", { name: "Diff" });
    const restoreButtons = screen.getAllByRole("button", { name: "Restore" });
    // v3 (current) gets Diff (against v2) but not Restore; v2 gets both;
    // v1 gets neither Diff (no older version) nor Restore (n/a — covered by
    // the dedicated restore test), just present in the list.
    expect(diffButtons).toHaveLength(2);
    expect(restoreButtons).toHaveLength(2);
  });

  it("diffing the current version compares it against its immediate predecessor", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText("Tightened scope")).toBeInTheDocument());

    // The current row (v3) is the first "Diff" button in the newest-first list.
    fireEvent.click(screen.getAllByRole("button", { name: "Diff" })[0]!);
    await waitFor(() => expect(screen.getByText("v2 → v3")).toBeInTheDocument());
  });

  it("restoring posts the version and a computed note", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText("Initial version")).toBeInTheDocument());

    const restoreButtons = screen.getAllByRole("button", { name: "Restore" });
    fireEvent.click(restoreButtons[restoreButtons.length - 1]!); // restore v1

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/skills/s1/versions/1/restore", {
      note: "Restored from v1",
    });
  });
});
