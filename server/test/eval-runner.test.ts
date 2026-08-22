/**
 * T27 / D26 — hermetic unit tests for `EvalRunner` (`modules/eval/runner.ts`).
 * `reviewer-core`'s `reviewPullRequest` is WRAPPED, not replaced, via
 * `vi.mock` + `importOriginal`: every call still runs the REAL engine (real
 * prompt assembly, real grounding gate) while this file also captures the
 * exact `ReviewInput` object each call received — that capture is what
 * AC-17/AC-18 assert on. The LLM underneath is a hand-rolled counting
 * `LLMProvider` (the `brief.it.test.ts` shape), so "zero model calls on the
 * scoring path" (AC-29) and "exactly one call per case" are provable by a
 * call count, not by inference.
 *
 * `EvalRepository` is a concrete class (private `db` field), so its stub is
 * cast `as unknown as EvalRepository` — the same pattern `brief.test.ts` uses
 * for a fake `Container`. `agents: Pick<AgentsRepository, 'linkedSkills' | 'getConfigById'>`
 * is a plain interface, so a bare object satisfies it once its `skill`
 * fixture is cast to the real row type (only the fields the runner reads
 * are given real values) — `getConfigById` needs no such cast, since it
 * already returns the `AgentConfig` (= `EvalAgentConfig`) shape directly.
 *
 * SPEC-04 delta (D26): the stub repository now also implements
 * `writeLatestResult`/`getCase` — `execute()` calls `writeLatestResult` once
 * per case (AC-48) and `verifyCase()` calls both. Before this file supplied
 * `writeLatestResult`, every test in this file that starts a run failed after
 * the first case (the stub threw `TypeError: repo.writeLatestResult is not a
 * function`, caught by `execute()`'s outer try/catch and reported as a
 * `'failed'` run) — a mechanical break, not a behavioural one; the plan's D26
 * task exists specifically to add the stub method back.
 *
 * Post-D26 architecture fix: `architecture-reviewer` found `AgentRow` (a DB
 * row type) still crossing into ring 2 via `toEvalAgentConfig`, which had
 * simply moved from `service.ts` into this file's `runner.ts` in the delta.
 * Closed at the repository boundary instead — `AgentsRepository.getConfigById`
 * narrows internally (`agents/helpers.ts::toAgentConfig`) and hands back the
 * config shape directly, so `EvalRunnerDeps.agents` is now
 * `Pick<AgentsRepository, 'linkedSkills' | 'getConfigById'>` and `verifyCase()`
 * no longer narrows anything itself. The three `verifyCase`-driven tests
 * below were updated to stub `getConfigById` returning the fixture
 * `EvalAgentConfig` as-is — no row-shaping wrapper needed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EvalCaseRecord, LLMProvider, StructuredRequest, StructuredResult } from '@devdigest/shared';
import type { EvalRepository } from '../src/modules/eval/repository.js';
import type { LinkedSkillRow, AgentsRepository } from '../src/modules/agents/repository.js';

const { reviewInputs } = vi.hoisted(() => ({ reviewInputs: [] as Record<string, unknown>[] }));

vi.mock('@devdigest/reviewer-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@devdigest/reviewer-core')>();
  return {
    ...actual,
    reviewPullRequest: vi.fn(async (input: Record<string, unknown>) => {
      reviewInputs.push(input);
      return actual.reviewPullRequest(input as Parameters<typeof actual.reviewPullRequest>[0]);
    }),
  };
});

// `vi.mock` above is hoisted by vitest above every import in this file, so a
// plain static import of the (real) module under test still picks up the
// mocked `reviewer-core` dependency it imports internally.
import { EvalRunner, type EvalAgentConfig } from '../src/modules/eval/runner.js';

afterEach(() => {
  reviewInputs.length = 0;
  vi.clearAllMocks();
});

// ---- fixtures -------------------------------------------------------------

const FRAGMENT_A = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,3 @@',
  ' function a() {',
  '+  doSomething();',
  ' }',
].join('\n');

function makeCase(overrides: Partial<EvalCaseRecord> = {}): EvalCaseRecord {
  return {
    id: 'case-1',
    agent_id: 'agent-1',
    name: 'a case',
    source_finding_id: 'finding-1',
    file: 'src/a.ts',
    start_line: 2,
    end_line: 2,
    fragment: FRAGMENT_A,
    expectations: [],
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeAgent(overrides: Partial<EvalAgentConfig> = {}): EvalAgentConfig {
  return {
    id: 'agent-1',
    name: 'Security Reviewer',
    version: 3,
    provider: 'openai',
    model: 'gpt-4o-mini',
    systemPrompt: 'Review the diff for security issues.',
    ...overrides,
  };
}

/** A no-findings `Review` fixture — passes the schema and keeps the
 *  grounding gate irrelevant to tests that don't care about it. */
