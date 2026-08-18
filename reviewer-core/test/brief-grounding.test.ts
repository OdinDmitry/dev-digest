import { describe, it, expect } from 'vitest';
import { groundBrief } from '../src/brief/grounding.js';
import type { RawBrief } from '../src/brief/schema.js';

/**
 * groundBrief (AC-19, AC-20): a risk/review-focus reference survives iff its
 * `path` is one of the files the generation was actually shown AND, when it
 * carries an `endpoint`, that endpoint is one of the endpoints shown. An item
 * left with zero surviving references is dropped entirely. Order is preserved.
 */
describe('groundBrief', () => {
  const sets = {
    files: new Set(['src/api/rate-limit.ts', 'src/api/routes.ts']),
    endpoints: new Set(['POST /api/login']),
  };

  it('drops a reference whose path is not in the changed files', () => {
    const raw: RawBrief = {
      what: 'Adds a rate limiter',
      why: 'Prevents abuse',
      risk_level: 'medium',
      risks: [
        {
          kind: 'security',
          title: 'Limiter can be bypassed',
          explanation: 'The limiter is keyed on IP only',
          severity: 'high',
          refs: [
            { path: 'src/api/rate-limit.ts' },
            { path: 'src/unrelated/does-not-exist.ts' },
          ],
        },
      ],
      review_focus: [],
    };

    const grounded = groundBrief(raw, sets);

    expect(grounded.risks).toHaveLength(1);
    // Only the grounded reference survives; the unknown path is gone, and no
    // trace of it (not even a placeholder) remains.
    expect(grounded.risks[0]!.refs).toHaveLength(1);
    expect(grounded.risks[0]!.refs[0]!.path).toBe('src/api/rate-limit.ts');
    expect(grounded.risks[0]!.refs.some((r) => r.path === 'src/unrelated/does-not-exist.ts')).toBe(
      false,
    );
  });

  it('drops a reference whose endpoint is not in the blast radius', () => {
    const raw: RawBrief = {
      what: 'Adds a rate limiter',
      why: 'Prevents abuse',
      risk_level: 'medium',
      risks: [],
      review_focus: [
        {
          reason: 'Start with the endpoints the limiter now guards',
          refs: [
            { path: 'src/api/routes.ts', endpoint: 'POST /api/login' },
            { path: 'src/api/routes.ts', endpoint: 'DELETE /api/admin/users' },
          ],
        },
      ],
    };

    const grounded = groundBrief(raw, sets);

    expect(grounded.review_focus).toHaveLength(1);
    expect(grounded.review_focus[0]!.refs).toHaveLength(1);
    expect(grounded.review_focus[0]!.refs[0]!.endpoint).toBe('POST /api/login');
    expect(
      grounded.review_focus[0]!.refs.some((r) => r.endpoint === 'DELETE /api/admin/users'),
    ).toBe(false);
  });

  it('removes an item once its last reference is dropped', () => {
    const raw: RawBrief = {
      what: 'Adds a rate limiter',
      why: 'Prevents abuse',
      risk_level: 'low',
      risks: [
        {
          kind: 'correctness',
          title: 'Ghost risk with no grounded reference',
          explanation: 'Every path/endpoint it cites is unknown to this generation',
          severity: 'low',
          refs: [
            { path: 'src/nowhere.ts' },
            { path: 'src/api/routes.ts', endpoint: 'GET /api/nonexistent' },
          ],
        },
        {
          kind: 'security',
          title: 'Real risk that survives',
          explanation: 'Cites a real file',
          severity: 'high',
          refs: [{ path: 'src/api/rate-limit.ts' }],
        },
      ],
      review_focus: [
        {
          reason: 'Ghost focus item, every reference ungrounded',
          refs: [{ path: 'src/also-nowhere.ts' }],
        },
      ],
    };

    const grounded = groundBrief(raw, sets);

    // The risk with zero surviving references disappears entirely — not
    // present with an empty refs array, not present at all.
    expect(grounded.risks).toHaveLength(1);
    expect(grounded.risks[0]!.title).toBe('Real risk that survives');
    expect(grounded.risks.some((r) => r.title === 'Ghost risk with no grounded reference')).toBe(
      false,
    );

    // The review-focus item with zero surviving references is gone too.
    expect(grounded.review_focus).toHaveLength(0);
  });

  it('presents two identical references within one item once', () => {
    const raw: RawBrief = {
      what: 'Adds a rate limiter',
      why: 'Prevents abuse',
      risk_level: 'medium',
      risks: [],
      review_focus: [
        {
          reason: 'Check the routes file from two angles',
          refs: [
            { path: 'src/api/routes.ts', start_line: 10, end_line: 20 },
            { path: 'src/api/routes.ts', start_line: 10, end_line: 20 },
            { path: 'src/api/routes.ts', start_line: 30, end_line: 40 },
          ],
        },
      ],
    };

    const grounded = groundBrief(raw, sets);

    expect(grounded.review_focus).toHaveLength(1);
    // The duplicate (10-20) collapses to one; the distinct (30-40) survives —
    // three refs in, two out, order preserved.
    expect(grounded.review_focus[0]!.refs).toHaveLength(2);
    expect(grounded.review_focus[0]!.refs.map((r) => `${r.start_line}-${r.end_line}`)).toEqual([
      '10-20',
      '30-40',
    ]);
  });

  it('preserves the order of surviving items and references', () => {
    const raw: RawBrief = {
      what: 'Adds a rate limiter',
      why: 'Prevents abuse',
      risk_level: 'medium',
      risks: [
        {
          kind: 'a',
          title: 'first risk',
          explanation: 'e1',
          severity: 'low',
          refs: [{ path: 'src/nowhere.ts' }], // dropped entirely
        },
        {
          kind: 'b',
          title: 'second risk',
          explanation: 'e2',
          severity: 'medium',
          refs: [{ path: 'src/api/rate-limit.ts' }, { path: 'src/api/routes.ts' }],
        },
        {
          kind: 'c',
          title: 'third risk',
          explanation: 'e3',
          severity: 'high',
          refs: [{ path: 'src/api/routes.ts' }],
        },
      ],
      review_focus: [],
    };

    const grounded = groundBrief(raw, sets);

    expect(grounded.risks.map((r) => r.title)).toEqual(['second risk', 'third risk']);
    expect(grounded.risks[0]!.refs.map((r) => r.path)).toEqual([
      'src/api/rate-limit.ts',
      'src/api/routes.ts',
    ]);
  });
});
