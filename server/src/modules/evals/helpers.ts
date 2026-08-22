import type {
  AssembledRunContext,
  EvalCapturedContext,
  EvalCase,
  EvalCaseOrigin,
  EvalComparison,
  EvalComparisonMetric,
  EvalContextDocument,
  EvalContextExclusion,
  EvalExpectation,
  EvalExpectationKind,
  EvalMetricDelta,
  EvalPerTrace,
  EvalPromptDiffLine,
  EvalRun,
  EvalRunRecord,
  Finding,
  LLMProvider,
  ReviewStrategy,
  UnifiedDiff,
} from '@devdigest/shared';
import type { ReviewInput } from '@devdigest/reviewer-core';
import { ValidationError } from '../../platform/errors.js';
import type { EvalCaseRow } from './repository/case.repo.js';
import type { EvalCaseResultRow, EvalSuiteRunRow } from './repository/run.repo.js';
import { aggregate, scoreCase, type RunCaseInput, type RunMetrics } from './scoring.js';

/**
 * modules/evals/helpers.ts — pure transforms (`onion-architecture` ring 2).
 * No DB, no fastify, no I/O — every function here is callable with plain
 * arguments and asserted directly by `eval-helpers.test.ts` (T17).
 */

/** The polarity shared by every expectation in a validated array. Real
 *  persisted expectations are always non-empty and single-kind (AC-8/AC-9),
 *  so this only needs the first entry. */
export function polarityOf(expectations: EvalExpectation[]): EvalExpectationKind {
  return expectations[0]?.kind ?? 'must_find';
}

/** AC-9 — reject anything that is not a non-empty, single-kind list. Each
 *  entry's file/start_line/end_line shape is already enforced by the zod
 *  `EvalExpectation` schema before this runs. */
export function validateExpectations(expectations: EvalExpectation[]): void {
  if (expectations.length === 0) {
    throw new ValidationError('At least one expectation is required.', {
      field: 'expectations',
    });
  }
  const kinds = new Set(expectations.map((e) => e.kind));
  if (kinds.size > 1) {
    throw new ValidationError('Expectations must all be the same kind.', {
      field: 'expectations',
    });
  }
}

/**
 * Resolve what an eval case's stored expectations should become given an
 * (optional) incoming replacement:
 *
 * | stored polarity      | incoming             | result              |
 * |-----------------------|-----------------------|---------------------|
 * | any                   | undefined             | keep `stored`       |
 * | must_not_flag         | []                    | keep `stored` (AC-8)|
 * | must_find / new case  | []                    | reject (AC-9)       |
 * | any                   | non-empty, mixed kinds| reject (AC-9)       |
 * | any                   | non-empty, one kind   | replace             |
 *
 * `stored === null` means "no case exists yet" (the create path).
 */
export function resolveExpectations(
  stored: EvalExpectation[] | null,
  incoming: EvalExpectation[] | undefined,
): EvalExpectation[] {
  if (incoming === undefined) {
    if (stored === null) {
      throw new ValidationError('At least one expectation is required.', {
        field: 'expectations',
      });
    }
    return stored;
  }

  if (incoming.length === 0) {
    if (stored !== null && polarityOf(stored) === 'must_not_flag') {
      return stored; // AC-8 — the negative projection round-trips as empty.
    }
    throw new ValidationError(
      'At least one expectation is required for a must-find case.',
      { field: 'expectations' },
    );
  }

  validateExpectations(incoming);
  return incoming;
}

/**
 * Module-local shape for the finding fields `seedExpectationFrom` needs.
 * Deliberately NOT `FindingRow` from `../../db/rows.js` — row types die at
 * the repository boundary and must not cross into ring 2
 * (`onion-architecture`, "What crosses each boundary"). Field names mirror
 * the row's own camelCase names so a caller mapping a `FindingRow` at the
 * repository/service boundary can pass the mapped value straight through.
 */
