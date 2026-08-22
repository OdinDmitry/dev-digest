import { describe, it, expect } from 'vitest';
import {
  Review,
  Finding,
  Intent,
  BlastRadius,
  Risks,
  PrHistory,
  SmartDiff,
  Conformance,
  Onboarding,
  EvalRun,
  MemoryItem,
  RunTrace,
  Settings,
  Repo,
  PrDetail,
  BriefRecord,
} from '@devdigest/shared';

/**
 * Contract tests — parse/round-trip the fixtures from data.jsx/data2.jsx
 * so feature agents can rely on the schemas matching the prototype data.
 */
describe('AI contracts parse fixtures', () => {
  it('Review + Finding (data.jsx VERDICT/FINDINGS)', () => {
    const review = Review.parse({
      verdict: 'request_changes',
      summary: 'Two blockers before merge.',
      score: 61,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded Stripe secret key in commit',
          file: 'src/config.ts',
          start_line: 12,
          end_line: 12,
          rationale: 'Line 12 contains a literal `sk_live_` Stripe key.',
          suggestion: 'Move to env and rotate.',
          confidence: 0.98,
          kind: 'secret_leak',
        },
      ],
    });
    expect(review.findings).toHaveLength(1);
    expect(review.score).toBe(61);
  });

  it('lethal-trifecta Finding variant', () => {
    const f = Finding.parse({
      id: 'f2',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Lethal trifecta',
      file: 'src/api/public/webhooks.ts',
      start_line: 61,
      end_line: 74,
      rationale: 'all three legs present',
      confidence: 0.79,
      kind: 'lethal_trifecta',
      trifecta_components: ['private_data_access', 'untrusted_input', 'exfil_path'],
      evidence: [{ component: 'untrusted_input', file: 'src/api/public/webhooks.ts', line: 61 }],
    });
    expect(f.trifecta_components).toContain('exfil_path');
  });

  it('Intent / BlastRadius / Risks / PrHistory', () => {
    expect(() =>
      Intent.parse({ intent: 'x', in_scope: ['a'], out_of_scope: ['b'] }),
    ).not.toThrow();
    expect(() =>
      BlastRadius.parse({
        changed_symbols: [{ name: 'rateLimit', file: 'a.ts', kind: 'function' }],
        downstream: [
          {
            symbol: 'rateLimit',
            callers: [{ name: 'publicRouter', file: 'b.ts', line: 23 }],
            endpoints_affected: ['GET /x'],
            crons_affected: ['c'],
          },
        ],
        summary: 's',
      }),
    ).not.toThrow();
    expect(() =>
      Risks.parse({
        risks: [{ kind: 'security', title: 't', explanation: 'e', severity: 'high', file_refs: [] }],
      }),
    ).not.toThrow();
    expect(() =>
      PrHistory.parse({
        history: [
          {
            pr_number: 401,
            title: 't',
            merged_at: '2026-03-18',
            author: 'a',
            files_overlap: [],
            notes: 'n',
          },
        ],
      }),
    ).not.toThrow();
  });

  it('SmartDiff (data.jsx DIFF)', () => {
    const d = SmartDiff.parse({
      groups: [
        {
          role: 'core',
          files: [
            {
              path: 'a.ts',
              additions: 84,
              deletions: 0,
              findings: [
                { line: 28, finding_id: 'f1' },
                { line: 52, finding_id: 'f2' },
              ],
            },
          ],
        },
      ],
      split_suggestion: { too_big: false, total_lines: 285, proposed_splits: [] },
    });
    expect(d.groups[0]!.role).toBe('core');
  });

  it('Conformance / Onboarding / EvalRun / MemoryItem', () => {
    expect(() =>
      Conformance.parse({
        spec_id: 's1',
        spec_title: 'Spec',
        items: [{ requirement: 'r', status: 'implemented' }],
        completeness_pct: 80,
      }),
    ).not.toThrow();
    expect(() =>
      Onboarding.parse({
        sections: [{ kind: 'architecture', title: 'T', body: 'b', links: [] }],
      }),
    ).not.toThrow();
    // EvalRun is the suite-run SESSION shape (reshaped in
    // docs/plans/2026-08-22-eval-pipeline-a-foundation.md Step 0) — a run
    // owns many per-case results (`per_trace`), not one case's own pass/fail.
    expect(() =>
      EvalRun.parse({
        id: 'run-1',
        agent_id: 'agent-1',
        agent_name: 'Security Reviewer',
        state: 'completed',
        started_at: '2026-08-22T00:00:00.000Z',
        finished_at: '2026-08-22T00:01:00.000Z',
        system_prompt: 'You review PRs for security issues.',
        provider: 'openai',
        model: 'gpt-4.1',
        strategy: 'single-pass',
        skills: ['sec-basics'],
        captured_context: { documents: [], excluded: [] },
        recall: 0.82,
        precision: 0.91,
        citation_accuracy: 0.95,
        traces_passed: 17,
        traces_total: 20,
        errored_count: 0,
        duration_ms: 12000,
        cost_usd: 0.23,
        per_trace: [
          {
            case_id: 'case-1',
            name: 't01',
            status: 'passed',
            pass: true,
            errored: false,
            error: null,
            findings: [],
            raw_findings_count: 1,
            expected_count: 1,
            matched_count: 1,
            cost_usd: 0.01,
            duration_ms: 600,
            stored: true,
          },
        ],
      }),
    ).not.toThrow();
    expect(() =>
      MemoryItem.parse({
        content: 'c',
        scope: 'team',
        kind: 'decision',
        confidence: 0.92,
        sources: [{ pr: 401, context: 'ctx' }],
      }),
    ).not.toThrow();
  });

  it('RunTrace (data2.jsx TRACE single-document)', () => {
    const trace = RunTrace.parse({
      config: { agent: 'Security Reviewer', version: 'v7', model: 'gpt-4.1', pr: 482, source: 'local' },
      stats: { duration_ms: 8200, tokens_in: 14820, tokens_out: 1240, cost_usd: 0.06, findings: 3, grounding: '3/3 passed' },
      prompt_assembly: { system: 's', user: 'u' },
      tool_calls: [{ tool: 'read_file', args: "'src/config.ts'", meta: '1,240 bytes', ms: 120 }],
      raw_output: '{}',
      memory_pulled: [{ pr: 288, text: 'verified via stripe-signature' }],
      specs_read: ['specs/security-baseline.md'],
      log: [{ t: '00.00', kind: 'info', msg: 'started' }],
    });
    expect(trace.tool_calls).toHaveLength(1);
  });
});

