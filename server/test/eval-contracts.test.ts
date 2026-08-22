/**
 * T24 / D24 — eval pipeline contract tests. Hermetic: zod schemas only, no
 * DB/network. Pins the shape decisions the plan calls out explicitly: every
 * metric and the cost stay `.nullable()` and are never `.default(0)`
 * (AC-27/AC-37), `EvalInvokedSkill` requires both identity fields (AC-38),
 * and the two vendored copies of the SPEC-03/SPEC-04 block are byte-identical
 * (Contracts § "copied, not npm-linked").
 *
 * SPEC-04 delta (D24): `EvalCaseCreate` no longer carries `expectation_kind`
 * on the wire (AC-40) — the retired `eval_contracts_reject_missing_expectation_kind`
 * asserted the OPPOSITE of this and is deleted, not rewritten (D23; see the
 * plan's Retirement traceability table, retired SPEC-03 AC-7). `EvalCaseUpdate`
 * accepts a name only (AC-45); `EvalCaseRecord` requires `severity`, `category`
 * and `latest_result`, all `.nullable()` (AC-44, AC-52/AC-54 edge case);
 * `EvalCaseLatestResult` tolerates an absent `error` key (`.nullish()`);
 * `EvalAgentSummary.latest_run` accepts `null` (AC-4, AC-63).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  EvalAgentSummary,
  EvalCaseCreate,
  EvalCaseLatestResult,
  EvalCaseRecord,
  EvalCaseUpdate,
  EvalInvokedSkill,
  EvalReturnedFinding,
  EvalSuiteRun,
} from '@devdigest/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** A structurally-complete EvalCaseRecord payload — every required key
 *  present, `severity`/`category`/`latest_result` explicit `null` (the shape
 *  a case created before SPEC-04 reads as, AC-52/AC-54). */
function fullCaseRecordPayload(): Record<string, unknown> {
  return {
    id: 'case-1',
    agent_id: 'agent-1',
    name: 'Stripe key must be flagged',
    source_finding_id: 'finding-1',
    file: 'src/config.ts',
    start_line: 10,
    end_line: 12,
    fragment: 'diff --git a/src/config.ts b/src/config.ts',
    expectations: [
      { id: 'e1', kind: 'must_find', file: 'src/config.ts', start_line: 10, end_line: 12 },
    ],
    created_at: '2026-08-20T10:00:00.000Z',
    severity: null,
    category: null,
    latest_result: null,
  };
}

/** A structurally-complete EvalSuiteRun payload, metrics/cost explicit `null`
 *  (never omitted, never `0`) — the shape a real repository read produces for
 *  a run with no scoreable metric yet. */
function fullSuiteRunPayload(): Record<string, unknown> {
  return {
    id: 'run-1',
    agent_id: 'agent-1',
    agent_name: 'Security Reviewer',
    agent_version: 3,
    invoked_skills: [{ skill_id: 'skill-1', skill_version: 2, name: 'Test Quality Rubric' }],
    status: 'completed',
    started_at: '2026-08-20T10:00:00.000Z',
    completed_at: '2026-08-20T10:01:00.000Z',
    cases_total: 2,
    cases_completed: 2,
    cases_passed: 1,
    cases_failed_to_complete: 0,
    recall: null,
    precision: null,
    citation_accuracy: null,
    cost_usd: null,
    case_ids: ['case-1', 'case-2'],
  };
}

describe('eval_contracts_create_payload_carries_no_expectation_type', () => {
  it('eval_contracts_create_payload_carries_no_expectation_type', () => {
    const withoutKind = {
      finding_id: '11111111-1111-1111-1111-111111111111',
      name: 'Stripe key must be flagged',
    };
    // The type is NOT on the wire at all — a bare finding id + name is a
    // complete, valid create payload (AC-40, AC-41: derived server-side).
    const accepted = EvalCaseCreate.safeParse(withoutKind);
    expect(accepted.success).toBe(true);

    // A caller that sends `expectation_kind` anyway is not honoured — it is
    // silently stripped, never read back off the parsed result.
    const withKind = { ...withoutKind, expectation_kind: 'must_find' };
    const parsed = EvalCaseCreate.safeParse(withKind);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty('expectation_kind');
      expect(Object.keys(parsed.data).sort()).toEqual(['finding_id', 'name']);
    }
  });
});