export interface EvalSeedFinding {
  file: string;
  startLine: number;
  endLine: number;
  title: string;
  severity: string;
  category: string;
  acceptedAt: Date | null;
}

/** AC-3 — prefill a single expectation from a finding's own location and
 *  decision: accepted → must_find, dismissed → must_not_flag. */
export function seedExpectationFrom(finding: EvalSeedFinding): EvalExpectation {
  return {
    kind: finding.acceptedAt != null ? 'must_find' : 'must_not_flag',
    file: finding.file,
    start_line: finding.startLine,
    end_line: finding.endLine,
    title: finding.title,
    severity: finding.severity,
    category: finding.category,
  };
}

/**
 * AC-11 — the input assembled for evaluating a case consists of exactly:
 * the frozen diff, the agent's system prompt, model, strategy, linked
 * skills and project-context attachments — and NOTHING else. `callers`,
 * `repoMap`, `prDescription`, `intent`, `task` and `memory` are never set;
 * `skills`/`specs` are omitted (not emitted as empty arrays) when there is
 * nothing to carry, and `sessionId` is forwarded straight to the LLM call,
 * never into prompt content.
 */
export function buildEvalReviewInput(args: {
  systemPrompt: string;
  model: string;
  strategy: ReviewStrategy;
  diff: UnifiedDiff;
  llm: LLMProvider;
  skills: string[];
  specs: { path: string; text: string }[];
  sessionId?: string;
}): ReviewInput {
  return {
    systemPrompt: args.systemPrompt,
    model: args.model,
    strategy: args.strategy,
    diff: args.diff,
    llm: args.llm,
    ...(args.skills.length > 0 ? { skills: args.skills } : {}),
    ...(args.specs.length > 0 ? { specs: args.specs } : {}),
    ...(args.sessionId !== undefined ? { sessionId: args.sessionId } : {}),
  };
}

/** Map a persisted (joined) case row + resolved repo name + last outcome
 *  into the `EvalCase` DTO. Pure — the repository resolves the join,
 *  `EvalRunRepository` resolves the last outcome; this only assembles them. */
