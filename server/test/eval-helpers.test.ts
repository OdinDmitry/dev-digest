import { describe, it, expect, vi, afterEach } from 'vitest';
import type {
  AssembledRunContext,
  EvalExpectation,
  LLMProvider,
  UnifiedDiff,
} from '@devdigest/shared';
import type { FindingRow } from '../src/db/rows.js';
import {
  polarityOf,
  resolveExpectations,
  seedExpectationFrom,
  buildEvalReviewInput,
  contextInputFor,
} from '../src/modules/evals/helpers.js';

/**
 * `EvalSuiteRunner.evaluateOne`'s call into `reviewPullRequest` — mocked at
 * the `@devdigest/reviewer-core` module boundary so the ReviewInput object
 * IT ACTUALLY BUILDS (via `buildEvalReviewInput`) can be inspected directly,
 * rather than trusting that the runner uses the already-unit-tested helper
 * correctly and adds nothing extra afterward (T17 — re-asserts AC-11 at the
 * runner's call site, not just the helper's).
 */
const reviewPullRequestMock = vi.fn();
vi.mock('@devdigest/reviewer-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@devdigest/reviewer-core')>();
  return {
    ...actual,
    reviewPullRequest: (...args: Parameters<typeof actual.reviewPullRequest>) =>
      reviewPullRequestMock(...args),
  };
});
const { EvalSuiteRunner } = await import('../src/modules/evals/runner.js');
type EvaluateOneInput = import('../src/modules/evals/runner.js').EvaluateOneInput;

/**
 * Hermetic unit tests over `modules/evals/helpers.ts`
 * (`docs/plans/2026-08-22-eval-pipeline-a-foundation.md` T17, T21). Covers
 * AC-8, AC-9, AC-11, AC-49.
 */

function mkExpectation(overrides: Partial<EvalExpectation> = {}): EvalExpectation {
  return {
    kind: 'must_find',
    file: 'src/x.ts',
    start_line: 10,
    end_line: 10,
    title: null,
    severity: null,
    category: null,
    ...overrides,
  };
}

let findingSeq = 0;
function mkFindingRow(overrides: Partial<FindingRow> = {}): FindingRow {
  findingSeq += 1;
  return {
    id: `finding-${findingSeq}`,
    reviewId: 'review-1',
    file: 'src/x.ts',
    startLine: 10,
    endLine: 10,
    severity: 'CRITICAL',
    category: 'security',
    title: 'A finding',
    rationale: 'r',
    suggestion: null,
    confidence: 0.9,
    kind: 'finding',
    trifectaComponents: null,
    acceptedAt: null,
    dismissedAt: null,
    ...overrides,
  } as FindingRow;
}

describe('resolveExpectations — the decision table (AC-8, AC-9)', () => {
  it('row 1: incoming undefined, stored non-null → keeps stored', () => {
    const stored = [mkExpectation({ kind: 'must_find' })];
    expect(resolveExpectations(stored, undefined)).toBe(stored);
  });

  it('row 2 (AC-8): incoming [], stored must_not_flag → keeps stored', () => {
    const stored = [mkExpectation({ kind: 'must_not_flag' })];
    expect(resolveExpectations(stored, [])).toBe(stored);
  });

  it('row 3a (AC-9 rejection): incoming [], stored must_find → rejected', () => {
    const stored = [mkExpectation({ kind: 'must_find' })];
    expect(() => resolveExpectations(stored, [])).toThrow(/expectation/i);
  });

  it('row 3b (AC-9 rejection): incoming [], stored null (new case) → rejected', () => {
    expect(() => resolveExpectations(null, [])).toThrow(/expectation/i);
  });

  it('row 3c (AC-9 rejection): incoming undefined, stored null (new case, nothing at all) → rejected', () => {
    expect(() => resolveExpectations(null, undefined)).toThrow(/expectation/i);
  });

  it('row 4 (AC-9 rejection): non-empty incoming with mixed kinds → rejected', () => {
    const incoming = [
      mkExpectation({ kind: 'must_find' }),
      mkExpectation({ kind: 'must_not_flag' }),
    ];
    expect(() => resolveExpectations(null, incoming)).toThrow(/same kind/i);
    expect(() => resolveExpectations([mkExpectation()], incoming)).toThrow(/same kind/i);
  });

  it('row 5: non-empty incoming, single kind → replaces (regardless of stored)', () => {
    const incoming = [mkExpectation({ kind: 'must_not_flag', file: 'src/new.ts' })];
    expect(resolveExpectations(null, incoming)).toBe(incoming);
    expect(resolveExpectations([mkExpectation({ kind: 'must_find' })], incoming)).toBe(incoming);
  });
});

