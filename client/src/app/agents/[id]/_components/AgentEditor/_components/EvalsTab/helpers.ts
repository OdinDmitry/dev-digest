import type { EvalCaseRecord, EvalExpectation, EvalSuiteRun } from "@devdigest/shared";

/** The one `running` suite run in a history list, if any — AC-16 guarantees
 *  at most one per agent. */
export function runningRun(runs: EvalSuiteRun[] | undefined): EvalSuiteRun | null {
  return runs?.find((r) => r.status === "running") ?? null;
}

/** A case's own expectation. `EvalCaseRecord.expectations` stays an array of
 *  one (Placement decision 8) — this is the single place that reads index 0,
 *  so a future narrowing of the contract only touches this function. */
export function caseExpectation(c: EvalCaseRecord): EvalExpectation | null {
  return c.expectations[0] ?? null;
}

/** AC-53's expected finding count: 1 for a `must_find` case, 0 for a
 *  `must_not_flag` one (and for a case with no expectation at all). */
export function expectedFindingCount(c: EvalCaseRecord): number {
  return caseExpectation(c)?.kind === "must_find" ? 1 : 0;
}

/** AC-58 — cases whose most recent result passed, out of the whole set. A
 *  case with no `latest_result` (never run) or a `latest_result.passed` of
 *  `false`/`null` does not count. */
export function passedCaseCount(cases: EvalCaseRecord[]): number {
  return cases.filter((c) => c.latest_result?.passed === true).length;
}

/** AC-57 — the newest run whose status is `completed`, or `null` when the
 *  agent has none yet. A `running` run is excluded structurally, which is
 *  what keeps AC-61 true without a separate check. */
export function latestCompletedRun(runs: EvalSuiteRun[] | undefined): EvalSuiteRun | null {
  const completed = (runs ?? []).filter((r) => r.status === "completed");
  if (completed.length === 0) return null;
  return completed.reduce((latest, r) => (r.started_at > latest.started_at ? r : latest));
}
