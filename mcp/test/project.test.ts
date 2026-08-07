import { describe, it, expect } from 'vitest';
import {
  denormalizeSeverity,
  filterFindings,
  normalizeSeverity,
  projectAgents,
  projectConventions,
  projectFindings,
  renderReviewText,
  toFindingOut,
  truncateText,
} from '../src/project.js';
import type { WireFinding } from '../src/devdigest/wire.js';
import { MAX_DESCRIPTION_CHARS, SEVERITY_ORDER } from '../src/constants.js';
import type { ReviewResult } from '../src/tools/schemas.js';
import { makeAgent, makeConvention } from './helpers/fake-api.js';

function finding(overrides: Partial<WireFinding> = {}): WireFinding {
  return {
    severity: 'WARNING',
    category: 'bug',
    title: 'A finding',
    file: 'src/a.ts',
    start_line: 10,
    end_line: 10,
    rationale: 'because',
    suggestion: null,
    dismissed_at: null,
    ...overrides,
  };
}

describe('normalizeSeverity / denormalizeSeverity', () => {
  it('round-trips both directions', () => {
    for (const s of SEVERITY_ORDER) {
      expect(normalizeSeverity(denormalizeSeverity(s))).toBe(s);
    }
    expect(normalizeSeverity('CRITICAL')).toBe('critical');
    expect(denormalizeSeverity('critical')).toBe('CRITICAL');
  });
});

describe('projectFindings', () => {
  it('excludes dismissed findings', () => {
    const kept = finding({ title: 'kept' });
    const dismissed = finding({ title: 'dismissed', dismissed_at: '2026-01-01T00:00:00.000Z' });
    const result = projectFindings([kept, dismissed]);
    expect(result.map((f) => f.title)).toEqual(['kept']);
  });

  it('sorts by the total order: severity, then file, then start_line, then title', () => {
    const findings = [
      finding({ severity: 'SUGGESTION', file: 'z.ts', start_line: 1, title: 'z' }),
      finding({ severity: 'CRITICAL', file: 'b.ts', start_line: 5, title: 'b5' }),
      finding({ severity: 'CRITICAL', file: 'a.ts', start_line: 10, title: 'a10' }),
      finding({ severity: 'CRITICAL', file: 'a.ts', start_line: 1, title: 'a1-second' }),
      finding({ severity: 'CRITICAL', file: 'a.ts', start_line: 1, title: 'a1-first' }),
      finding({ severity: 'WARNING', file: 'a.ts', start_line: 1, title: 'w' }),
    ];
    const sorted = projectFindings(findings);
    expect(sorted.map((f) => f.title)).toEqual(['a1-first', 'a1-second', 'a10', 'b5', 'w', 'z']);
  });

  it('is a deterministic total order across repeated runs (no ties left ambiguous)', () => {
    const findings = Array.from({ length: 20 }, (_, i) =>
      finding({ title: `t${i}`, file: 'a.ts', start_line: 1, severity: 'WARNING' }),
    );
    const first = projectFindings(findings).map((f) => f.title);
    const second = projectFindings(findings).map((f) => f.title);
    expect(first).toEqual(second);
  });
});

describe('filterFindings', () => {
  it('filters by severity and by a case-insensitive file substring', () => {
    const projected = projectFindings([
      finding({ severity: 'CRITICAL', file: 'src/Auth/session.ts', title: 'a' }),
      finding({ severity: 'WARNING', file: 'src/other.ts', title: 'b' }),
    ]);
    expect(filterFindings(projected, { severity: 'critical' }).map((f) => f.title)).toEqual(['a']);
    expect(filterFindings(projected, { file: 'auth' }).map((f) => f.title)).toEqual(['a']);
  });
});

