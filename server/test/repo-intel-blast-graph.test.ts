import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import { MAX_BLAST_GRAPH_FILES } from '../src/modules/repo-intel/constants.js';
import type { IndexState } from '../src/modules/repo-intel/types.js';
import type {
  FullSymbolRow,
  IndexerEdgeRow,
  IndexerFileFactsRow,
  ResolvedCallerRow,
} from '../src/modules/repo-intel/repository.js';

/**
 * §11 — hermetic coverage for plan steps 1-3: the reverse-import closure
 * (`reverseImportClosure`, private on RepoIntelService) and caller
 * capping/ordering (`tryPersistentBlast`), both exercised only through the
 * public `getBlastRadius` facade method, exactly like
 * `repo-intel-facade-degraded.test.ts` patches `svc.repo` directly.
 *
 * No Postgres, no clone — every DB read is a stubbed `RepoIntelRepository`
 * method.
 */

function makeIndexState(status: 'full' | 'partial' = 'full'): IndexState {
  return {
    repoId: 'r1',
    status,
    filesIndexed: 10,
    filesSkipped: 0,
    durationMs: 5,
    lastIndexedSha: 'sha1',
    indexerVersion: 2,
    updatedAt: new Date(),
  };
}

/** A stub that fails loudly if `getEdges` is ever reached from the blast path
 *  (§4 — blast must use `getImporters`, never the whole-graph `getEdges`). */
function failingGetEdges(): never {
  throw new Error('getEdges must not be called from the blast path');
}

interface RepoStubOverrides {
  tryGetIndexState?: () => Promise<IndexState | null>;
  getSymbolRows?: (repoId: string, paths: string[]) => Promise<FullSymbolRow[]>;
  getResolvedCallers?: (
    repoId: string,
    declFiles: string[],
    names: string[],
  ) => Promise<ResolvedCallerRow[]>;
  getFileFacts?: (repoId: string, files: string[]) => Promise<IndexerFileFactsRow[]>;
  getImporters?: (repoId: string, toFiles: string[]) => Promise<IndexerEdgeRow[]>;
  getFileRankFor?: (
    repoId: string,
    paths: string[],
  ) => Promise<{ path: string; percentile: number }[]>;
}

function buildService(overrides: RepoStubOverrides): RepoIntelService {
  const container = {
    config: { repoIntelEnabled: true },
    db: {} as never,
  } as never;
  const svc = new RepoIntelService(container);
  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    tryGetIndexState: overrides.tryGetIndexState ?? (async () => makeIndexState()),
    getSymbolRows: overrides.getSymbolRows ?? (async () => []),
    getResolvedCallers: overrides.getResolvedCallers ?? (async () => []),
    getFileFacts: overrides.getFileFacts ?? (async () => []),
    getImporters: overrides.getImporters ?? (async () => []),
    getFileRankFor: overrides.getFileRankFor ?? (async () => []),
    getEdges: failingGetEdges,
  };
  return svc;
}

/** One changed symbol declared in `file` — the minimum needed for
 *  `tryPersistentBlast` to leave its early "no changed symbols" return and
 *  actually run the reverse-import closure. */
function oneChangedSymbolRows(file: string, name = 'entry'): FullSymbolRow[] {
  return [{ path: file, name, kind: 'function', line: 1, endLine: 2, exported: true, signature: null }];
}

