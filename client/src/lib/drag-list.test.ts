import { describe, it, expect } from "vitest";
import { moveItem } from "./drag-list";

describe("moveItem", () => {
  const list = ["a", "b", "c", "d"];

  it("moves an item later in the list", () => {
    expect(moveItem(list, 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an item earlier in the list", () => {
    expect(moveItem(list, 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("returns a copy, never mutating the input", () => {
    const out = moveItem(list, 0, 3);
    expect(list).toEqual(["a", "b", "c", "d"]);
    expect(out).not.toBe(list);
  });

  it("is a no-op for the same index or an out-of-range one", () => {
    expect(moveItem(list, 1, 1)).toEqual(list);
    expect(moveItem(list, -1, 2)).toEqual(list);
    expect(moveItem(list, 0, 9)).toEqual(list);
  });
});