describe('polarityOf', () => {
  it('returns the kind shared by a non-empty expectations array', () => {
    expect(polarityOf([mkExpectation({ kind: 'must_not_flag' })])).toBe('must_not_flag');
    expect(polarityOf([mkExpectation({ kind: 'must_find' })])).toBe('must_find');
  });
});

describe('seedExpectationFrom (AC-3)', () => {
  it('an accepted finding seeds a must_find expectation at the finding location', () => {
    const finding = mkFindingRow({
      file: 'src/config.ts',
      startLine: 12,
      endLine: 12,
      acceptedAt: new Date(),
      dismissedAt: null,
    });
    const expectation = seedExpectationFrom(finding);
    expect(expectation.kind).toBe('must_find');
    expect(expectation.file).toBe('src/config.ts');
    expect(expectation.start_line).toBe(12);
    expect(expectation.end_line).toBe(12);
  });

  it('a dismissed finding seeds a must_not_flag expectation at the finding location', () => {
    const finding = mkFindingRow({
      file: 'src/config.ts',
      startLine: 12,
      endLine: 12,
      acceptedAt: null,
      dismissedAt: new Date(),
    });
    const expectation = seedExpectationFrom(finding);
    expect(expectation.kind).toBe('must_not_flag');
  });
});

describe('buildEvalReviewInput (AC-11)', () => {
  const diff: UnifiedDiff = { raw: '', files: [] };
  const llm = {} as unknown as LLMProvider;

  it('sets no callers/repoMap/prDescription/intent/task/memory, and omits skills/specs when empty', () => {
    const input = buildEvalReviewInput({
      systemPrompt: 'You review PRs.',
      model: 'gpt-4.1',
      strategy: 'single-pass',
      diff,
      llm,
      skills: [],
      specs: [],
    });

    const keys = Object.keys(input);
    for (const forbidden of ['callers', 'repoMap', 'prDescription', 'intent', 'task', 'memory']) {
      expect(keys).not.toContain(forbidden);
    }
    // Absent, not present-as-empty-array.
    expect(keys).not.toContain('skills');
    expect(keys).not.toContain('specs');
    expect(input).toMatchObject({
      systemPrompt: 'You review PRs.',
      model: 'gpt-4.1',
      strategy: 'single-pass',
      diff,
      llm,
    });
  });

  it('includes skills/specs (non-empty) and sessionId when provided', () => {
    const input = buildEvalReviewInput({
      systemPrompt: 'You review PRs.',
      model: 'gpt-4.1',
      strategy: 'single-pass',
      diff,
      llm,
      skills: ['sec-basics'],
      specs: [{ path: 'specs/a.md', text: 'x' }],
      sessionId: 'sess-1',
    });
    expect(input).toMatchObject({
      skills: ['sec-basics'],
      specs: [{ path: 'specs/a.md', text: 'x' }],
      sessionId: 'sess-1',
    });
  });
});

