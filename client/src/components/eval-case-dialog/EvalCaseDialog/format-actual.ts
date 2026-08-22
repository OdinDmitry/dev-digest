/* formatActualOutput — turn an EvalPerTrace into the read-only Actual
   output pane text (task §5.6). Findings JSON is the primary content;
   a one-line status header gives pass/fail + expected/got without
   forcing the user to parse the array. */
import type { EvalPerTrace } from "@devdigest/shared";

export function formatActualOutput(outcome: EvalPerTrace): string {
  const status = outcome.errored
    ? `errored${outcome.error ? `: ${outcome.error}` : ""}`
    : outcome.pass
      ? "passed"
      : "failed";
  const header = `${status} · expected ${outcome.expected_count}, got ${outcome.matched_count}`;
  return `${header}\n\n${JSON.stringify(outcome.findings, null, 2)}`;
}