export function caseRowToDto(
  row: EvalCaseRow,
  repoFullName: string | null,
  lastOutcome: EvalPerTrace | null,
): EvalCase {
  const expectations = ((row.expectedOutput as EvalExpectation[] | null) ?? []) as EvalExpectation[];
  const hasOrigin = row.originFindingId != null || row.originPrId != null;
  const origin: EvalCaseOrigin | null = hasOrigin
    ? {
        finding_id: row.originFindingId,
        pr_id: row.originPrId,
        pr_number: row.originPrNumber,
        finding_title: row.originFindingTitle,
      }
    : null;

  return {
    id: row.id,
    owner_kind: row.ownerKind,
    owner_id: row.ownerId,
    name: row.name,
    input_diff: row.inputDiff,
    repo_id: row.repoId,
    repo_full_name: repoFullName,
    expectations,
    polarity: polarityOf(expectations),
    origin,
    notes: row.notes,
    // AC-50 — content-only evals never resolve project context (AC-11 / AC-49).
    resolves_context: false,
    last_outcome: lastOutcome,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

/**
 * AC-49 — a case with no repository association resolves NO context, and
 * the resolver is not called at all (kept as an injected seam so this stays
 * pure and independently testable — see `contextInputFor` callers in
 * `service.ts`, which pass `ContextService.assembleForRun` bound to the
 * case's agent).
 */
export function contextInputFor(
  caseRepoId: string | null,
  resolve: (repoId: string) => Promise<AssembledRunContext>,
): Promise<AssembledRunContext> {
  if (caseRepoId === null) {
    return Promise.resolve({ documents: [], excluded: [] });
  }
  return resolve(caseRepoId);
}

// ===========================================================================
// Suite-run metrics, deltas, comparison (Phase B — T1-T5)
// ===========================================================================

/**
 * AC-15..AC-18/AC-29 — a run's aggregate metrics from its persisted (frozen)
 * case results. Thin adapter over Phase A's `aggregate` (`scoring.ts`): maps
 * each `eval_case_results` row into the `RunCaseInput` shape `aggregate`
 * expects — for a non-errored row, `scoreCase` is RECOMPUTED from the row's
 * own frozen `caseExpectations` + persisted grounded `findings` +
 * `rawFindingsCount`, rather than trusting a separately-stored `passed`
 * flag, so this can never drift from the scorer that produced the row.
 * Returns `null` when every case in `results` errored (AC-29) — a run with
 * NO metrics, not a run with all-zero metrics.
 */
export function runMetricsFrom(results: EvalCaseResultRow[]): RunMetrics | null {
  if (results.length === 0) return null;
  if (results.every((r) => r.status === 'errored')) return null;

  const cases: RunCaseInput[] = results.map((r) => {
    const expectations = (r.caseExpectations as EvalExpectation[] | null) ?? [];
    const polarity = polarityOf(expectations);
    if (r.status === 'errored') {
      return { polarity, errored: true, score: null };
    }
    const grounded = (r.findings as Finding[] | null) ?? [];
    return {
      polarity,
      errored: false,
      score: scoreCase(expectations, grounded, r.rawFindingsCount),
    };
  });

  return aggregate(cases);
}

function diffNullable(later: number | null, earlier: number | null): number | null {
  if (later == null || earlier == null) return null;
  return later - earlier;
}

/**
 * AC-38 — per-metric difference of `later` against `earlier` (the
 * immediately preceding COMPLETED run of the same agent, resolved by the
 * caller — see `EvalService.listRuns`/`compareRuns`). `null` for every
 * metric whose EITHER side is `null` (an unavailable value never turns a
 * delta into a misleading zero), and `null` outright — not an
 * all-null object — when there IS no earlier run.
 */
export function metricDelta(
  later: EvalSuiteRunRow,
  earlier: EvalSuiteRunRow | null,
): EvalMetricDelta | null {
  if (!earlier) return null;
  return {
    recall: diffNullable(later.recall, earlier.recall),
    precision: diffNullable(later.precision, earlier.precision),
    citation_accuracy: diffNullable(later.citationAccuracy, earlier.citationAccuracy),
    cost_usd: diffNullable(later.costUsd, earlier.costUsd),
  };
}

/** Map a persisted run row + its (already-resolved) delta into the
 *  `EvalRunRecord` list-row DTO (AC-36/AC-38). Shared by
 *  `EvalService.listRuns` and `buildComparison` so the two never disagree
 *  on what a run "looks like" in a list. */
export function evalRunRecord(
  row: EvalSuiteRunRow,
  delta: EvalMetricDelta | null,
): EvalRunRecord {
  return {
    id: row.id,
    agent_id: row.agentId,
    started_at: row.startedAt.toISOString(),
    state: row.state,
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    traces_passed: row.passedCount,
    traces_total: row.casesTotal,
    errored_count: row.erroredCount,
    cost_usd: row.costUsd,
    duration_ms: row.durationMs,
    delta,
  };
}

/**
 * AC-41 — a deterministic longest-common-subsequence line diff between two
 * prompt strings. No fuzzy matching, no dependency (constraint 14): a
 * classic O(n*m) LCS table over lines, walked back to emit `same` /
 * `removed` / `added` runs. Identical inputs produce only `same` lines.
 */
export function diffPromptLines(earlier: string, later: string): EvalPromptDiffLine[] {
  const a = earlier.split('\n');
  const b = later.split('\n');
  const n = a.length;
  const m = b.length;

  // dp[i][j] = length of the LCS of a[i..] and b[j..].
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const out: EvalPromptDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]! });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ kind: 'removed', text: a[i]! });
      i += 1;
    } else {
      out.push({ kind: 'added', text: b[j]! });
      j += 1;
    }
  }
  while (i < n) {
    out.push({ kind: 'removed', text: a[i]! });
    i += 1;
  }
  while (j < m) {
    out.push({ kind: 'added', text: b[j]! });
    j += 1;
  }
  return out;
}