describe('platform DTOs', () => {
  it('Settings defaults + passthrough', () => {
    const s = Settings.parse({ extra_key: 'x' });
    expect(s.theme).toBe('dark');
    expect((s as Record<string, unknown>).extra_key).toBe('x');
  });

  it('Repo + PrDetail', () => {
    expect(() =>
      Repo.parse({
        id: 'r1',
        workspace_id: 'w1',
        owner: 'acme',
        name: 'payments-api',
        full_name: 'acme/payments-api',
        default_branch: 'main',
        clone_path: null,
        last_polled_at: null,
        created_by: null,
      }),
    ).not.toThrow();
    expect(() =>
      PrDetail.parse({
        number: 482,
        title: 't',
        author: 'a',
        branch: 'b',
        base: 'main',
        head_sha: 'sha',
        additions: 1,
        deletions: 0,
        files_count: 1,
        status: 'open',
        files: [],
        commits: [],
      }),
    ).not.toThrow();
  });
});

describe('SPEC-02: PR brief contract', () => {
  it('parses a stored brief document whose references omit start_line, end_line and endpoint', () => {
    // A legacy-shaped stored document: every reference object carries ONLY
    // `path` — `start_line`, `end_line` and `endpoint` are ABSENT keys, not
    // `null`. Built as a raw object literal cast to `unknown`, never routed
    // through `BriefRecord.parse()` first — a fixture constructed via
    // `.parse()` would already have the defaults filled in and this test
    // could never fail (`client/insights.md`, Recurring Errors 2026-08-17).
    const legacyRow: unknown = {
      pr_id: 'pr-1',
      head_sha: 'a1b2c3d4e5f6',
      what: 'Adds token-bucket rate limiting to the public API endpoints.',
      why: 'Unauthenticated clients could call the public endpoints with no request throttling.',
      risk_level: 'high',
      risks: [
        {
          kind: 'security',
          title: 'Hardcoded secret key',
          explanation: 'A live secret key is committed in plaintext.',
          severity: 'high',
          // No `start_line`, `end_line` or `endpoint` keys at all.
          refs: [{ path: 'src/config.ts' }],
        },
      ],
      review_focus: [
        {
          // Same omission on the review-focus side.
          refs: [{ path: 'src/middleware/ratelimit.ts' }],
          reason: 'Verify the limiter resets correctly per client and cannot be bypassed.',
        },
      ],
    };

    const parsed = BriefRecord.parse(legacyRow);

    const riskRef = parsed.risks[0]!.refs[0]!;
    expect(riskRef.path).toBe('src/config.ts');
    expect(riskRef.start_line).toBeNull();
    expect(riskRef.end_line).toBeNull();
    expect(riskRef.endpoint).toBeNull();

    const focusRef = parsed.review_focus[0]!.refs[0]!;
    expect(focusRef.path).toBe('src/middleware/ratelimit.ts');
    expect(focusRef.start_line).toBeNull();
    expect(focusRef.end_line).toBeNull();
    expect(focusRef.endpoint).toBeNull();
  });
});
