import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent, AgentSkillLink, Skill } from "@devdigest/shared";
import agentMessages from "../../../../../../../../messages/en/agents.json";
import skillMessages from "../../../../../../../../messages/en/skills.json";

/**
 * The API client is mocked, not the hooks: the behaviour under test — the
 * optimistic reorder — lives inside `useSetAgentSkills`, so stubbing the hooks
 * would test nothing.
 */
const get = vi.fn();
const post = vi.fn();
vi.mock("../../../../../../../lib/api", () => ({
  api: {
    get: (path: string) => get(path),
    post: (path: string, body: unknown) => post(path, body),
    put: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class extends Error {},
}));

import { SkillsTab } from "./SkillsTab";

const AGENT = { id: "ag1", name: "Test Quality Reviewer" } as Agent;

const skill = (id: string, name: string, over: Partial<Skill> = {}): Skill => ({
  id,
  name,
  description: `what ${name} is for`,
  type: "rubric",
  source: "manual",
  body: `## ${name}`,
  enabled: true,
  version: 1,
  evidence_files: null,
  ...over,
});

const SKILLS = [
  skill("s1", "test-coverage-rubric"),
  skill("s2", "edge-case-checklist"),
  skill("s3", "mock-discipline", { type: "convention" }),
  skill("s4", "unlinked-skill", { type: "custom" }),
];

const LINKS: AgentSkillLink[] = [
  { agent_id: "ag1", skill_id: "s1", order: 0 },
  { agent_id: "ag1", skill_id: "s2", order: 1 },
  { agent_id: "ag1", skill_id: "s3", order: 2 },
];

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider
        locale="en"
        messages={{ agents: agentMessages, skills: skillMessages }}
      >
        <SkillsTab agent={AGENT} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

/** Skill names in DOM order — the order their blocks reach the prompt. */
function rowNames(): string[] {
  return screen.getAllByRole("checkbox").map((el) => within(el).getByText(/-/).textContent ?? "");
}

/** A drag payload jsdom does not synthesise on its own. */
const dataTransfer = () => ({
  setData: vi.fn(),
  getData: vi.fn(() => ""),
  effectAllowed: "",
  dropEffect: "",
});

beforeEach(() => {
  get.mockImplementation((path: string) => {
    if (path === "/skills") return Promise.resolve(SKILLS);
    if (path === "/agents/ag1/skills") return Promise.resolve(LINKS);
    throw new Error(`unexpected GET ${path}`);
  });
  post.mockResolvedValue(LINKS);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SkillsTab", () => {
  it("lists linked skills in prompt order, then unlinked ones", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText("test-coverage-rubric")).toBeInTheDocument());

    expect(rowNames()).toEqual([
      "test-coverage-rubric",
      "edge-case-checklist",
      "mock-discipline",
      "unlinked-skill",
    ]);
    expect(screen.getByText("3 of 4 enabled")).toBeInTheDocument();
    expect(screen.getByText("mock-discipline").closest("[role=checkbox]")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByText("unlinked-skill").closest("[role=checkbox]")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("attaching a skill posts the existing order with the new id appended", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText("unlinked-skill")).toBeInTheDocument());

    fireEvent.click(screen.getByText("unlinked-skill").closest("[role=checkbox]")!);

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/agents/ag1/skills", {
      skill_ids: ["s1", "s2", "s3", "s4"],
    });
  });

  it("detaching a skill posts the remaining ids in order", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText("edge-case-checklist")).toBeInTheDocument());

    fireEvent.click(screen.getByText("edge-case-checklist").closest("[role=checkbox]")!);

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/agents/ag1/skills", { skill_ids: ["s1", "s3"] });
  });

  it("dragging a skill reorders it and shows the new order BEFORE the save resolves", async () => {
    // Hold the response open: the point of the optimistic update is that the
    // list is already correct while this promise is still pending.
    let resolvePost: (v: unknown) => void = () => {};
    post.mockImplementation(() => new Promise((res) => (resolvePost = res)));

    renderTab();
    await waitFor(() => expect(screen.getByText("mock-discipline")).toBeInTheDocument());

    const third = screen.getByText("mock-discipline").closest("[role=checkbox]")!;
    const first = screen.getByText("test-coverage-rubric").closest("[role=checkbox]")!;

    fireEvent.dragStart(third, { dataTransfer: dataTransfer() });
    fireEvent.dragOver(first, { dataTransfer: dataTransfer() });
    fireEvent.drop(first, { dataTransfer: dataTransfer() });

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/agents/ag1/skills", {
        skill_ids: ["s3", "s1", "s2"],
      }),
    );
    // Still in flight, and the UI has already moved.
    await waitFor(() =>
      expect(rowNames()).toEqual([
        "mock-discipline",
        "test-coverage-rubric",
        "edge-case-checklist",
        "unlinked-skill",
      ]),
    );

    resolvePost([]);
  });

  it("disables dragging while a filter is active, so hidden skills can't be dropped", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText("mock-discipline")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Filter skills…"), { target: { value: "mock" } });

    expect(rowNames()).toEqual(["mock-discipline"]);
    expect(screen.getByText(/Reordering is off while a filter is active/)).toBeInTheDocument();
    expect(screen.getByText("mock-discipline").closest("[role=checkbox]")).not.toHaveAttribute(
      "draggable",
    );
  });

  it("marks a skill that is disabled in the library", async () => {
    get.mockImplementation((path: string) => {
      if (path === "/skills") {
        return Promise.resolve([SKILLS[0], skill("s2", "edge-case-checklist", { enabled: false })]);
      }
      return Promise.resolve(LINKS.slice(0, 2));
    });

    renderTab();
    await waitFor(() => expect(screen.getByText("edge-case-checklist")).toBeInTheDocument());
    expect(screen.getByText("disabled in library")).toBeInTheDocument();
  });
});