/** AC-53's dedup key — repo-scoped path, since the same relative path in two
 *  different repositories is a different document. */
export function contextKey(d: EvalContextDocument): string {
  return `${d.repo_id ?? ''}:${d.path}`;
}

/**
 * AC-53 — fold one case's resolved context into the run's running captured
 * context: union across cases, first occurrence of a `contextKey` wins
 * (later cases don't overwrite an already-captured document's text), and
 * excluded entries are deduped by `path + reason`.
 */
export function mergeCapturedContext(
  prev: EvalCapturedContext,
  next: { documents: EvalContextDocument[]; excluded: EvalContextExclusion[] },
): EvalCapturedContext {
  const documents = [...prev.documents];
  const seenDocKeys = new Set(documents.map(contextKey));
  for (const d of next.documents) {
    const key = contextKey(d);
    if (seenDocKeys.has(key)) continue;
    seenDocKeys.add(key);
    documents.push(d);
  }

  const excluded = [...prev.excluded];
  const exclusionKey = (e: EvalContextExclusion) => `${e.path} ${e.reason}`;
  const seenExclusionKeys = new Set(excluded.map(exclusionKey));
  for (const e of next.excluded) {
    const key = exclusionKey(e);
    if (seenExclusionKeys.has(key)) continue;
    seenExclusionKeys.add(key);
    excluded.push(e);
  }

  return { documents, excluded };
}

const COMPARISON_METRIC_KEYS = ['recall', 'precision', 'citation_accuracy', 'cost_usd'] as const;

function metricValue(row: EvalSuiteRunRow, key: (typeof COMPARISON_METRIC_KEYS)[number]): number | null {
  switch (key) {
    case 'recall':
      return row.recall;
    case 'precision':
      return row.precision;
    case 'citation_accuracy':
      return row.citationAccuracy;
    case 'cost_usd':
      return row.costUsd;
  }
}

/** AC-42 — the set of case identities a run's frozen results represent, for
 *  set comparison. Falls back to `case_name` for a result whose `case_id`
 *  has since gone `null` (its case was deleted — schema `ON DELETE SET
 *  NULL`), so a deleted case still counts as "the same case" across two
 *  runs that both captured it before the delete. */
function caseIdentity(r: EvalCaseResultRow): string {
  return r.caseId ?? `name:${r.caseName}`;
}

/**
 * AC-40, AC-42, AC-54 — assemble a two-run comparison. Reorders its inputs
 * earlier-first by `started_at` regardless of the order the caller passed
 * them in, so `compareRuns(a, b)` and `compareRuns(b, a)` produce the same
 * comparison. `later`'s `delta` is this comparison's own
 * earlier→later `metricDelta`; `earlier` has no predecessor within this
 * function's inputs, so its `delta` is `null`.
 */