describe('reverseImportClosure (via getBlastRadius) — 2-hop reverse-import walk', () => {
  it('converges fan-out in ONE getImporters call per hop, stops at BFS_DEPTH, dedupes across converging paths, attributes endpoints by shortest hop, and never calls getEdges', async () => {
    // a.ts (changed, hop 0)
    //   <- b1.ts, b2.ts (hop 1, fan-out of 2)
    //   <- c.ts (imports both b1 and b2 — converges), c2.ts (imports b2) (hop 2)
    //   <- d.ts imports c.ts — must NOT be reached (that would be hop 3)
    const edges: IndexerEdgeRow[] = [
      { fromFile: 'b1.ts', toFile: 'a.ts' },
      { fromFile: 'b2.ts', toFile: 'a.ts' },
      { fromFile: 'c.ts', toFile: 'b1.ts' },
      { fromFile: 'c.ts', toFile: 'b2.ts' },
      { fromFile: 'c2.ts', toFile: 'b2.ts' },
      { fromFile: 'd.ts', toFile: 'c.ts' },
    ];
    const importerCalls: string[][] = [];

    const facts: Record<string, IndexerFileFactsRow> = {
      'a.ts': { filePath: 'a.ts', endpoints: ['GET /a'], crons: [] },
      // 'GET /shared' is declared in BOTH a hop-1 file (b1.ts) and a hop-2
      // file (c.ts) — must dedupe to the SHORTER hop (1), attributed to b1.
      'b1.ts': { filePath: 'b1.ts', endpoints: ['GET /shared'], crons: [] },
      'c.ts': { filePath: 'c.ts', endpoints: ['GET /c', 'GET /shared'], crons: [] },
    };

    const svc = buildService({
      getSymbolRows: async (_repoId, paths) =>
        paths.includes('a.ts') ? oneChangedSymbolRows('a.ts') : [],
      getResolvedCallers: async () => [],
      getImporters: async (_repoId, toFiles) => {
        importerCalls.push([...toFiles].sort());
        return edges.filter((e) => toFiles.includes(e.toFile));
      },
      getFileFacts: async (_repoId, files) =>
        files.map((f) => facts[f]).filter((f): f is IndexerFileFactsRow => !!f),
    });

    const blast = await svc.getBlastRadius('r1', ['a.ts']);

    // Exactly 2 getImporters calls (BFS_DEPTH), never a per-file loop.
    expect(importerCalls).toHaveLength(2);
    expect(importerCalls[0]).toEqual(['a.ts']);
    expect(importerCalls[1]).toEqual(['b1.ts', 'b2.ts']);

    // d.ts (hop 3) never surfaces anywhere in the result.
    expect(JSON.stringify(blast)).not.toContain('d.ts');

    expect(blast.endpointsTruncated).toBe(false);
    expect(blast.impactedEndpointRows).toEqual([
      { endpoint: 'GET /a', file: 'a.ts', hops: 0 },
      { endpoint: 'GET /shared', file: 'b1.ts', hops: 1 },
      { endpoint: 'GET /c', file: 'c.ts', hops: 2 },
    ]);
    expect(blast.impactedEndpoints).toEqual(['GET /a', 'GET /c', 'GET /shared']);
  });

  it('a cycle (b.ts <-> c.ts) terminates and each file keeps its lowest hop', async () => {
    // a.ts (changed) <- b.ts, c.ts (hop 1). b.ts and c.ts mutually import
    // each other — without the "already seen" guard, hop 2 would try to
    // re-discover both as new candidates.
    const edges: IndexerEdgeRow[] = [
      { fromFile: 'b.ts', toFile: 'a.ts' },
      { fromFile: 'c.ts', toFile: 'a.ts' },
      { fromFile: 'b.ts', toFile: 'c.ts' },
      { fromFile: 'c.ts', toFile: 'b.ts' },
    ];
    const importerCalls: string[][] = [];
    const facts: Record<string, IndexerFileFactsRow> = {
      'b.ts': { filePath: 'b.ts', endpoints: ['GET /b'], crons: [] },
      'c.ts': { filePath: 'c.ts', endpoints: ['GET /c'], crons: [] },
    };

    const svc = buildService({
      getSymbolRows: async (_repoId, paths) =>
        paths.includes('a.ts') ? oneChangedSymbolRows('a.ts') : [],
      getImporters: async (_repoId, toFiles) => {
        importerCalls.push([...toFiles].sort());
        return edges.filter((e) => toFiles.includes(e.toFile));
      },
      getFileFacts: async (_repoId, files) =>
        files.map((f) => facts[f]).filter((f): f is IndexerFileFactsRow => !!f),
    });

    const blast = await svc.getBlastRadius('r1', ['a.ts']);

    expect(importerCalls).toHaveLength(2);
    // Both b.ts and c.ts stay at hop 1 — neither is re-expanded/bumped by
    // the cycle, and the closure terminates cleanly.
    expect(blast.impactedEndpointRows).toEqual([
      { endpoint: 'GET /b', file: 'b.ts', hops: 1 },
      { endpoint: 'GET /c', file: 'c.ts', hops: 1 },
    ]);
    expect(blast.endpointsTruncated).toBe(false);
  });

  it('MAX_BLAST_GRAPH_FILES truncation keeps the highest-ranked files and sets endpointsTruncated', async () => {
    const total = MAX_BLAST_GRAPH_FILES + 10;
    const importerFiles = Array.from({ length: total }, (_, i) => `f${i}.ts`);
    // f0 has the highest percentile (most important), f_last the lowest.
    const percentileByFile = new Map(importerFiles.map((f, i) => [f, total - i]));

    const rankCalls: string[][] = [];
    const importerCalls: string[][] = [];

    const svc = buildService({
      getSymbolRows: async (_repoId, paths) =>
        paths.includes('seed.ts') ? oneChangedSymbolRows('seed.ts') : [],
      getImporters: async (_repoId, toFiles) => {
        importerCalls.push([...toFiles]);
        if (toFiles.length === 1 && toFiles[0] === 'seed.ts') {
          return importerFiles.map((f) => ({ fromFile: f, toFile: 'seed.ts' }));
        }
        return []; // hop 2: no further importers in this fixture
      },
      getFileRankFor: async (_repoId, paths) => {
        rankCalls.push([...paths]);
        return paths
          .filter((p) => percentileByFile.has(p))
          .map((p) => ({ path: p, percentile: percentileByFile.get(p)! }));
      },
      getFileFacts: async (_repoId, files) => {
        const out: IndexerFileFactsRow[] = [];
        if (files.includes('f0.ts')) out.push({ filePath: 'f0.ts', endpoints: ['GET /0'], crons: [] });
        if (files.includes('f309.ts')) {
          out.push({ filePath: 'f309.ts', endpoints: ['GET /overflow'], crons: [] });
        }
        return out;
      },
    });

    const blast = await svc.getBlastRadius('r1', ['seed.ts']);

    expect(blast.endpointsTruncated).toBe(true);
    // Rank was consulted to decide the overflow keep-set.
    expect(rankCalls.length).toBeGreaterThan(0);
    // The highest-ranked overflow file (f0) survived into the closure...
    expect(blast.impactedEndpointRows).toContainEqual({ endpoint: 'GET /0', file: 'f0.ts', hops: 1 });
    // ...the lowest-ranked one (past the last real index) did not.
    expect(blast.impactedEndpointRows).not.toContainEqual(
      expect.objectContaining({ file: 'f309.ts' }),
    );
  });
});

