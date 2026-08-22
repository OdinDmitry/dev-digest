import type {
  AssembledRunContext,
  EvalCase,
  EvalCaseOrigin,
  EvalExpectation,
  EvalExpectationKind,
  EvalPerTrace,
  LLMProvider,
  ReviewStrategy,
  UnifiedDiff,
} from '@devdigest/shared';
import type { ReviewInput } from '@devdigest/reviewer-core';
import { ValidationError } from '../../platform/errors.js';
import type { EvalCaseRow } from './repository/case.repo.js';

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