function reviewFixture(overrides: Record<string, unknown> = {}) {
  return { verdict: 'comment', summary: 'Looks fine.', score: 95, findings: [], ...overrides };
}

type Step = Record<string, unknown> | 'ERROR';

/** A hand-rolled counting `LLMProvider`. With `blocking: true`, every call
 *  awaits a manually-released deferred promise — this is what lets the
 *  progress test observe "N of M" mid-run instead of racing a resolved run. */
function makeLLM(steps: Step[] = [], opts: { blocking?: boolean } = {}) {
  const calls: { req: StructuredRequest<unknown> }[] = [];
  const pending: { resolve: () => void }[] = [];
  let i = 0;
  const llm: LLMProvider = {
    id: 'openai',
    async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
      calls.push({ req: req as StructuredRequest<unknown> });
      if (opts.blocking) {
        await new Promise<void>((resolve) => pending.push({ resolve }));
      }
      const step = steps[i];
      i++;
      if (step === 'ERROR') throw new Error('mock model call failed');
      const fixture = step ?? reviewFixture();
      const parsed = req.schema.safeParse(fixture);
      if (!parsed.success) {
        throw new Error(`mock fixture did not match schema ${req.schemaName}: ${parsed.error.message}`);
      }
      return {
        data: parsed.data,
        model: req.model,
        tokensIn: 10,
        tokensOut: 5,
        costUsd: 0.001,
        raw: JSON.stringify(fixture),
        attempts: 1,
      };
    },
    async listModels() {
      return [];
    },
    async complete() {
      throw new Error('not used in these tests');
    },
    async embed() {
      return [];
    },
  };
  return {
    llm,
    calls,
    releaseNext: () => {
      const p = pending.shift();
      p?.resolve();
    },
    pendingCount: () => pending.length,
  };
}

interface RepoStub {
  repo: EvalRepository;
  recordCalls: { suiteRunId: string; caseId: string; result: Record<string, unknown> }[];
  bumpCalls: string[];
  finalizeCalls: { suiteRunId: string; values: Record<string, unknown> }[];
  writeLatestResultCalls: { caseId: string; snapshot: Record<string, unknown> }[];
}

/** A stub `EvalRepository` — tracks every write the runner makes without
 *  touching a database. `listCasesForAgent`/`getCase`/`startSuiteRun` are
 *  seeded from `cases`; everything else records its call for assertions.
 *  `getCase` reflects back the most recent `writeLatestResult` snapshot for
 *  that case id — `verifyCase()` re-reads the case after writing it, and a
 *  stub that always returned the ORIGINAL (pre-write) row would let a bug
 *  that never actually wrote `latest_result` pass unnoticed. */