describe('toFindingOut', () => {
  it('collapses location to "path:line" when start === end, else "path:start-end"', () => {
    const [single] = projectFindings([finding({ file: 'a.ts', start_line: 42, end_line: 42 })]);
    const [range] = projectFindings([finding({ file: 'a.ts', start_line: 42, end_line: 48 })]);
    expect(toFindingOut(single!, 'compact').location).toBe('a.ts:42');
    expect(toFindingOut(range!, 'compact').location).toBe('a.ts:42-48');
  });

  it('omits rationale by default and includes it (truncated) only for detail "full"', () => {
    const longRationale = 'x'.repeat(1000);
    const [f] = projectFindings([finding({ rationale: longRationale })]);
    const compact = toFindingOut(f!, 'compact');
    const full = toFindingOut(f!, 'full');
    expect(compact.rationale).toBeUndefined();
    expect(full.rationale).toBeDefined();
    expect(full.rationale!.length).toBeLessThan(longRationale.length);
  });
});

describe('truncateText', () => {
  it('truncates with an ellipsis only when over budget', () => {
    expect(truncateText('short', 100)).toBe('short');
    const long = 'a'.repeat(300);
    const truncated = truncateText(long, MAX_DESCRIPTION_CHARS);
    expect(truncated.length).toBe(MAX_DESCRIPTION_CHARS);
    expect(truncated.endsWith('…')).toBe(true);
  });
});

describe('renderReviewText', () => {
  const base: ReviewResult = {
    repo: 'acme/payments-api',
    pr: 482,
    agent: 'General',
    status: 'completed',
    verdict: 'approve',
    score: 95,
    summary: 'Looks good.',
    findings_total: 0,
    findings: [],
    truncated: false,
    run_id: null,
    next_step: null,
  };

  it('is deterministic for a fixed input', () => {
    expect(renderReviewText(base)).toBe(renderReviewText(base));
  });

  it('always ends on a trusted line (the next_step, or the literal "none")', () => {
    const text = renderReviewText(base);
    expect(text.split('\n').at(-1)).toBe('next_step: none');
  });
});

describe('projectAgents', () => {
  it('sorts enabled first, then name ascending, then original order as the final tiebreak', () => {
    const a = makeAgent({ name: 'Zebra', enabled: true });
    const b = makeAgent({ name: 'Alpha', enabled: false });
    const c = makeAgent({ name: 'Alpha', enabled: true });
    const projected = projectAgents([a, b, c]);
    expect(projected.map((x) => x.name)).toEqual(['Alpha', 'Zebra', 'Alpha']);
    expect(projected.map((x) => x.enabled)).toEqual([true, true, false]);
  });

  it('truncates the description', () => {
    const [agent] = projectAgents([makeAgent({ description: 'x'.repeat(500) })]);
    expect(agent!.description.length).toBe(MAX_DESCRIPTION_CHARS);
  });
});

describe('projectConventions', () => {
  it('excludes rejected candidates', () => {
    const kept = makeConvention({ rule: 'kept', status: 'accepted' });
    const rejected = makeConvention({ rule: 'rejected', status: 'rejected' });
    const projected = projectConventions([kept, rejected]);
    expect(projected.map((c) => c.rule)).toEqual(['kept']);
  });

  it('orders accepted before pending, then confidence descending (nulls last), then id ascending', () => {
    const pending = makeConvention({ id: 'c3', rule: 'pending', status: 'pending', confidence: 0.9 });
    const acceptedHigh = makeConvention({ id: 'c2', rule: 'accepted-high', status: 'accepted', confidence: 0.9 });
    const acceptedNull = makeConvention({ id: 'c1', rule: 'accepted-null', status: 'accepted', confidence: null });
    const acceptedLow = makeConvention({ id: 'c4', rule: 'accepted-low', status: 'accepted', confidence: 0.1 });
    const projected = projectConventions([pending, acceptedHigh, acceptedNull, acceptedLow]);
    expect(projected.map((c) => c.rule)).toEqual([
      'accepted-high',
      'accepted-low',
      'accepted-null',
      'pending',
    ]);
  });

  it('drops the id and formats evidence as "<path>:<start>-<end>"', () => {
    const [c] = projectConventions([
      makeConvention({ evidence_path: 'src/a.ts', evidence_start_line: 1, evidence_end_line: 5 }),
    ]);
    expect(c).not.toHaveProperty('id');
    expect(c!.evidence).toBe('src/a.ts:1-5');
  });

  it('evidence is null when any evidence field is missing', () => {
    const [c] = projectConventions([makeConvention({ evidence_path: null })]);
    expect(c!.evidence).toBeNull();
  });
});
