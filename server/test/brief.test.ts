/**
 * T22 — hermetic, DB-free unit tests for the brief module's pure input
 * assembly/budgeting (`modules/brief/input.ts`, `modules/brief/helpers.ts`)
 * and its route declarations (`modules/brief/routes.ts`). A stub tokenizer is
 * used throughout so thresholds are exact and no BPE ranks are loaded.
 */
import { describe, it, expect } from 'vitest';
import Fastify, { type RouteOptions } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import type { Container } from '../src/platform/container.js';
import type { Tokenizer } from '../src/adapters/tokenizer/index.js';
import briefRoutes from '../src/modules/brief/routes.js';
import { BRIEF_RATE_LIMIT } from '../src/modules/brief/constants.js';
import { changeStats, type PrFileSummary } from '../src/modules/brief/helpers.js';
import { assembleBriefInput, type BriefInputParts } from '../src/modules/brief/input.js';

/** Never reports over budget, whatever the rendered text looks like — used by
 *  tests that only care about WHAT gets rendered, not about dropping. */
const NEVER_OVER_BUDGET: Tokenizer = { count: () => 1 };

/** Always reports a fixed count over budget — used to force the "everything
 *  optional has been dropped, still over" branch (AC-18). */
const ALWAYS_OVER_BUDGET: Tokenizer = { count: () => 8001 };

function baseStats(): ReturnType<typeof changeStats> {
  const files: PrFileSummary[] = [
    { path: 'src/api/rate-limit.ts', additions: 9, deletions: 1 },
    { path: 'src/api/routes.ts', additions: 3, deletions: 2 },
  ];
  return changeStats(files);
}

function baseParts(overrides: Partial<BriefInputParts> = {}): BriefInputParts {
  return {
    title: 'Add rate limiting to public API endpoints',
    intentText: 'Adds token-bucket rate limiting to the public API endpoints.',
    blastSummaryLine: 'This change touches 3 symbol(s), reached by 2 caller(s)…',
    changeStats: baseStats(),
    endpoints: ['POST /api/login'],
    documents: [],
    issueText: null,
    body: null,
    fallbackWhat: 'This change primarily modifies `src/api/rate-limit.ts`.',
    ...overrides,
  };
}

describe('changeStats (per-file change statistics)', () => {
  it('caps the change statistics at 300 files and reports the remainder', () => {
    const files: PrFileSummary[] = Array.from({ length: 305 }, (_, i) => ({
      path: `src/file-${String(i).padStart(3, '0')}.ts`,
      // Strictly descending churn: file-000 has the most churn, file-304 the least.
      additions: 305 - i,
      deletions: 0,
    }));

    const stats = changeStats(files);

    expect(stats.shown).toHaveLength(300);
    expect(stats.notListed).toBe(5);
    // The kept set is the 300 HIGHEST-churn files, never a mid-file cut.
    expect(stats.shown[0]!.path).toBe('src/file-000.ts');
    expect(stats.shown[299]!.path).toBe('src/file-299.ts');
    expect(stats.shown.some((f) => f.path === 'src/file-300.ts')).toBe(false);
    expect(stats.shown.some((f) => f.path === 'src/file-304.ts')).toBe(false);
  });

  it('breaks a churn tie by ascending path', () => {
    const files: PrFileSummary[] = [
      { path: 'b.ts', additions: 5, deletions: 0 }, // churn 5
      { path: 'a.ts', additions: 3, deletions: 2 }, // churn 5
      { path: 'c.ts', additions: 1, deletions: 4 }, // churn 5
    ];
    const stats = changeStats(files);
    expect(stats.shown.map((f) => f.path)).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });
});