function makeRepoStub(cases: EvalCaseRecord[]): RepoStub {
  const recordCalls: RepoStub['recordCalls'] = [];
  const bumpCalls: string[] = [];
  const finalizeCalls: RepoStub['finalizeCalls'] = [];
  const writeLatestResultCalls: RepoStub['writeLatestResultCalls'] = [];
  const latestResultByCase = new Map<string, unknown>();
  const repo = {
    listCasesForAgent: vi.fn(async () => cases),
    getCase: vi.fn(async (_workspaceId: string, caseId: string) => {
      const found = cases.find((c) => c.id === caseId);
      if (!found) return undefined;
      return latestResultByCase.has(caseId)
        ? { ...found, latest_result: latestResultByCase.get(caseId) }
        : found;
    }),
    startSuiteRun: vi.fn(async (values: Record<string, unknown>) => ({
      id: 'suite-run-1',
      agent_id: values.agentId,
      agent_name: values.agentName,
      agent_version: values.agentVersion,
      invoked_skills: (
        values.invokedSkills as { skillId: string; skillVersion: number; skillName: string }[]
      ).map((s) => ({ skill_id: s.skillId, skill_version: s.skillVersion, name: s.skillName })),
      status: 'running',
      started_at: new Date().toISOString(),
      completed_at: null,
      cases_total: (values.caseIds as string[]).length,
      cases_completed: 0,
      cases_passed: null,
      cases_failed_to_complete: 0,
      recall: null,
      precision: null,
      citation_accuracy: null,
      cost_usd: null,
      case_ids: values.caseIds,
    })),
    recordCaseResult: vi.fn(async (suiteRunId: string, caseId: string, result: Record<string, unknown>) => {
      recordCalls.push({ suiteRunId, caseId, result });
    }),
    bumpCaseProgress: vi.fn(async (suiteRunId: string) => {
      bumpCalls.push(suiteRunId);
    }),
    finalizeSuiteRun: vi.fn(async (suiteRunId: string, values: Record<string, unknown>) => {
      finalizeCalls.push({ suiteRunId, values });
    }),
    writeLatestResult: vi.fn(async (caseId: string, snapshot: Record<string, unknown>) => {
      writeLatestResultCalls.push({ caseId, snapshot });
      latestResultByCase.set(caseId, snapshot);
    }),
  };
  return { repo: repo as unknown as EvalRepository, recordCalls, bumpCalls, finalizeCalls, writeLatestResultCalls };
}

/** `agents` dep satisfying `Pick<AgentsRepository, 'linkedSkills' | 'getConfigById'>`
 *  — `getConfigById` ignores its arguments and always resolves the one
 *  fixture agent as-is (it's already `EvalAgentConfig`-shaped; the row → config
 *  narrowing lives in `AgentsRepository.getConfigById`/`agents/helpers.ts::toAgentConfig`
 *  now, ring 3, not here), which is enough for every test in this file (each
 *  test scopes its own runner instance to one agent). */
function agentsFixture(
  agent: EvalAgentConfig,
  links: LinkedSkillRow[] = [],
): Pick<AgentsRepository, 'linkedSkills' | 'getConfigById'> {
  return {
    linkedSkills: vi.fn(async () => links),
    getConfigById: vi.fn(async () => agent),
  };
}

/** A `linkedSkills()` fixture — only the fields the runner actually reads
 *  (`skill.id/name/version/enabled/body`, `order`) carry real values; the
 *  rest of the row type is cast away rather than faked field-by-field. */
function linkedSkillsFixture(
  skills: { id: string; name: string; body: string; version: number; enabled: boolean; order: number }[],
): LinkedSkillRow[] {
  return skills.map((s) => ({
    order: s.order,
    skill: { id: s.id, name: s.name, body: s.body, version: s.version, enabled: s.enabled },
  })) as unknown as LinkedSkillRow[];
}

describe('eval_invocation_sees_only_the_case_fragment', () => {
  it('eval_invocation_sees_only_the_case_fragment', async () => {
    const cases = [makeCase()];
    const { repo, finalizeCalls } = makeRepoStub(cases);
    const agent = makeAgent();
    const { llm, calls } = makeLLM();

    const runner = new EvalRunner({
      repo,
      agents: agentsFixture(agent),
      llm: async () => llm,
    });

    await runner.start('ws-1', agent);
    await vi.waitFor(() => expect(finalizeCalls).toHaveLength(1));

    expect(reviewInputs).toHaveLength(1);
    const input = reviewInputs[0]!;
    // Exactly the frozen key set — no `specs`/`callers`/`repoMap`/
    // `prDescription`/`intent`/`task`, and `skills` omitted entirely (not
    // sent as an empty array) when the agent has no enabled linked skill.
    expect(Object.keys(input).sort()).toEqual(
      ['diff', 'llm', 'maxRetries', 'model', 'strategy', 'systemPrompt'].sort(),
    );
    expect(input.systemPrompt).toBe(agent.systemPrompt);
    expect(input.model).toBe(agent.model);
    expect(input.strategy).toBe('single-pass');
    expect((input.diff as { raw: string }).raw).toBe(cases[0]!.fragment);

    // The assembled prompt the model actually saw carries the case fragment
    // and none of a real review's repo-derived sections.
    expect(calls).toHaveLength(1);
    const userMessage = calls[0]!.req.messages.find((m) => m.role === 'user')!.content;
    expect(userMessage).toContain('doSomething();');
    expect(userMessage).not.toContain('## Repo skeleton');
    expect(userMessage).not.toContain('## Callers of changed symbols');
    expect(userMessage).not.toContain('## Project context');
    expect(userMessage).not.toContain('## PR description');
    expect(userMessage).not.toContain('## PR intent');
  });
});