export function buildComparison(
  runA: EvalSuiteRunRow,
  runB: EvalSuiteRunRow,
  resultsA: EvalCaseResultRow[],
  resultsB: EvalCaseResultRow[],
): EvalComparison {
  const aFirst = runA.startedAt.getTime() <= runB.startedAt.getTime();
  const earlierRun = aFirst ? runA : runB;
  const laterRun = aFirst ? runB : runA;
  const earlierResults = aFirst ? resultsA : resultsB;
  const laterResults = aFirst ? resultsB : resultsA;

  const delta = metricDelta(laterRun, earlierRun);
  const metrics: EvalComparisonMetric[] = COMPARISON_METRIC_KEYS.map((key) => ({
    key,
    earlier: metricValue(earlierRun, key),
    later: metricValue(laterRun, key),
    delta: delta ? delta[key] : null,
  }));

  const earlierCaseIds = new Set(earlierResults.map(caseIdentity));
  const laterCaseIds = new Set(laterResults.map(caseIdentity));
  const caseSetsDiffer =
    earlierCaseIds.size !== laterCaseIds.size ||
    [...earlierCaseIds].some((id) => !laterCaseIds.has(id));

  const earlierContext = earlierRun.capturedContext as EvalCapturedContext;
  const laterContext = laterRun.capturedContext as EvalCapturedContext;
  const earlierDocsByKey = new Map(earlierContext.documents.map((d) => [contextKey(d), d.text]));
  const laterDocsByKey = new Map(laterContext.documents.map((d) => [contextKey(d), d.text]));
  const contextDiffers =
    earlierDocsByKey.size !== laterDocsByKey.size ||
    [...earlierDocsByKey].some(([key, text]) => laterDocsByKey.get(key) !== text) ||
    [...laterDocsByKey.keys()].some((key) => !earlierDocsByKey.has(key));

  return {
    earlier: evalRunRecord(earlierRun, null),
    later: evalRunRecord(laterRun, delta),
    metrics,
    prompt_diff: diffPromptLines(earlierRun.systemPrompt, laterRun.systemPrompt),
    case_sets_differ: caseSetsDiffer,
    earlier_case_count: earlierResults.length,
    later_case_count: laterResults.length,
    context_differs: contextDiffers,
  };
}

// ===========================================================================
// Row → API-shape mappers (`onion-architecture` "Turning a row into an API
// shape → ring 2, helpers.ts (pure)") — shared by the runner (which builds
// the `EvalRun` `start()` returns) and the service (`getRun`/`compareRuns`).
// ===========================================================================

/** One frozen `eval_case_results` row → its `EvalPerTrace` DTO. `stored` is
 *  always `true` here — this mapper is only ever used for a PERSISTED
 *  result row; `evaluateOne`'s own (unpersisted) `EvalPerTrace` sets
 *  `stored: false` itself and never goes through this function. */
export function caseResultToTrace(row: EvalCaseResultRow): EvalPerTrace {
  return {
    case_id: row.caseId,
    name: row.caseName,
    status: row.status,
    pass: row.status === 'passed',
    errored: row.status === 'errored',
    error: row.error,
    findings: (row.findings as Finding[] | null) ?? [],
    raw_findings_count: row.rawFindingsCount,
    expected_count: row.expectedCount,
    matched_count: row.matchedCount,
    cost_usd: row.costUsd,
    duration_ms: row.durationMs,
    stored: true,
  };
}

/** A persisted `eval_suite_runs` row + its frozen case results → the
 *  `EvalRun` DTO. `agentName` is `null` when the owning agent has since been
 *  deleted (the FK is `ON DELETE CASCADE` on `eval_suite_runs.agentId`, so
 *  in practice this only happens for a row read mid-delete — kept
 *  nullable to match `EvalRun.agent_name`'s own contract). */
export function runToEvalRun(
  row: EvalSuiteRunRow,
  agentName: string | null,
  results: EvalCaseResultRow[],
): EvalRun {
  const skills = (row.skills as { name: string; body: string }[] | null) ?? [];
  return {
    id: row.id,
    agent_id: row.agentId,
    agent_name: agentName,
    state: row.state,
    started_at: row.startedAt.toISOString(),
    finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
    system_prompt: row.systemPrompt,
    provider: row.provider,
    model: row.model,
    strategy: row.strategy,
    skills: skills.map((s) => s.name),
    captured_context: row.capturedContext as EvalCapturedContext,
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    traces_passed: row.passedCount,
    traces_total: row.casesTotal,
    errored_count: row.erroredCount,
    duration_ms: row.durationMs,
    cost_usd: row.costUsd,
    per_trace: results.map(caseResultToTrace),
  };
}