describe('caller capping (§5) — per-symbol, not global', () => {
  it('30 callers across 3 symbols cap at 20 PER symbol, not 20 total; callersTotal reports the pre-cap count', async () => {
    const symbols = ['symA', 'symB', 'symC'];
    const declRows: FullSymbolRow[] = symbols.map((name, i) => ({
      path: 'src/a.ts',
      name,
      kind: 'function',
      line: 1 + i * 10,
      endLine: 2 + i * 10,
      exported: true,
      signature: null,
    }));

    const callerRows: ResolvedCallerRow[] = [];
    const callerSymbolRows: FullSymbolRow[] = [];
    for (const sym of symbols) {
      for (let i = 0; i < 30; i += 1) {
        const file = `callers/${sym}-${i}.ts`;
        callerRows.push({ fromPath: file, toSymbol: sym, line: 1, rank: 100 - i, percentile: 50 });
        callerSymbolRows.push({
          path: file,
          name: `caller_${sym}_${i}`,
          kind: 'function',
          line: 1,
          endLine: 2,
          exported: true,
          signature: null,
        });
      }
    }

    const svc = buildService({
      getSymbolRows: async (_repoId, paths) => {
        if (paths.includes('src/a.ts')) return declRows;
        return callerSymbolRows.filter((r) => paths.includes(r.path));
      },
      getResolvedCallers: async () => callerRows,
    });

    const blast = await svc.getBlastRadius('r1', ['src/a.ts']);

    expect(blast.callersTotal).toBe(90);
    expect(blast.callersTruncated).toBe(true);
    for (const sym of symbols) {
      const forSymbol = blast.callers.filter((c) => c.viaSymbol === sym);
      expect(forSymbol).toHaveLength(20);
    }
    expect(blast.callers).toHaveLength(60); // 3 * 20, well under MAX_BLAST_CALLERS_TOTAL
    // percentile flows through from the ResolvedCallerRow stub, unchanged.
    expect(blast.callers.every((c) => c.percentile === 50)).toBe(true);
  });
});