describe('eval_contracts_update_payload_accepts_only_a_name', () => {
  it('eval_contracts_update_payload_accepts_only_a_name', () => {
    // A bare name is a complete, valid update payload (AC-45).
    const nameOnly = EvalCaseUpdate.safeParse({ name: 'Renamed case' });
    expect(nameOnly.success).toBe(true);
    if (nameOnly.success) {
      expect(Object.keys(nameOnly.data)).toEqual(['name']);
    }

    // The retired `expectations` key is not honoured — it is stripped, not
    // read back, even when the payload also carries a valid name.
    const withExpectations = EvalCaseUpdate.safeParse({
      name: 'Renamed case',
      expectations: [{ kind: 'must_find', file: 'a.ts', start_line: 1, end_line: 2 }],
    });
    expect(withExpectations.success).toBe(true);
    if (withExpectations.success) {
      expect(withExpectations.data).not.toHaveProperty('expectations');
    }

    // A missing name still fails — the field itself did not become optional.
    expect(EvalCaseUpdate.safeParse({}).success).toBe(false);
  });
});

describe('eval_contracts_case_carries_nullable_severity_category_and_latest_result', () => {
  it('eval_contracts_case_carries_nullable_severity_category_and_latest_result', () => {
    // Explicit null for all three parses (a case created before SPEC-04).
    const parsed = EvalCaseRecord.safeParse(fullCaseRecordPayload());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.severity).toBeNull();
      expect(parsed.data.category).toBeNull();
      expect(parsed.data.latest_result).toBeNull();
    }

    // Omitting any of the three keys fails — REQUIRED-but-nullable, never a
    // silent default (`server/insights.md` 2026-08-21 — a `.default()` on a
    // persisted contract is a claim about the read path; this one deliberately
    // carries none).
    for (const key of ['severity', 'category', 'latest_result'] as const) {
      const payload = fullCaseRecordPayload();
      delete payload[key];
      const result = EvalCaseRecord.safeParse(payload);
      expect(result.success, `expected omitting "${key}" to fail parsing`).toBe(false);
    }

    // A real, completed latest result also parses, with the AC-53 match count.
    const withResult = EvalCaseRecord.safeParse({
      ...fullCaseRecordPayload(),
      severity: 'CRITICAL',
      category: 'security',
      latest_result: {
        completed: true,
        passed: true,
        findings: [
          { file: 'src/config.ts', start_line: 11, end_line: 11, grounded: true },
        ],
        matched_count: 1,
        ran_at: '2026-08-21T10:00:00.000Z',
      },
    });
    expect(withResult.success).toBe(true);
  });
});

describe('eval_contracts_latest_result_tolerates_an_absent_error_key', () => {
  it('eval_contracts_latest_result_tolerates_an_absent_error_key', () => {
    // `error` is `.nullish()` — a completed, errorless result document never
    // wrote the key at all.
    const parsed = EvalCaseLatestResult.safeParse({
      completed: true,
      passed: true,
      findings: [],
      matched_count: 0,
      ran_at: '2026-08-21T10:00:00.000Z',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.error).toBeUndefined();
    }
  });
});

describe('eval_contracts_agent_summary_accepts_a_null_latest_run', () => {
  it('eval_contracts_agent_summary_accepts_a_null_latest_run', () => {
    // An agent that has never been run (AC-4, AC-63).
    const neverRun = EvalAgentSummary.safeParse({
      agent_id: 'agent-1',
      agent_name: 'Security Reviewer',
      latest_run: null,
    });
    expect(neverRun.success).toBe(true);

    // Omitting the key entirely still fails — null is a real, explicit state,
    // not something a missing key coerces to.
    const missing = EvalAgentSummary.safeParse({ agent_id: 'agent-1', agent_name: 'Security Reviewer' });
    expect(missing.success).toBe(false);
  });
});