describe('eval_invocation_uses_the_agents_model_provider_and_skills', () => {
  it('eval_invocation_uses_the_agents_model_provider_and_skills', async () => {
    const cases = [makeCase()];
    const { repo, finalizeCalls } = makeRepoStub(cases);
    const agent = makeAgent({ provider: 'anthropic', model: 'claude-3-5-sonnet' });
    const { llm, calls } = makeLLM();

    const resolvedProviderIds: string[] = [];
    const links = linkedSkillsFixture([
      { id: 'skill-a', name: 'Skill A', body: 'BODY-A', version: 1, enabled: true, order: 0 },
      { id: 'skill-b', name: 'Skill B (disabled)', body: 'BODY-B', version: 4, enabled: false, order: 1 },
      { id: 'skill-c', name: 'Skill C', body: 'BODY-C', version: 2, enabled: true, order: 2 },
    ]);

    const runner = new EvalRunner({
      repo,
      agents: agentsFixture(agent, links),
      llm: async (id) => {
        resolvedProviderIds.push(id);
        return llm;
      },
    });

    await runner.start('ws-1', agent);
    await vi.waitFor(() => expect(finalizeCalls).toHaveLength(1));

    // The provider resolved is the agent's own.
    expect(resolvedProviderIds).toEqual(['anthropic']);
    expect(calls).toHaveLength(1);

    const input = reviewInputs[0]!;
    expect(input.model).toBe('claude-3-5-sonnet');
    // Enabled skills only, in link order — the disabled one (order 1) is
    // excluded entirely, not sent as an empty/placeholder body.
    expect(input.skills).toEqual(['BODY-A', 'BODY-C']);

    // Recorded invoked-skill snapshot (what startSuiteRun was called with)
    // mirrors the same enabled-only, ordered set.
    expect(repo.startSuiteRun).toHaveBeenCalledWith(
      expect.objectContaining({
        invokedSkills: [
          { skillId: 'skill-a', skillVersion: 1, skillName: 'Skill A', linkOrder: 0 },
          { skillId: 'skill-c', skillVersion: 2, skillName: 'Skill C', linkOrder: 2 },
        ],
      }),
    );
  });
});

describe('eval_progress_counts_completed_of_total', () => {
  it('eval_progress_counts_completed_of_total', async () => {
    // Rebound to AC-60 (D26): the run control's own label now carries "N of
    // M cases run" — this test's bump-count assertions are that progress
    // signal's data source, whatever surface eventually reads it.
    const cases = [
      makeCase({ id: 'case-1', fragment: FRAGMENT_A }),
      makeCase({ id: 'case-2', fragment: FRAGMENT_A }),
      makeCase({ id: 'case-3', fragment: FRAGMENT_A }),
    ];
    const { repo, bumpCalls, finalizeCalls, writeLatestResultCalls } = makeRepoStub(cases);
    const agent = makeAgent();
    const { llm, releaseNext, pendingCount } = makeLLM(
      [reviewFixture(), reviewFixture(), reviewFixture()],
      { blocking: true },
    );

    const runner = new EvalRunner({
      repo,
      agents: agentsFixture(agent),
      llm: async () => llm,
    });

    await runner.start('ws-1', agent);

    // Case 1's model call is in flight; nothing completed yet.
    await vi.waitFor(() => expect(pendingCount()).toBe(1));
    expect(bumpCalls).toHaveLength(0);
    expect(finalizeCalls).toHaveLength(0);

    releaseNext();
    await vi.waitFor(() => expect(bumpCalls).toHaveLength(1));
    // 1 of 3 done, case 2 now in flight — the run is still `running`.
    await vi.waitFor(() => expect(pendingCount()).toBe(1));
    expect(finalizeCalls).toHaveLength(0);
    // A suite run moves each case's `latest_result` pointer AS IT GOES
    // (AC-48, SPEC-04 § Contracts "Case result") — not only at the end.
    expect(writeLatestResultCalls).toHaveLength(1);
    expect(writeLatestResultCalls[0]!.caseId).toBe('case-1');

    releaseNext();
    await vi.waitFor(() => expect(bumpCalls).toHaveLength(2));
    await vi.waitFor(() => expect(pendingCount()).toBe(1));
    expect(finalizeCalls).toHaveLength(0);

    releaseNext();
    await vi.waitFor(() => expect(finalizeCalls).toHaveLength(1));
    expect(bumpCalls).toHaveLength(3);
    expect((finalizeCalls[0]!.values as { status: string }).status).toBe('completed');
    // One `writeLatestResult` per case, in the same order the cases ran.
    expect(writeLatestResultCalls.map((c) => c.caseId)).toEqual(['case-1', 'case-2', 'case-3']);
  });
});

