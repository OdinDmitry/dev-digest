import { describe, it, expect } from 'vitest';
import {
  EvalCase,
  EvalRun,
  EvalPerTrace,
  EvalCaseInput,
  EvalRunRecord,
  EvalDashboard,
  EvalCaseSeed,
  EvalComparison,
} from '@devdigest/shared';
import * as ServerKnowledge from '../src/vendor/shared/contracts/knowledge.js';
import * as ServerEvalCi from '../src/vendor/shared/contracts/eval-ci.js';
// Reaches across the package boundary into the client's OWN vendored copy —
// deliberate here: the two copies are not npm-linked (root CLAUDE.md), so
// this is the only way to assert they still agree on the eval contracts.
import * as ClientKnowledge from '../../client/src/vendor/shared/contracts/knowledge.js';
import * as ClientEvalCi from '../../client/src/vendor/shared/contracts/eval-ci.js';

/**
 * `docs/plans/2026-08-22-eval-pipeline-a-foundation.md` T19. Covers AC-12,
 * AC-18, AC-40, AC-47: parses the Phase-A eval contracts against valid
 * fixtures, checks the schema-enforceable rejections, and confirms the
 * server and client vendored copies of both contract files agree.
 */

const FINDING_FIXTURE = {
  id: 'f-1',
  severity: 'CRITICAL',
  category: 'security',
  title: 'Hardcoded secret',
  file: 'src/config.ts',
  start_line: 11,
  end_line: 11,
  rationale: 'A live secret is committed in source.',
  suggestion: null,
  confidence: 0.95,
  kind: 'finding',
};

const EXPECTATION_FIXTURE = {
  kind: 'must_find' as const,
  file: 'src/config.ts',
  start_line: 11,
  end_line: 11,
  title: 'Hardcoded secret',
  severity: 'CRITICAL',
  category: 'security',
};

const CAPTURED_CONTEXT_FIXTURE = {
  documents: [{ repo_id: 'repo-1', path: 'README.md', text: 'hello' }],
  excluded: [{ path: 'docs/huge.md', reason: 'over_budget' }],
};

const PER_TRACE_FIXTURE = {
  case_id: 'case-1',
  name: 'Case 1',
  status: 'passed' as const,
  pass: true,
  errored: false,
  error: null,
  findings: [FINDING_FIXTURE],
  raw_findings_count: 1,
  expected_count: 1,
  matched_count: 1,
  cost_usd: 0.01,
  duration_ms: 620,
  stored: true,
};

const EVAL_CASE_FIXTURE = {
  id: 'case-1',
  owner_kind: 'agent' as const,
  owner_id: 'agent-1',
  name: 'Secret key case',
  input_diff: 'diff --git a/src/config.ts b/src/config.ts',
  repo_id: 'repo-1',
  repo_full_name: 'acme/payments-api',
  expectations: [EXPECTATION_FIXTURE],
  polarity: 'must_find' as const,
  origin: { finding_id: 'f-1', pr_id: 'pr-1', pr_number: 482, finding_title: 'Hardcoded secret' },
  notes: null,
  last_outcome: null,
  created_at: '2026-08-22T00:00:00.000Z',
  updated_at: '2026-08-22T00:00:00.000Z',
};

const EVAL_RUN_FIXTURE = {
  id: 'run-1',
  agent_id: 'agent-1',
  agent_name: 'Security Reviewer',
  state: 'completed' as const,
  started_at: '2026-08-22T00:00:00.000Z',
  finished_at: '2026-08-22T00:01:00.000Z',
  system_prompt: 'You review PRs for security issues.',
  provider: 'openai',
  model: 'gpt-4.1',
  strategy: 'single-pass',
  skills: ['sec-basics'],
  captured_context: CAPTURED_CONTEXT_FIXTURE,
  recall: 0.8,
  precision: 0.9,
  citation_accuracy: 0.95,
  traces_passed: 1,
  traces_total: 1,
  errored_count: 0,
  duration_ms: 12000,
  cost_usd: 0.23,
  per_trace: [PER_TRACE_FIXTURE],
};

const EVAL_CASE_INPUT_FIXTURE = {
  name: 'Secret key case',
  input_diff: 'diff --git a/src/config.ts b/src/config.ts',
  repo_id: '11111111-1111-1111-1111-111111111111',
  expectations: [EXPECTATION_FIXTURE],
  notes: null,
};

const EVAL_RUN_RECORD_FIXTURE = {
  id: 'run-1',
  agent_id: 'agent-1',
  started_at: '2026-08-22T00:00:00.000Z',
  state: 'completed' as const,
  recall: 0.8,
  precision: 0.9,
  citation_accuracy: 0.95,
  traces_passed: 1,
  traces_total: 1,
  errored_count: 0,
  cost_usd: 0.23,
  duration_ms: 12000,
  delta: null,
};

const EVAL_RUN_RECORD_FIXTURE_2 = {
  ...EVAL_RUN_RECORD_FIXTURE,
  id: 'run-2',
  started_at: '2026-08-23T00:00:00.000Z',
  recall: 0.9,
};