describe('contextInputFor (AC-49, T21)', () => {
  it('a null repo id resolves { documents: [], excluded: [] } WITHOUT calling the resolver', async () => {
    const resolve = vi.fn<(repoId: string) => Promise<AssembledRunContext>>();

    const result = await contextInputFor(null, resolve);

    expect(result).toEqual({ documents: [], excluded: [] });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('a non-null repo id delegates to the resolver with that id', async () => {
    const assembled: AssembledRunContext = {
      documents: [{ path: 'README.md', text: 'hi' }],
      excluded: [],
    };
    const resolve = vi.fn().mockResolvedValue(assembled);

    const result = await contextInputFor('repo-123', resolve);

    expect(resolve).toHaveBeenCalledWith('repo-123');
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(result).toBe(assembled);
  });
});

describe("EvalSuiteRunner.evaluateOne's assembled review input at the runner call site (T17, AC-11)", () => {
  const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

  afterEach(() => {
    reviewPullRequestMock.mockReset();
  });

  it('carries exactly the captured system prompt, model, strategy, skills and documents (as specs) — and nothing else', async () => {
    reviewPullRequestMock.mockResolvedValue({
      review: { verdict: 'approve', summary: 'clean', score: 100, findings: [] },
      dropped: [],
      costUsd: 0.01,
    });

    const runner = new EvalSuiteRunner({
      repo: {} as never,
      agents: {} as never,
      buildContext: () => ({}) as never,
      llm: async () => ({}) as LLMProvider,
    });

    const input: EvaluateOneInput = {
      systemPrompt: 'You review PRs for security issues.',
      provider: 'openai',
      model: 'gpt-4.1',
      strategy: 'single-pass',
      skills: ['sec-basics'],
      documents: [{ path: 'specs/a.md', text: 'a spec, verbatim' }],
      inputDiff: DIFF,
      expectations: [],
      sessionId: 'eval:run-1:result-1',
    };

    await runner.evaluateOne(input);

    expect(reviewPullRequestMock).toHaveBeenCalledTimes(1);
    const reviewInput = reviewPullRequestMock.mock.calls[0]![0] as Record<string, unknown>;

    // Exactly these keys — no callers/repoMap/prDescription/intent/task/memory,
    // and skills/specs/sessionId only because THIS input supplied them.
    expect(Object.keys(reviewInput).sort()).toEqual(
      ['diff', 'llm', 'model', 'sessionId', 'skills', 'specs', 'strategy', 'systemPrompt'].sort(),
    );
    expect(reviewInput.systemPrompt).toBe(input.systemPrompt);
    expect(reviewInput.model).toBe(input.model);
    expect(reviewInput.strategy).toBe(input.strategy);
    expect(reviewInput.skills).toEqual(input.skills);
    expect(reviewInput.specs).toEqual(input.documents);
    expect(reviewInput.sessionId).toBe(input.sessionId);
  });

  it('omits skills/specs/sessionId entirely (not as empty arrays / undefined keys) when the input carries none', async () => {
    reviewPullRequestMock.mockResolvedValue({
      review: { verdict: 'approve', summary: 'clean', score: 100, findings: [] },
      dropped: [],
      costUsd: 0.01,
    });

    const runner = new EvalSuiteRunner({
      repo: {} as never,
      agents: {} as never,
      buildContext: () => ({}) as never,
      llm: async () => ({}) as LLMProvider,
    });

    const input: EvaluateOneInput = {
      systemPrompt: 'You review PRs.',
      provider: 'openai',
      model: 'gpt-4.1',
      strategy: 'single-pass',
      skills: [],
      documents: [],
      inputDiff: DIFF,
      expectations: [],
      sessionId: 'eval:run-2:result-1',
    };

    await runner.evaluateOne(input);

    const reviewInput = reviewPullRequestMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(reviewInput)).not.toContain('skills');
    expect(Object.keys(reviewInput)).not.toContain('specs');
    for (const forbidden of ['callers', 'repoMap', 'prDescription', 'intent', 'task', 'memory']) {
      expect(Object.keys(reviewInput)).not.toContain(forbidden);
    }
  });
});