describe('assembleBriefInput', () => {
  it('assembles the intent, blast summary, change statistics, issue text and attached documents', () => {
    const parts = baseParts({
      documents: [{ path: 'docs/api-guidelines.md', text: 'All public endpoints must be rate limited.' }],
      issueText: 'Users are hitting the login endpoint too often.',
      body: 'This adds a token-bucket limiter in front of the public API.',
    });

    const result = assembleBriefInput(parts, NEVER_OVER_BUDGET);

    expect(result.overBudget).toBe(false);
    if (result.overBudget) return; // narrows for TS below
    expect(result.rendered).toContain(parts.title);
    expect(result.rendered).toContain(parts.intentText);
    expect(result.rendered).toContain(parts.blastSummaryLine);
    expect(result.rendered).toContain('src/api/rate-limit.ts');
    expect(result.rendered).toContain('src/api/routes.ts');
    expect(result.rendered).toContain('Users are hitting the login endpoint too often.');
    expect(result.rendered).toContain('docs/api-guidelines.md');
    expect(result.rendered).toContain('All public endpoints must be rate limited.');
    // Grounding sets are derived from the SAME assembled data.
    expect(result.files).toEqual(['src/api/rate-limit.ts', 'src/api/routes.ts']);
    expect(result.endpoints).toEqual(['POST /api/login']);
  });

  it('carries no hunk body into the assembled input', () => {
    // A realistic `pr_files` row shape carrying a populated hunk body — the
    // fixture the plan requires so this test can actually fail if the hunk
    // body ever leaks into the pipeline.
    const prFileRow = {
      path: 'src/api/rate-limit.ts',
      additions: 9,
      deletions: 1,
      patch:
        '@@ -1,4 +1,9 @@\n' +
        " import { Request } from './types.js';\n" +
        '-export function handle(req) {\n' +
        '+export function handle(req: Request) {\n' +
        '+  // token bucket check\n' +
        '+  if (isRateLimited(req)) {\n' +
        '+    return reject(req);\n' +
        '+  }\n' +
        '   return next(req);\n' +
        ' }',
    };
    // Only the path/additions/deletions projection reaches changeStats — the
    // same projection `prFileSummaries` returns in production; `patch` is
    // never passed through.
    const summaries: PrFileSummary[] = [
      { path: prFileRow.path, additions: prFileRow.additions, deletions: prFileRow.deletions },
    ];
    const parts = baseParts({ changeStats: changeStats(summaries) });

    const result = assembleBriefInput(parts, NEVER_OVER_BUDGET);

    expect(result.overBudget).toBe(false);
    if (result.overBudget) return;
    expect(result.rendered).not.toContain('@@');
    expect(result.rendered).not.toContain(prFileRow.patch);
    expect(result.rendered).not.toContain('isRateLimited');
    expect(result.rendered).not.toContain('token bucket check');
    // The file's path/churn ARE in the input — this isn't a test that the
    // file is absent, only that its hunk body is.
    expect(result.rendered).toContain('src/api/rate-limit.ts');
  });

  it('produces an input with neither an issue reference nor an attached document', () => {
    const parts = baseParts({ documents: [], issueText: null, body: 'A short PR body.' });

    const result = assembleBriefInput(parts, NEVER_OVER_BUDGET);

    expect(result.overBudget).toBe(false);
    if (result.overBudget) return;
    expect(result.rendered).not.toContain('## Referenced issue');
    expect(result.rendered).not.toContain('## Project context');
    // The required parts are still there — this isn't a degenerate empty input.
    expect(result.rendered).toContain(parts.title);
    expect(result.rendered).toContain(parts.intentText);
    expect(result.rendered).toContain(parts.blastSummaryLine);
  });

  it('drops project-context documents last-attached-first before the issue and the body', () => {
    // A marker-based stub tokenizer: the count is a fixed base plus a weight
    // for each marker string that is still present in the rendered text —
    // deterministic and exact regardless of the real render() implementation.
    function markerTokenizer(base: number, weights: Record<string, number>): Tokenizer {
      return {
        count(text: string) {
          let total = base;
          for (const [marker, weight] of Object.entries(weights)) {
            if (text.includes(marker)) total += weight;
          }
          return total;
        },
      };
    }

    const docA = { path: 'docs/a.md', text: 'DOC-A-MARKER' };
    const docB = { path: 'docs/b.md', text: 'DOC-B-MARKER' };
    const docC = { path: 'docs/c.md', text: 'DOC-C-MARKER' }; // last attached
    const issueMarker = 'ISSUE-TEXT-MARKER';
    const bodyMarker = 'BODY-TEXT-MARKER';

    // Scenario 1 — only enough weight to force ONE drop: proves the dropped
    // unit is the LAST-attached document (docC), not the first (docA) or an
    // arbitrary one, since dropping any other single document would still
    // leave the total over budget here.
    {
      const parts = baseParts({
        documents: [docA, docB, docC],
        issueText: issueMarker,
        body: bodyMarker,
      });
      const tokenizer = markerTokenizer(1000, {
        'DOC-A-MARKER': 500,
        'DOC-B-MARKER': 500,
        'DOC-C-MARKER': 6500, // dropping ONLY this brings the total under 8000
        [issueMarker]: 500,
        [bodyMarker]: 500,
      });

      const result = assembleBriefInput(parts, tokenizer);
      expect(result.overBudget).toBe(false);
      if (result.overBudget) return;
      expect(result.rendered).not.toContain('DOC-C-MARKER');
      expect(result.rendered).toContain('DOC-A-MARKER');
      expect(result.rendered).toContain('DOC-B-MARKER');
      expect(result.rendered).toContain(issueMarker);
      expect(result.rendered).toContain(bodyMarker);
    }

    // Scenario 2 — enough weight to force every document out AND the issue
    // text out, while the body still fits: proves documents drop before the
    // issue text, and the issue text drops before the body.
    {
      const parts = baseParts({
        documents: [docA, docB, docC],
        issueText: issueMarker,
        body: bodyMarker,
      });
      const tokenizer = markerTokenizer(4000, {
        'DOC-A-MARKER': 1000,
        'DOC-B-MARKER': 1000,
        'DOC-C-MARKER': 1000,
        [issueMarker]: 2500,
        [bodyMarker]: 2500,
      });
      // all-present: 4000+3000+2500+2500=12000; docs-gone: 4000+0+2500+2500=9000
      // (still over — proves the loop doesn't stop after just the docs);
      // docs+issue-gone: 4000+2500=6500 (<=8000 — stops here, body survives).

      const result = assembleBriefInput(parts, tokenizer);
      expect(result.overBudget).toBe(false);
      if (result.overBudget) return;
      expect(result.rendered).not.toContain('DOC-A-MARKER');
      expect(result.rendered).not.toContain('DOC-B-MARKER');
      expect(result.rendered).not.toContain('DOC-C-MARKER');
      expect(result.rendered).not.toContain(issueMarker);
      expect(result.rendered).toContain(bodyMarker);
    }
  });

  it('reports over-budget when every optional input has been dropped', () => {
    const parts = baseParts({
      documents: [{ path: 'docs/a.md', text: 'irrelevant' }],
      issueText: 'irrelevant',
      body: 'irrelevant',
    });

    const result = assembleBriefInput(parts, ALWAYS_OVER_BUDGET);

    expect(result).toEqual({ overBudget: true });
    // No `rendered`/`files`/`endpoints` on this branch — no model call can be
    // built from it downstream.
    expect('rendered' in result).toBe(false);
  });
});

