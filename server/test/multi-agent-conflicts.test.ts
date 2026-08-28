/**
 * Pure unit tests for `modules/reviews/multi-agent.ts`'s `buildConflicts` —
 * the disagreement-block derivation (AC-18, AC-19, AC-20, AC-21) plus the
 * determinism NFR. Hermetic: no DB, no LLM, fixtures built by hand.
 */
import { describe, it, expect } from 'vitest';
import { buildConflicts } from '../src/modules/reviews/multi-agent.js';
import type { AgentColumn, FindingRecord, Severity } from '@devdigest/shared';

let findingSeq = 0;

function finding(overrides: Partial<FindingRecord> & { file: string; start_line: number; end_line: number }): FindingRecord {
  findingSeq += 1;
  return {
    id: overrides.id ?? `f-${findingSeq}`,
    review_id: 'review-1',
    severity: 'WARNING',
    category: 'bug',
    title: 'default title',
    rationale: 'because',
    suggestion: null,
    confidence: 0.8,
    kind: null,
    trifecta_components: null,
    evidence: null,
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

function column(overrides: Partial<AgentColumn> & { agent_id: string; agent_name: string }): AgentColumn {
  return {
    run_id: `run-${overrides.agent_id}`,
    agent_description: null,
    provider: 'anthropic',
    model: 'claude',
    status: 'done',
    verdict: 'comment',
    score: 80,
    summary: null,
    duration_ms: 1000,
    cost_usd: 0.01,
    error: null,
    findings: [],
    ...overrides,
  };
}

describe('buildConflicts — rows and locations', () => {
  it('produces one row per distinct location, including a location only one agent flagged', () => {
    const shared = { file: 'src/a.ts', start_line: 10, end_line: 12 };
    const soleFinding = { file: 'src/only-one.ts', start_line: 1, end_line: 1 };

    const columns: AgentColumn[] = [
      column({
        agent_id: 'agent-1',
        agent_name: 'Agent One',
        findings: [finding({ ...shared, title: 'shared issue' })],
      }),
      column({
        agent_id: 'agent-2',
        agent_name: 'Agent Two',
        findings: [
          finding({ ...shared, title: 'shared issue (agent 2 view)' }),
          finding({ ...soleFinding, title: 'only agent-2 saw this' }),
        ],
      }),
    ];

    const rows = buildConflicts(columns);

    expect(rows).toHaveLength(2);
    // sorted by (normalized file path, start_line)
    expect(rows.map((r) => r.file)).toEqual(['src/a.ts', 'src/only-one.ts']);

    const soleRow = rows.find((r) => r.file === 'src/only-one.ts')!;
    expect(soleRow.file).toBe('src/only-one.ts');
    expect(soleRow.start_line).toBe(1);
    expect(soleRow.end_line).toBe(1);
  });
});

describe('buildConflicts — takes (AC-18, AC-19)', () => {
  it('produces exactly one take per successful participant, and no take for a non-participant', () => {
    const zone = { file: 'src/b.ts', start_line: 5, end_line: 5 };
    const columns: AgentColumn[] = [
      column({ agent_id: 'agent-1', agent_name: 'Agent One', findings: [finding({ ...zone, title: 'issue' })] }),
      column({ agent_id: 'agent-2', agent_name: 'Agent Two', findings: [] }),
      column({ agent_id: 'agent-3', agent_name: 'Agent Three', findings: [] }),
    ];

    const rows = buildConflicts(columns);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;

    // Exactly 3 takes — one per participant, no more, no fewer, no duplicates.
    expect(row.takes).toHaveLength(3);
    expect(row.takes.map((t) => t.agent_id)).toEqual(['agent-1', 'agent-2', 'agent-3']);

    const flaggingTake = row.takes.find((t) => t.agent_id === 'agent-1')!;
    expect(flaggingTake.verdict).toBe('WARNING');
    expect(flaggingTake.note).toBe('issue');

    for (const silentId of ['agent-2', 'agent-3']) {
      const take = row.takes.find((t) => t.agent_id === silentId)!;
      expect(take.verdict).toBe('ignored');
      expect(take.note).toBeNull();
    }
  });

  it('carries the agent\'s own title verbatim, including markdown, HTML and a newline', () => {
    const weirdTitle = 'Bold **text**, an <b>html tag</b>, and\na literal newline';
    const zone = { file: 'src/weird.ts', start_line: 1, end_line: 1 };
    const columns: AgentColumn[] = [
      column({
        agent_id: 'agent-1',
        agent_name: 'Agent One',
        findings: [finding({ ...zone, title: weirdTitle, severity: 'CRITICAL' })],
      }),
    ];

    const rows = buildConflicts(columns);
    expect(rows).toHaveLength(1);
    const take = rows[0]!.takes.find((t) => t.agent_id === 'agent-1')!;
    // Exact string equality — no truncation, no markdown stripping, no escaping.
    expect(take.note).toBe(weirdTitle);
    expect(take.verdict).toBe('CRITICAL');
  });

  it('an ignored take always carries note: null', () => {
    const zone = { file: 'src/c.ts', start_line: 1, end_line: 1 };
    const columns: AgentColumn[] = [
      column({ agent_id: 'agent-1', agent_name: 'Agent One', findings: [finding({ ...zone, title: 'x' })] }),
      column({ agent_id: 'agent-2', agent_name: 'Agent Two', findings: [] }),
    ];
    const rows = buildConflicts(columns);
    const ignoredTake = rows[0]!.takes.find((t) => t.agent_id === 'agent-2')!;
    expect(ignoredTake.verdict).toBe('ignored');
    expect(ignoredTake.note).toBeNull();
  });
});

describe('buildConflicts — is_conflict truth table (AC-20)', () => {
  it('is a conflict when one participant flagged the location and another did not', () => {
    const zone = { file: 'src/d.ts', start_line: 1, end_line: 1 };
    const columns: AgentColumn[] = [
      column({ agent_id: 'agent-1', agent_name: 'A1', findings: [finding({ ...zone, severity: 'WARNING' })] }),
      column({ agent_id: 'agent-2', agent_name: 'A2', findings: [] }),
    ];
    const rows = buildConflicts(columns);
    expect(rows[0]!.is_conflict).toBe(true);
  });

  it('is a conflict when participants assign differing severities to the same location', () => {
    const zone = { file: 'src/e.ts', start_line: 1, end_line: 1 };
    const columns: AgentColumn[] = [
      column({ agent_id: 'agent-1', agent_name: 'A1', findings: [finding({ ...zone, severity: 'CRITICAL' })] }),
      column({ agent_id: 'agent-2', agent_name: 'A2', findings: [finding({ ...zone, severity: 'WARNING' })] }),
    ];
    const rows = buildConflicts(columns);
    expect(rows[0]!.is_conflict).toBe(true);
  });

  it('is NOT a conflict when every participant flags the location with the same severity', () => {
    const zone = { file: 'src/f.ts', start_line: 1, end_line: 1 };
    const columns: AgentColumn[] = [
      column({ agent_id: 'agent-1', agent_name: 'A1', findings: [finding({ ...zone, severity: 'SUGGESTION' })] }),
      column({ agent_id: 'agent-2', agent_name: 'A2', findings: [finding({ ...zone, severity: 'SUGGESTION' })] }),
      column({ agent_id: 'agent-3', agent_name: 'A3', findings: [finding({ ...zone, severity: 'SUGGESTION' })] }),
    ];
    const rows = buildConflicts(columns);
    expect(rows[0]!.is_conflict).toBe(false);
  });
});

describe('buildConflicts — non-done columns (AC-21)', () => {
  it('a failed column contributes no take anywhere and does not make a row a conflict', () => {
    const zone = { file: 'src/g.ts', start_line: 1, end_line: 1 };
    const columns: AgentColumn[] = [
      column({ agent_id: 'agent-1', agent_name: 'A1', findings: [finding({ ...zone, severity: 'WARNING' })] }),
      column({
        agent_id: 'agent-2',
        agent_name: 'A2',
        status: 'failed',
        error: 'provider unavailable',
        // Even if a failed row somehow carried findings, they must be excluded.
        findings: [finding({ ...zone, severity: 'CRITICAL' })],
      }),
    ];

    const rows = buildConflicts(columns);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;

    // Only the done agent gets a take; the failed one is entirely absent.
    expect(row.takes).toHaveLength(1);
    expect(row.takes[0]!.agent_id).toBe('agent-1');

    // A single flagging participant with no other DONE participant present
    // is not a conflict — the failed agent's silence/severity is ignored.
    expect(row.is_conflict).toBe(false);
  });

  it('a running column is likewise excluded from rows and conflict determination', () => {
    const zone = { file: 'src/h.ts', start_line: 1, end_line: 1 };
    const columns: AgentColumn[] = [
      column({ agent_id: 'agent-1', agent_name: 'A1', findings: [finding({ ...zone, severity: 'WARNING' })] }),
      column({ agent_id: 'agent-2', agent_name: 'A2', status: 'running', findings: [] }),
    ];
    const rows = buildConflicts(columns);
    expect(rows[0]!.takes).toHaveLength(1);
    expect(rows[0]!.is_conflict).toBe(false);
  });
});

describe('buildConflicts — most-severe-of-many (AC-18 combined with severity ranking)', () => {
  it('an agent with two findings at one location takes severity and title from the single most severe one', () => {
    const zone = { file: 'src/i.ts', start_line: 1, end_line: 3 };
    const columns: AgentColumn[] = [
      column({
        agent_id: 'agent-1',
        agent_name: 'A1',
        findings: [
          finding({ ...zone, severity: 'SUGGESTION', title: 'minor nit' }),
          finding({ ...zone, severity: 'CRITICAL', title: 'the real bug' }),
        ],
      }),
    ];

    const rows = buildConflicts(columns);
    expect(rows).toHaveLength(1);
    const take = rows[0]!.takes[0]!;
    expect(take.verdict).toBe('CRITICAL');
    expect(take.note).toBe('the real bug');
  });

  it('ties broken by the agent\'s own produced order (first-produced wins)', () => {
    const zone = { file: 'src/j.ts', start_line: 1, end_line: 1 };
    const columns: AgentColumn[] = [
      column({
        agent_id: 'agent-1',
        agent_name: 'A1',
        findings: [
          finding({ ...zone, severity: 'WARNING', title: 'produced first' }),
          finding({ ...zone, severity: 'WARNING', title: 'produced second' }),
        ],
      }),
    ];
    const rows = buildConflicts(columns);
    expect(rows[0]!.takes[0]!.note).toBe('produced first');
  });
});

describe('buildConflicts — determinism (NFR)', () => {
  it('two runs over the same input produce identical row order and take order', () => {
    const columns: AgentColumn[] = [
      column({
        agent_id: 'agent-1',
        agent_name: 'A1',
        findings: [
          finding({ file: 'src/z.ts', start_line: 20, end_line: 20, severity: 'WARNING', title: 'z issue' }),
          finding({ file: 'src/a.ts', start_line: 1, end_line: 1, severity: 'CRITICAL', title: 'a issue' }),
        ],
      }),
      column({
        agent_id: 'agent-2',
        agent_name: 'A2',
        findings: [
          finding({ file: 'src/m.ts', start_line: 5, end_line: 5, severity: 'SUGGESTION', title: 'm issue' }),
        ],
      }),
      column({ agent_id: 'agent-3', agent_name: 'A3', findings: [] }),
    ];

    const first = buildConflicts(columns);
    const second = buildConflicts(columns);

    expect(second).toEqual(first);
    expect(second.map((r) => `${r.file}:${r.start_line}`)).toEqual(first.map((r) => `${r.file}:${r.start_line}`));
    expect(second.map((r) => r.takes.map((t) => t.agent_id))).toEqual(
      first.map((r) => r.takes.map((t) => t.agent_id)),
    );
  });
});
