import { describe, it, expect } from 'vitest';
import { BlastService } from '../src/modules/blast/service.js';
import { toPrBlastRadius } from '../src/modules/blast/helpers.js';
import type { BlastResult, IndexState } from '../src/modules/repo-intel/types.js';

/**
 * Hermetic (no DB) coverage for the `blast` module: `BlastService` driven
 * against stub `reviews`/`repoIntel` deps (mirrors `smart-diff.test.ts`'s
 * `SmartDiffService` pattern), plus the pure `helpers.ts` mapper.
 */

function makeIndexState(overrides: Partial<IndexState> = {}): IndexState {
  return {
    repoId: 'repo1',
    status: 'full',
    filesIndexed: 5,
    filesSkipped: 0,
    durationMs: 1,
    lastIndexedSha: 'sha',
    indexerVersion: 2,
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('BlastService', () => {
  it('unknown PR id -> NotFoundError (no row at all)', async () => {
    const service = new BlastService({
      reviews: { pullRepoId: async () => null, prFileSummaries: async () => [] },
      repoIntel: {
        getIndexState: async () => makeIndexState(),
        getBlastRadius: async () => {
          throw new Error('getBlastRadius must not be called');
        },
      } as never,
    });
    await expect(service.get('ws1', 'pr-missing')).rejects.toThrow('Pull request not found');
  });

  it('PR belonging to ANOTHER workspace -> NotFoundError (pullRepoId is workspace-scoped)', async () => {
    // pullRepoId itself enforces the workspace scope at the query level (§9 —
    // the A01/IDOR mitigation): a row that exists but belongs to a different
    // workspace surfaces identically to "no such PR" (null), never leaking a
    // repoId to a caller in the wrong tenant.
    const service = new BlastService({
      reviews: {
        pullRepoId: async (workspaceId: string) => (workspaceId === 'ws-owner' ? 'repo1' : null),
        prFileSummaries: async () => [],
      },
      repoIntel: {
        getIndexState: async () => makeIndexState(),
        getBlastRadius: async () => {
          throw new Error('getBlastRadius must not be called');
        },
      } as never,
    });
    await expect(service.get('ws-attacker', 'pr1')).rejects.toThrow('Pull request not found');
  });

  it('index degraded -> state: degraded WITHOUT ever calling getBlastRadius (§3 gate)', async () => {
    let getBlastRadiusCalled = false;
    const service = new BlastService({
      reviews: {
        pullRepoId: async () => 'repo1',
        prFileSummaries: async () => [{ path: 'a.ts', additions: 1, deletions: 0 }],
      },
      repoIntel: {
        getIndexState: async () =>
          makeIndexState({ status: 'degraded', degraded: true, degradedReason: 'index_failed' }),
        getBlastRadius: async () => {
          getBlastRadiusCalled = true;
          throw new Error('getBlastRadius must not be called when the index is degraded');
        },
      } as never,
    });

    const result = await service.get('ws1', 'pr1');

    expect(getBlastRadiusCalled).toBe(false); // the gate: never even reached.
    expect(result.state).toBe('degraded');
    expect(result.reason).toBe('index_failed');
    expect(result.changed_symbols).toEqual([]);
    expect(result.callers).toEqual([]);
    expect(result.impacted_endpoints).toEqual([]);
  });

  it('index status "failed" also gates getBlastRadius, not just "degraded"', async () => {
    let called = false;
    const service = new BlastService({
      reviews: {
        pullRepoId: async () => 'repo1',
        prFileSummaries: async () => [{ path: 'a.ts', additions: 1, deletions: 0 }],
      },
      repoIntel: {
        getIndexState: async () => makeIndexState({ status: 'failed' }),
        getBlastRadius: async () => {
          called = true;
          throw new Error('must not be called');
        },
      } as never,
    });

    const result = await service.get('ws1', 'pr1');
    expect(called).toBe(false);
    expect(result.state).toBe('degraded');
  });

  it('no changed files -> state: ok, empty arrays, reason: null — and never even reads index state', async () => {
    let indexStateCalled = false;
    const service = new BlastService({
      reviews: { pullRepoId: async () => 'repo1', prFileSummaries: async () => [] },
      repoIntel: {
        getIndexState: async () => {
          indexStateCalled = true;
          return makeIndexState();
        },
        getBlastRadius: async () => {
          throw new Error('must not be called');
        },
      } as never,
    });

    const result = await service.get('ws1', 'pr1');
    expect(indexStateCalled).toBe(false);
    expect(result.state).toBe('ok');
    expect(result.reason).toBeNull();
    expect(result.changed_symbols).toEqual([]);
    expect(result.callers).toEqual([]);
    expect(result.impacted_endpoints).toEqual([]);
    expect(result.callers_total).toBe(0);
    expect(result.callers_truncated).toBe(false);
  });

  it('status: partial -> state: partial WITH results still present', async () => {
    const blast: BlastResult = {
      changedSymbols: [{ file: 'a.ts', name: 'foo', kind: 'function', line: 10 }],
      callers: [
        { file: 'b.ts', symbol: 'bar', viaSymbol: 'foo', line: 3, rank: 5, percentile: 80 },
      ],
      impactedEndpoints: ['GET /x'],
      impactedEndpointRows: [{ endpoint: 'GET /x', file: 'b.ts', hops: 1 }],
      callersTotal: 1,
      callersTruncated: false,
      endpointsTruncated: false,
      degraded: false,
    };
    const service = new BlastService({
      reviews: {
        pullRepoId: async () => 'repo1',
        prFileSummaries: async () => [{ path: 'a.ts', additions: 1, deletions: 0 }],
      },
      repoIntel: {
        getIndexState: async () => makeIndexState({ status: 'partial' }),
        getBlastRadius: async () => blast,
      } as never,
    });

    const result = await service.get('ws1', 'pr1');
    expect(result.state).toBe('partial');
    expect(result.reason).toBe('index_partial');
    expect(result.changed_symbols).toEqual([
      { file: 'a.ts', name: 'foo', kind: 'function', line: 10 },
    ]);
    expect(result.callers).toEqual([
      { file: 'b.ts', symbol: 'bar', via_symbol: 'foo', line: 3, rank: 5, percentile: 80 },
    ]);
    expect(result.impacted_endpoints).toEqual([{ endpoint: 'GET /x', file: 'b.ts', hops: 1 }]);
  });

  it('belt-and-braces: getBlastRadius returning degraded:true after a usable index state still maps to state: degraded', async () => {
    const service = new BlastService({
      reviews: {
        pullRepoId: async () => 'repo1',
        prFileSummaries: async () => [{ path: 'a.ts', additions: 1, deletions: 0 }],
      },
      repoIntel: {
        getIndexState: async () => makeIndexState({ status: 'full' }),
        getBlastRadius: async () =>
          ({
            changedSymbols: [],
            callers: [],
            impactedEndpoints: [],
            degraded: true,
            reason: 'no_data',
          }) satisfies BlastResult,
      } as never,
    });

    const result = await service.get('ws1', 'pr1');
    expect(result.state).toBe('degraded');
    expect(result.reason).toBe('no_data');
  });
});

describe('toPrBlastRadius (helpers.ts mapper)', () => {
  it('maps camelCase -> snake_case, preserves hops, propagates callers_total/*_truncated', () => {
    const blast: BlastResult = {
      changedSymbols: [{ file: 'a.ts', name: 'foo', kind: 'function', line: 10 }],
      callers: [
        { file: 'b.ts', symbol: 'bar', viaSymbol: 'foo', line: 3, rank: 5, percentile: 80 },
      ],
      impactedEndpoints: ['GET /x', 'GET /y'],
      impactedEndpointRows: [
        { endpoint: 'GET /x', file: 'b.ts', hops: 0 },
        { endpoint: 'GET /y', file: 'c.ts', hops: 2 },
      ],
      callersTotal: 42,
      callersTruncated: true,
      endpointsTruncated: true,
      degraded: false,
    };

    const result = toPrBlastRadius({
      prId: 'pr1',
      repoId: 'repo1',
      state: 'ok',
      reason: null,
      changedFiles: ['a.ts'],
      blast,
    });

    expect(result).toEqual({
      pr_id: 'pr1',
      repo_id: 'repo1',
      state: 'ok',
      reason: null,
      changed_files: ['a.ts'],
      changed_symbols: [{ file: 'a.ts', name: 'foo', kind: 'function', line: 10 }],
      callers: [
        { file: 'b.ts', symbol: 'bar', via_symbol: 'foo', line: 3, rank: 5, percentile: 80 },
      ],
      callers_total: 42,
      callers_truncated: true,
      impacted_endpoints: [
        { endpoint: 'GET /x', file: 'b.ts', hops: 0 },
        { endpoint: 'GET /y', file: 'c.ts', hops: 2 },
      ],
      endpoints_truncated: true,
    });
  });

  it('maps a null declaration line through to `line: null` on the wire (never a fallback value)', () => {
    const blast: BlastResult = {
      changedSymbols: [{ file: 'a.ts', name: 'foo', kind: 'function', line: null }],
      callers: [],
      impactedEndpoints: [],
      impactedEndpointRows: [],
      callersTotal: 0,
      callersTruncated: false,
      endpointsTruncated: false,
      degraded: false,
    };

    const result = toPrBlastRadius({
      prId: 'pr1',
      repoId: 'repo1',
      state: 'ok',
      reason: null,
      changedFiles: ['a.ts'],
      blast,
    });

    expect(result.changed_symbols).toEqual([
      { file: 'a.ts', name: 'foo', kind: 'function', line: null },
    ]);
  });

  it('blast: null (empty diff / gated-degraded) -> every array empty, counts zero/false', () => {
    const result = toPrBlastRadius({
      prId: 'pr1',
      repoId: 'repo1',
      state: 'degraded',
      reason: 'no_data',
      changedFiles: ['a.ts'],
      blast: null,
    });
    expect(result.changed_symbols).toEqual([]);
    expect(result.callers).toEqual([]);
    expect(result.impacted_endpoints).toEqual([]);
    expect(result.callers_total).toBe(0);
    expect(result.callers_truncated).toBe(false);
    expect(result.endpoints_truncated).toBe(false);
  });

  it('falls back to mapping the flat impactedEndpoints array when impactedEndpointRows is absent', () => {
    const blast: BlastResult = {
      changedSymbols: [],
      callers: [],
      impactedEndpoints: ['GET /legacy'],
      degraded: true,
      reason: 'no_data',
    };
    const result = toPrBlastRadius({
      prId: 'pr1',
      repoId: 'repo1',
      state: 'degraded',
      reason: 'no_data',
      changedFiles: [],
      blast,
    });
    expect(result.impacted_endpoints).toEqual([{ endpoint: 'GET /legacy', file: '', hops: 1 }]);
  });
});
