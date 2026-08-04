import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import skillMessages from "../../../../../../../messages/en/skills.json";
import { SkillBodyEditor } from "./SkillBodyEditor";

afterEach(cleanup);

function renderEditor(props: Partial<React.ComponentProps<typeof SkillBodyEditor>> = {}) {
  const onChange = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: skillMessages }}>
      <SkillBodyEditor
        value="line one\nline two\nline three"
        onChange={onChange}
        filename="my-skill.md"
        dirty={false}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { onChange };
}

describe("SkillBodyEditor", () => {
  it("renders one gutter line number per line, including a trailing newline", () => {
    renderEditor({ value: "a\nb\nc" });
    // 3 lines -> numbers 1,2,3, each its own gutter row.
    ["1", "2", "3"].forEach((n) => expect(screen.getByText(n)).toBeInTheDocument());

    cleanup();
    renderEditor({ value: "a\n" });
    // Trailing newline -> a 2nd, empty line — the textarea shows it too, so
    // the gutter must show a line 2.
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows the filename and the strip only carries the unsaved chip when dirty", () => {
    renderEditor({ dirty: false });
    expect(screen.getByText("my-skill.md")).toBeInTheDocument();
    expect(screen.queryByText("unsaved")).not.toBeInTheDocument();

    cleanup();
    renderEditor({ dirty: true });
    expect(screen.getByText("unsaved")).toBeInTheDocument();
  });

  it("shows a token count that tracks the value", () => {
    renderEditor({ value: "1234567890123456" }); // 16 chars -> 4 tokens @ 4 chars/token
    expect(screen.getByText("4 tokens")).toBeInTheDocument();
  });

  it("calls onChange when the body is edited", () => {
    const { onChange } = renderEditor({ value: "old" });
    fireEvent.change(screen.getByLabelText("Skill body (Markdown)"), {
      target: { value: "new body" },
    });
    expect(onChange).toHaveBeenCalledWith("new body");
  });

  // Pixel-parity and real scroll sync are visual concerns jsdom can't exercise
  // (no layout, so nothing ever overflows and scrollTop stays inert) — at most
  // assert the handler is wired, not that scrolling actually looks right.
  it("mirrors the textarea's scrollTop onto the gutter", () => {
    renderEditor({ value: "a\nb\nc" });
    const textarea = screen.getByLabelText("Skill body (Markdown)");
    Object.defineProperty(textarea, "scrollTop", { value: 42, configurable: true });
    fireEvent.scroll(textarea);
    const gutter = screen.getByText("1").parentElement as HTMLElement;
    expect(gutter.scrollTop).toBe(42);
  });
});
