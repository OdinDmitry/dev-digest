import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Markdown } from "./Markdown";

describe("Markdown", () => {
  it("renders inline code as a standalone styled chip, not inside a <pre>", () => {
    const { container } = render(<Markdown>{"Use `foo()` here."}</Markdown>);
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.closest("pre")).toBeNull();
    expect(code?.style.background).not.toBe("");
  });

  it("renders a fenced code block as one plain <pre><code> pair, with no nested inline-chip styling", () => {
    const { container } = render(<Markdown>{"```\nexport const s = {};\n```"}</Markdown>);
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    const code = pre?.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.textContent?.trim()).toBe("export const s = {};");
    // The bug this guards against: the inline-code renderer's own
    // background/padding/border-radius leaking onto the block's <code>,
    // producing two mismatched rounded boxes instead of one.
    expect(code?.getAttribute("style")).toBeNull();
    expect(code?.className).toBe("");
  });

  it("returns nothing for empty content", () => {
    const { container } = render(<Markdown>{""}</Markdown>);
    expect(container.firstChild).toBeNull();
  });
});