describe('brief routes (declaration only, no DB)', () => {
  it('declares the brief rate limit on both generating routes', async () => {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    const seen: { method: string; url: string; config?: Record<string, unknown> }[] = [];
    app.addHook('onRoute', (route: RouteOptions) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const method of methods) {
        seen.push({
          method: String(method),
          url: route.url,
          config: route.config as Record<string, unknown> | undefined,
        });
      }
    });

    // Registration-time only: every repository/service constructor the
    // plugin builds just stores its deps, no I/O — so a minimal stand-in
    // container is enough to register the routes without a real DB.
    const fakeContainer = {
      db: {},
      webfetch: {},
      repoIntel: {},
      tokenizer: { count: () => 0 },
      config: { cloneDir: '/tmp' },
      agentsRepo: {},
    } as unknown as Container;
    app.decorate('container', fakeContainer);

    await briefRoutes(app);

    const posts = seen.filter((r) => r.method === 'POST');
    expect(posts.map((p) => p.url).sort()).toEqual(
      ['/pulls/:id/brief', '/pulls/:id/brief/regenerate'].sort(),
    );
    for (const post of posts) {
      expect(post.config?.rateLimit).toEqual(BRIEF_RATE_LIMIT);
    }

    // The two GET (pure-read) routes carry no rate limit — only generation
    // spends money.
    const gets = seen.filter((r) => r.method === 'GET');
    expect(gets.map((g) => g.url).sort()).toEqual(
      ['/pulls/:id/brief', '/pulls/:id/run-summary'].sort(),
    );
    for (const get of gets) {
      expect(get.config?.rateLimit).toBeUndefined();
    }
  });
});