const EVAL_DASHBOARD_FIXTURE = {
  agents: [
    {
      agent_id: 'agent-1',
      agent_name: 'Security Reviewer',
      model: 'gpt-4.1',
      cases_total: 3,
      never_run: false,
      running: false,
      last_run_started_at: '2026-08-22T00:00:00.000Z',
      traces_passed: 2,
      traces_total: 3,
      recall: 0.8,
      precision: 0.9,
      citation_accuracy: 0.95,
    },
  ],
  run_all: { agent_count: 1, case_count: 3 },
};

const EVAL_CASE_SEED_FIXTURE = {
  agent_id: 'agent-1',
  agent_name: 'Security Reviewer',
  repo_id: 'repo-1',
  repo_full_name: 'acme/payments-api',
  name: 'Hardcoded secret',
  input_diff: 'diff --git a/src/config.ts b/src/config.ts',
  expectations: [EXPECTATION_FIXTURE],
  origin: { finding_id: 'f-1', pr_id: 'pr-1', pr_number: 482, finding_title: 'Hardcoded secret' },
};

const EVAL_COMPARISON_FIXTURE = {
  earlier: EVAL_RUN_RECORD_FIXTURE,
  later: EVAL_RUN_RECORD_FIXTURE_2,
  metrics: [{ key: 'recall' as const, earlier: 0.8, later: 0.9, delta: 0.1 }],
  prompt_diff: [{ kind: 'same' as const, text: 'unchanged line' }],
  case_sets_differ: false,
  earlier_case_count: 3,
  later_case_count: 3,
  context_differs: false,
};

describe('eval contracts parse valid fixtures', () => {
  it('EvalCase', () => {
    expect(() => EvalCase.parse(EVAL_CASE_FIXTURE)).not.toThrow();
  });
  it('EvalRun (suite-run session)', () => {
    expect(() => EvalRun.parse(EVAL_RUN_FIXTURE)).not.toThrow();
  });
  it('EvalPerTrace', () => {
    expect(() => EvalPerTrace.parse(PER_TRACE_FIXTURE)).not.toThrow();
  });
  it('EvalCaseInput', () => {
    expect(() => EvalCaseInput.parse(EVAL_CASE_INPUT_FIXTURE)).not.toThrow();
  });
  it('EvalRunRecord', () => {
    expect(() => EvalRunRecord.parse(EVAL_RUN_RECORD_FIXTURE)).not.toThrow();
  });
  it('EvalDashboard', () => {
    expect(() => EvalDashboard.parse(EVAL_DASHBOARD_FIXTURE)).not.toThrow();
  });
  it('EvalCaseSeed', () => {
    expect(() => EvalCaseSeed.parse(EVAL_CASE_SEED_FIXTURE)).not.toThrow();
  });
  it('EvalComparison', () => {
    expect(() => EvalComparison.parse(EVAL_COMPARISON_FIXTURE)).not.toThrow();
  });
});

describe('eval contracts reject invalid data', () => {
  it('rejects an expectations array containing an expectation kind outside the EvalExpectationKind enum', () => {
    const invalid = {
      ...EVAL_CASE_INPUT_FIXTURE,
      expectations: [
        EXPECTATION_FIXTURE,
        { ...EXPECTATION_FIXTURE, kind: 'must_maybe' }, // not a valid EvalExpectationKind
      ],
    };
    expect(() => EvalCaseInput.parse(invalid)).toThrow();
  });

  it('rejects an out-of-range metric (recall > 1) on EvalRun', () => {
    const invalid = { ...EVAL_RUN_FIXTURE, recall: 1.5 };
    expect(() => EvalRun.parse(invalid)).toThrow();
  });

  it('rejects an out-of-range metric (recall < 0) on EvalRun', () => {
    const invalid = { ...EVAL_RUN_FIXTURE, recall: -0.1 };
    expect(() => EvalRun.parse(invalid)).toThrow();
  });
});

describe('server and client vendored copies agree on the eval contracts', () => {
  it('knowledge.ts: EvalCase parses to byte-identical JSON through both copies', () => {
    const server = ServerKnowledge.EvalCase.parse(EVAL_CASE_FIXTURE);
    const client = ClientKnowledge.EvalCase.parse(EVAL_CASE_FIXTURE);
    expect(JSON.stringify(client)).toBe(JSON.stringify(server));
  });

  it('knowledge.ts: EvalRun parses to byte-identical JSON through both copies', () => {
    const server = ServerKnowledge.EvalRun.parse(EVAL_RUN_FIXTURE);
    const client = ClientKnowledge.EvalRun.parse(EVAL_RUN_FIXTURE);
    expect(JSON.stringify(client)).toBe(JSON.stringify(server));
  });

  it('eval-ci.ts: EvalDashboard parses to byte-identical JSON through both copies', () => {
    const server = ServerEvalCi.EvalDashboard.parse(EVAL_DASHBOARD_FIXTURE);
    const client = ClientEvalCi.EvalDashboard.parse(EVAL_DASHBOARD_FIXTURE);
    expect(JSON.stringify(client)).toBe(JSON.stringify(server));
  });

  it('eval-ci.ts: EvalComparison parses to byte-identical JSON through both copies', () => {
    const server = ServerEvalCi.EvalComparison.parse(EVAL_COMPARISON_FIXTURE);
    const client = ClientEvalCi.EvalComparison.parse(EVAL_COMPARISON_FIXTURE);
    expect(JSON.stringify(client)).toBe(JSON.stringify(server));
  });
});
