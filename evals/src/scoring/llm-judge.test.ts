/**
 * Non-model tests for the judge's JSON repair. Pins the exact failure seen in CI on a cheap judge
 * model: a verbatim multi-line `evidence` quote produced a literal newline inside a JSON string,
 * `JSON.parse` threw "Bad control character in string literal", and the whole eval case failed as
 * if the SKILL had regressed.
 *   pnpm vitest run src/scoring/llm-judge.test.ts
 */

import { describe, expect, test } from "vitest";
import { escapeControlChars } from "./llm-judge.js";

describe("escapeControlChars", () => {
  test("a raw newline inside a string literal becomes parseable", () => {
    const broken = '{"results":[{"practice":"p","passed":true,"evidence":"line one\nline two"}]}';
    expect(() => JSON.parse(broken)).toThrow();

    const parsed = JSON.parse(escapeControlChars(broken));
    expect(parsed.results[0].evidence).toBe("line one\nline two");
    expect(parsed.results[0].passed).toBe(true);
  });

  test("tabs and carriage returns inside strings are repaired too", () => {
    const broken = '{"results":[{"practice":"p","passed":false,"evidence":"a\tb\r\nc"}]}';
    expect(JSON.parse(escapeControlChars(broken)).results[0].evidence).toBe("a\tb\r\nc");
  });

  test("already-valid JSON is left semantically unchanged", () => {
    const valid = '{"results":[{"practice":"p","passed":true,"evidence":"escaped \\n stays escaped"}]}';
    expect(escapeControlChars(valid)).toBe(valid);
    expect(JSON.parse(escapeControlChars(valid)).results[0].evidence).toBe("escaped \n stays escaped");
  });

  test("an escaped quote does not flip the in-string state", () => {
    // The \" must not be read as a string terminator, or every control char after it would be
    // treated as structural whitespace and left unescaped.
    const broken = '{"results":[{"practice":"quote \\" inside","passed":true,"evidence":"x\ny"}]}';
    const parsed = JSON.parse(escapeControlChars(broken));
    expect(parsed.results[0].practice).toBe('quote " inside');
    expect(parsed.results[0].evidence).toBe("x\ny");
  });

  test("newlines BETWEEN tokens (pretty-printed JSON) are untouched", () => {
    const pretty = '{\n  "results": [\n    {"practice": "p", "passed": true, "evidence": "e"}\n  ]\n}';
    expect(escapeControlChars(pretty)).toBe(pretty);
    expect(JSON.parse(escapeControlChars(pretty)).results).toHaveLength(1);
  });
});