describe('eval_contracts_keep_absent_metrics_nullable', () => {
  it('eval_contracts_keep_absent_metrics_nullable', () => {
    // Explicit `null` for every metric + cost is accepted, and stays `null`
    // through parsing (never coerced to 0 by a hidden default).
    const parsed = EvalSuiteRun.safeParse(fullSuiteRunPayload());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.recall).toBeNull();
      expect(parsed.data.precision).toBeNull();
      expect(parsed.data.citation_accuracy).toBeNull();
      expect(parsed.data.cost_usd).toBeNull();
    }

    // Omitting any one of them fails — proves there is no `.default(0)` (or
    // any other default) silently filling the gap; a caller MUST decide.
    for (const key of ['recall', 'precision', 'citation_accuracy', 'cost_usd'] as const) {
      const payload = fullSuiteRunPayload();
      delete payload[key];
      const result = EvalSuiteRun.safeParse(payload);
      expect(result.success, `expected omitting "${key}" to fail parsing`).toBe(false);
    }
  });
});

describe('EvalReturnedFinding — legacy jsonb tolerance', () => {
  it('parses a document lacking severity and title (pre-existing jsonb shape)', () => {
    // Absent keys, not `null` values — the exact shape a document written
    // before `severity`/`title` existed would have (server/insights.md
    // 2026-08-17: a `.nullish()` claim on a persisted field is a claim about
    // the read path, verified here by never routing the fixture through
    // `.parse()` first).
    const legacy: unknown = {
      file: 'src/config.ts',
      start_line: 12,
      end_line: 12,
      grounded: true,
    };
    const parsed = EvalReturnedFinding.safeParse(legacy);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.severity).toBeUndefined();
      expect(parsed.data.title).toBeUndefined();
      expect(parsed.data.grounded).toBe(true);
    }
  });
});

describe('eval_contracts_carry_invoked_skill_identity_and_version', () => {
  it('eval_contracts_carry_invoked_skill_identity_and_version', () => {
    const full = { skill_id: 'skill-1', skill_version: 2, name: 'Test Quality Rubric' };
    expect(EvalInvokedSkill.safeParse(full).success).toBe(true);

    const noId = { skill_version: 2, name: 'Test Quality Rubric' };
    expect(EvalInvokedSkill.safeParse(noId).success).toBe(false);

    const noVersion = { skill_id: 'skill-1', name: 'Test Quality Rubric' };
    expect(EvalInvokedSkill.safeParse(noVersion).success).toBe(false);

    // EvalSuiteRun.invoked_skills is REQUIRED, not `.default([])` (a run
    // assembles it from the eval_run_skills child table on every read, so a
    // caller that forgets it is a bug, not a legitimately empty run).
    const payload = fullSuiteRunPayload();
    delete payload.invoked_skills;
    expect(EvalSuiteRun.safeParse(payload).success).toBe(false);
  });
});

describe('eval_contracts_vendor_copies_are_identical', () => {
  it('eval_contracts_vendor_copies_are_identical', () => {
    const banner = '// ==== SPEC-03 eval pipeline ====';
    const serverPath = join(__dirname, '..', 'src', 'vendor', 'shared', 'contracts', 'eval-ci.ts');
    const clientPath = join(
      __dirname,
      '..',
      '..',
      'client',
      'src',
      'vendor',
      'shared',
      'contracts',
      'eval-ci.ts',
    );

    const serverText = readFileSync(serverPath, 'utf8');
    const clientText = readFileSync(clientPath, 'utf8');

    const serverIdx = serverText.indexOf(banner);
    const clientIdx = clientText.indexOf(banner);
    expect(serverIdx, 'server vendor copy is missing the SPEC-03 banner').toBeGreaterThan(-1);
    expect(clientIdx, 'client vendor copy is missing the SPEC-03 banner').toBeGreaterThan(-1);

    const serverBlock = serverText.slice(serverIdx);
    const clientBlock = clientText.slice(clientIdx);
    expect(clientBlock).toBe(serverBlock);
  });
});