describe('total ordering — deterministic regardless of stub row order', () => {
  it('shuffling callers/symbols/facts input order yields an identical result', async () => {
    const declRows: FullSymbolRow[] = [
      { path: 'a.ts', name: 'foo', kind: 'function', line: 1, endLine: 2, exported: true, signature: null },
      { path: 'a.ts', name: 'bar', kind: 'function', line: 5, endLine: 6, exported: true, signature: null },
    ];
    const callerRowsBase: ResolvedCallerRow[] = [
      // percentile is deliberately in the OPPOSITE order of rank on every row
      // below (c1 has the lowest rank but the highest percentile, etc.) — if
      // percentile ever became a sort key or tiebreaker this test would catch
      // the reordering.
      { fromPath: 'c1.ts', toSymbol: 'foo', line: 1, rank: 5, percentile: 90 },
      { fromPath: 'c2.ts', toSymbol: 'foo', line: 2, rank: 5, percentile: 95 }, // rank tie with c1 -> file ASC breaks it
      { fromPath: 'c3.ts', toSymbol: 'bar', line: 1, rank: 9, percentile: 10 },
    ];
    const callerSymbolRowsBase: FullSymbolRow[] = [
      { path: 'c1.ts', name: 'callerFn1', kind: 'function', line: 1, endLine: 2, exported: true, signature: null },
      { path: 'c2.ts', name: 'callerFn2', kind: 'function', line: 1, endLine: 2, exported: true, signature: null },
      { path: 'c3.ts', name: 'callerFn3', kind: 'function', line: 1, endLine: 2, exported: true, signature: null },
    ];

    async function run(reversed: boolean) {
      const dr = reversed ? [...declRows].reverse() : declRows;
      const cr = reversed ? [...callerRowsBase].reverse() : callerRowsBase;
      const csr = reversed ? [...callerSymbolRowsBase].reverse() : callerSymbolRowsBase;
      const svc = buildService({
        getSymbolRows: async (_repoId, paths) =>
          paths.includes('a.ts') ? dr : csr.filter((s) => paths.includes(s.path)),
        getResolvedCallers: async () => cr,
      });
      return svc.getBlastRadius('r1', ['a.ts']);
    }

    const forward = await run(false);
    const shuffled = await run(true);

    expect(forward).toEqual(shuffled);
    expect(forward.changedSymbols.map((s) => s.name)).toEqual(['bar', 'foo']);
    // the declaration line flows through to the facade unchanged.
    expect(forward.changedSymbols.map((s) => s.line)).toEqual([5, 1]);
    // rank DESC (c3=9 first), then rank-tie file ASC (c1 before c2) — NOT
    // percentile order, even though c3 has the LOWEST percentile of the
    // three: percentile must never become a sort key or tiebreaker.
    expect(forward.callers.map((c) => c.file)).toEqual(['c3.ts', 'c1.ts', 'c2.ts']);
    expect(forward.callers.map((c) => c.percentile)).toEqual([10, 90, 95]);
  });
});