describe('eval_failed_case_does_not_stop_the_run', () => {
  it('eval_failed_case_does_not_stop_the_run', async () => {
    const cases = [
      makeCase({ id: 'case-1', fragment: FRAGMENT_A }),
      makeCase({ id: 'case-2', fragment: FRAGMENT_A }),
      makeCase({ id: 'case-3', fragment: FRAGMENT_A }),
    ];
    const { repo, recordCalls, finalizeCalls } = makeRepoStub(cases);
    const agent = makeAgent();
    // case-2's model call fails; case-1 and case-3 succeed.
    const { llm } = makeLLM([reviewFixture(), 'ERROR', reviewFixture()]);

    const runner = new EvalRunner({
      repo,
      agents: agentsFixture(agent),
      llm: async () => llm,
    });

    await runner.start('ws-1', agent);
    await vi.waitFor(() => expect(finalizeCalls).toHaveLength(1));

    // All three cases were invoked, in order — case-2's failure did not stop
    // case-3 from running.
    expect(recordCalls.map((c) => c.caseId)).toEqual(['case-1', 'case-2', 'case-3']);

    const case1Result = recordCalls.find((c) => c.caseId === 'case-1')!.result;
    expect(case1Result.error).toBeNull();
    expect(case1Result.actualOutput).not.toBeNull();

    const case2Result = recordCalls.find((c) => c.caseId === 'case-2')!.result;
    expect(case2Result.error).toBe('mock model call failed');
    expect(case2Result.actualOutput).toBeNull();
    expect(case2Result.pass).toBeNull();

    const case3Result = recordCalls.find((c) => c.caseId === 'case-3')!.result;
    expect(case3Result.error).toBeNull();
    expect(case3Result.actualOutput).not.toBeNull();
  });
});

describe('eval_run_states_failed_to_complete_count', () => {
  it('eval_run_states_failed_to_complete_count', async () => {
    const cases = [
      makeCase({ id: 'case-1', fragment: FRAGMENT_A }),
      makeCase({ id: 'case-2', fragment: FRAGMENT_A }),
      makeCase({ id: 'case-3', fragment: FRAGMENT_A }),
    ];
    const { repo, finalizeCalls } = makeRepoStub(cases);
    const agent = makeAgent();
    const { llm } = makeLLM([reviewFixture(), 'ERROR', reviewFixture()]);

    const runner = new EvalRunner({
      repo,
      agents: agentsFixture(agent),
      llm: async () => llm,
    });

    await runner.start('ws-1', agent);
    await vi.waitFor(() => expect(finalizeCalls).toHaveLength(1));

    // The run still completes overall (AC-20); it states exactly one case
    // failed to complete, not zero and not the whole set.
    const values = finalizeCalls[0]!.values;
    expect(values.status).toBe('completed');
    expect(values.casesFailedToComplete).toBe(1);
  });
});

describe('eval_scoring_performs_zero_model_calls', () => {
  it('eval_scoring_performs_zero_model_calls', async () => {
    const cases = [
      makeCase({ id: 'case-1', fragment: FRAGMENT_A }),
      makeCase({ id: 'case-2', fragment: FRAGMENT_A }),
      makeCase({ id: 'case-3', fragment: FRAGMENT_A }),
    ];
    const { repo, finalizeCalls } = makeRepoStub(cases);
    const agent = makeAgent();
    const { llm, calls } = makeLLM([reviewFixture(), reviewFixture(), reviewFixture()]);

    const runner = new EvalRunner({
      repo,
      agents: agentsFixture(agent),
      llm: async () => llm,
    });

    await runner.start('ws-1', agent);
    await vi.waitFor(() => expect(finalizeCalls).toHaveLength(1));

    // Exactly one model call per case — never more, never fewer.
    expect(calls).toHaveLength(cases.length);

    // Scoring (scoreSuite/sumCost, invoked synchronously right after the
    // per-case loop, inside the same `execute()` that just finalized the
    // run) makes NO further model call — the count observed at finalize
    // time is the count that stays true afterwards too.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toHaveLength(cases.length);
  });
});

