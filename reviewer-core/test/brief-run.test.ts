import { describe, it, expect } from 'vitest';
import { MockLLMProvider } from '../../server/src/adapters/mocks.js';
import { generateBrief } from '../src/brief/run.js';
import type { BriefInput } from '../src/brief/prompt.js';

/**
 * generateBrief (AC-2, AC-6): exactly one structured model call per
 * generation, and the returned `what` can never equal the PR title
 * (case/whitespace-insensitive) — enforced by `enforceNotTitle`, not by a
 * second model call.
 */
describe('generateBrief', () => {
  const input: BriefInput = {
    rendered: '## PR title\nAdd rate limiting to public API endpoints',
    files: ['src/api/rate-limit.ts', 'src/api/routes.ts'],
    endpoints: ['POST /api/login'],
    title: 'Add rate limiting to public API endpoints',
    fallbackWhat: 'Touches src/api/rate-limit.ts and src/api/routes.ts',
  };

  const wellBehavedFixture = {
    what: 'Introduces a token-bucket limiter in front of the public API endpoints.',
    why: 'Repeated automated login attempts were overwhelming the login endpoint.',
    risk_level: 'medium',
    risks: [
      {
        kind: 'security',
        title: 'Limiter can be bypassed by IP rotation',
        explanation: 'The limiter keys solely on client IP.',
        severity: 'high',
        refs: [{ path: 'src/api/rate-limit.ts', start_line: null, end_line: null, endpoint: null }],
      },
    ],
    review_focus: [
      {
        reason: 'Start with the limiter itself',
        refs: [{ path: 'src/api/rate-limit.ts', start_line: null, end_line: null, endpoint: null }],
      },
    ],
  };

  it('performs exactly one structured model call per generation', async () => {
    const llm = new MockLLMProvider('openai', { structured: wellBehavedFixture });

    const outcome = await generateBrief({ llm, model: 'gpt-4.1', input });

    expect(outcome.modelCalls).toBe(1);
    const structuredCalls = llm.calls.filter((c) => c.method === 'completeStructured');
    expect(structuredCalls).toHaveLength(1);
    expect(outcome.doc.what).toBe(wellBehavedFixture.what);
    expect(outcome.doc.risks).toHaveLength(1);
    expect(outcome.doc.review_focus).toHaveLength(1);
  });

  it('replaces a what statement that is the title in different casing and spacing', async () => {
    const titleRestated = {
      ...wellBehavedFixture,
      // Same as input.title, but upper-cased with doubled internal whitespace
      // and leading/trailing padding — must still be caught.
      what: '   ADD   RATE  LIMITING TO  PUBLIC   API ENDPOINTS   ',
    };
    const llm = new MockLLMProvider('openai', { structured: titleRestated });

    const outcome = await generateBrief({ llm, model: 'gpt-4.1', input });

    // Exactly one call was still made — the fallback is a pure substitution,
    // never a retry/second generation.
    const structuredCalls = llm.calls.filter((c) => c.method === 'completeStructured');
    expect(structuredCalls).toHaveLength(1);

    expect(outcome.doc.what).toBe(input.fallbackWhat);
    expect(outcome.doc.what.trim().toLowerCase().replace(/\s+/g, ' ')).not.toBe(
      input.title.trim().toLowerCase().replace(/\s+/g, ' '),
    );
  });
});
