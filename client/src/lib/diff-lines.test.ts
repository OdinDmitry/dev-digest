import { describe, it, expect } from "vitest";
import { diffLines, MAX_DIFF_CELLS } from "./diff-lines";

describe("diffLines", () => {
  it("returns all-context lines for identical text", () => {
    const { lines, truncated } = diffLines("a\nb\nc", "a\nb\nc");
    expect(truncated).toBe(false);
    expect(lines).toEqual([
      { kind: "ctx", text: "a", oldNo: 1, newNo: 1 },
      { kind: "ctx", text: "b", oldNo: 2, newNo: 2 },
      { kind: "ctx", text: "c", oldNo: 3, newNo: 3 },
    ]);
  });

  it("treats an empty predecessor as a pure insert", () => {
    const { lines } = diffLines("", "a\nb");
    expect(lines).toEqual([
      { kind: "add", text: "a", newNo: 1 },
      { kind: "add", text: "b", newNo: 2 },
    ]);
  });

  it("treats an empty next text as a pure delete", () => {
    const { lines } = diffLines("a\nb", "");
    expect(lines).toEqual([
      { kind: "del", text: "a", oldNo: 1 },
      { kind: "del", text: "b", oldNo: 2 },
    ]);
  });

  it("renders a pure append as trailing add lines after shared context", () => {
    const { lines } = diffLines("a\nb", "a\nb\nc\nd");
    expect(lines).toEqual([
      { kind: "ctx", text: "a", oldNo: 1, newNo: 1 },
      { kind: "ctx", text: "b", oldNo: 2, newNo: 2 },
      { kind: "add", text: "c", newNo: 3 },
      { kind: "add", text: "d", newNo: 4 },
    ]);
  });

  it("puts del before add for a single replaced line in the middle", () => {
    const { lines } = diffLines("a\nb\nc", "a\nX\nc");
    expect(lines).toEqual([
      { kind: "ctx", text: "a", oldNo: 1, newNo: 1 },
      { kind: "del", text: "b", oldNo: 2 },
      { kind: "add", text: "X", newNo: 2 },
      { kind: "ctx", text: "c", oldNo: 3, newNo: 3 },
    ]);
  });

  it("strips a large identical prefix and suffix around a small edit", () => {
    const common = Array.from({ length: 50 }, (_, i) => `line-${i}`);
    const a = [...common, "old", ...common].join("\n");
    const b = [...common, "new", ...common].join("\n");
    const { lines, truncated } = diffLines(a, b);
    expect(truncated).toBe(false);
    const changed = lines.filter((l) => l.kind !== "ctx");
    expect(changed).toEqual([
      { kind: "del", text: "old", oldNo: 51 },
      { kind: "add", text: "new", newNo: 51 },
    ]);
  });

  it("reports truncated instead of paying an unbounded DP cost", () => {
    const side = Math.ceil(Math.sqrt(MAX_DIFF_CELLS)) + 100;
    const a = Array.from({ length: side }, (_, i) => `a-${i}`).join("\n");
    const b = Array.from({ length: side }, (_, i) => `b-${i}`).join("\n");
    const { lines, truncated } = diffLines(a, b);
    expect(truncated).toBe(true);
    expect(lines).toEqual([]);
  });
});