describe('eval_verification_invokes_the_agent_over_one_case', () => {
  it('eval_verification_invokes_the_agent_over_one_case', async () => {
    const evalCase = makeCase();
    const { repo, writeLatestResultCalls } = makeRepoStub([evalCase]);
    const agent = makeAgent();
    const { llm, calls } = makeLLM([reviewFixture()]);

    const runner = new EvalRunner({
      repo,
      agents: agentsFixture(agent),
      llm: async () => llm,
    });

    const updated = await runner.verifyCase('ws-1', evalCase.id);

    // Exactly one model call, over this case's own fragment (AC-46).
    expect(calls).toHaveLength(1);
    const userMessage = calls[0]!.req.messages.find((m) => m.role === 'user')!.content;
    expect(userMessage).toContain('doSomething();');

    // The returned record IS the case, re-read after the write.
    expect(updated.id).toBe(evalCase.id);

    // `latest_result` moved, exactly once, on this case's own id.
    expect(writeLatestResultCalls).toHaveLength(1);
    expect(writeLatestResultCalls[0]!.caseId).toBe(evalCase.id);
    expect(writeLatestResultCalls[0]!.snapshot).toMatchObject({ completed: true, passed: true });
  });
});

describe('eval_verification_uses_the_same_frozen_invocation_as_a_run', () => {
  it('eval_verification_uses_the_same_frozen_invocation_as_a_run', async () => {
    // AC-17/AC-18: the SAME case, invoked once via a suite run and once via
    // `verifyCase`, must produce a key-for-key identical `ReviewInput` — this
    // is what "one call site, two entry points" (`invokeCase()`) proves in
    // practice, not just by reading the source.
    const evalCase = makeCase();
    const { repo, finalizeCalls } = makeRepoStub([evalCase]);
    const agent = makeAgent();
    const { llm } = makeLLM([reviewFixture(), reviewFixture()]);

    const runner = new EvalRunner({
      repo,
      agents: agentsFixture(agent),
      llm: async () => llm,
    });

    await runner.start('ws-1', agent);
    await vi.waitFor(() => expect(finalizeCalls).toHaveLength(1));
    expect(reviewInputs).toHaveLength(1);
    const runInput = reviewInputs[0]!;

    // Reset the capture — everything from here on belongs to the
    // verification call alone.
    reviewInputs.length = 0;

    await runner.verifyCase('ws-1', evalCase.id);
    expect(reviewInputs).toHaveLength(1);
    const verifyInput = reviewInputs[0]!;

    // Key-for-key identical — asserted on the captured object itself, not on
    // a comment claiming it.
    expect(Object.keys(verifyInput).sort()).toEqual(Object.keys(runInput).sort());
    expect(verifyInput).toEqual(runInput);
  });
});

describe('eval_verification_writes_no_suite_run_row', () => {
  it('eval_verification_writes_no_suite_run_row', async () => {
    // AC-49/AC-50/AC-51, made structural rather than a promise: `verifyCase`
    // calls NONE of the suite-run lifecycle methods and writes
    // `writeLatestResult` exactly once.
    const evalCase = makeCase();
    const { repo, writeLatestResultCalls } = makeRepoStub([evalCase]);
    const agent = makeAgent();
    const { llm } = makeLLM([reviewFixture()]);

    const runner = new EvalRunner({
      repo,
      agents: agentsFixture(agent),
      llm: async () => llm,
    });

    await runner.verifyCase('ws-1', evalCase.id);

    expect(repo.startSuiteRun).not.toHaveBeenCalled();
    expect(repo.recordCaseResult).not.toHaveBeenCalled();
    expect(repo.bumpCaseProgress).not.toHaveBeenCalled();
    expect(repo.finalizeSuiteRun).not.toHaveBeenCalled();
    expect(writeLatestResultCalls).toHaveLength(1);
  });
});
