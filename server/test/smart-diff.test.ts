import { describe, it, expect } from 'vitest';
import { SmartDiff } from '@devdigest/shared';
import { classifyPath, groupFiles } from '../src/modules/smart-diff/classify.js';
import { buildSplitSuggestion } from '../src/modules/smart-diff/split.js';
import { toSmartDiffFile, toSmartDiffFiles } from '../src/modules/smart-diff/helpers.js';
import { SmartDiffService } from '../src/modules/smart-diff/service.js';
import { SPLIT_TOO_BIG_LINES, SPLIT_MAX_PROPOSALS, SPLIT_REMAINDER_NAME } from '../src/modules/smart-diff/constants.js';

/**
 * Hermetic (no DB) coverage for the smart-diff module: pure classification,
 * grouping/ordering, finding-ref attachment, split suggestion, and the
 * service driven against a stub repository.
 */

describe('classifyPath', () => {
  it('every common lockfile classifies boilerplate', () => {
    const lockfiles = [
      'package-lock.json',
      'npm-shrinkwrap.json',
      'pnpm-lock.yaml',
      'yarn.lock',
      'bun.lockb',
      'Cargo.lock',
      'poetry.lock',
      'uv.lock',
      'Gemfile.lock',
      'composer.lock',
      'go.sum',
    ];
    for (const f of lockfiles) {
      expect(classifyPath(f)).toBe('boilerplate');
      expect(classifyPath(`nested/dir/${f}`)).toBe('boilerplate');
    }
  });

  it('boilerplate wins over wiring — dist/index.ts is boilerplate, not wiring', () => {
    expect(classifyPath('dist/index.ts')).toBe('boilerplate');
  });

  it('build output / minified / generated paths classify boilerplate', () => {
    expect(classifyPath('build/main.js')).toBe('boilerplate');
    expect(classifyPath('out/bundle.js')).toBe('boilerplate');
    expect(classifyPath('.next/server/app.js')).toBe('boilerplate');
    expect(classifyPath('coverage/lcov.info')).toBe('boilerplate');
    expect(classifyPath('vendor/lib.rb')).toBe('boilerplate');
    expect(classifyPath('node_modules/foo/index.js')).toBe('boilerplate');
    expect(classifyPath('src/app.min.js')).toBe('boilerplate');
    expect(classifyPath('src/app.min.css')).toBe('boilerplate');
    expect(classifyPath('src/app.js.map')).toBe('boilerplate');
    expect(classifyPath('src/__snapshots__/App.test.js.snap')).toBe('boilerplate');
    expect(classifyPath('src/foo.snap')).toBe('boilerplate');
    expect(classifyPath('src/schema.generated.ts')).toBe('boilerplate');
    expect(classifyPath('src/api.gen.ts')).toBe('boilerplate');
    expect(classifyPath('proto/foo_pb.js')).toBe('boilerplate');
    expect(classifyPath('proto/foo.pb.go')).toBe('boilerplate');
    expect(classifyPath('src/generated/client.ts')).toBe('boilerplate');
  });

  it('does not false-positive a "build"-like segment that is not a directory boundary', () => {
    expect(classifyPath('src/rebuild/foo.ts')).toBe('core');
  });

  it('wiring: config/tooling/CI/dotfiles/barrels/types/i18n/docs', () => {
    expect(classifyPath('package.json')).toBe('wiring');
    expect(classifyPath('tsconfig.json')).toBe('wiring');
    expect(classifyPath('tsconfig.build.json')).toBe('wiring');
    expect(classifyPath('vite.config.ts')).toBe('wiring');
    expect(classifyPath('src/config.ts')).toBe('wiring');
    expect(classifyPath('src/config/index.ts')).toBe('wiring');
    expect(classifyPath('.github/workflows/ci.yml')).toBe('wiring');
    expect(classifyPath('Dockerfile')).toBe('wiring');
    expect(classifyPath('docker-compose.yml')).toBe('wiring');
    expect(classifyPath('.env.example')).toBe('wiring');
    expect(classifyPath('.eslintrc.json')).toBe('wiring');
    expect(classifyPath('.prettierrc')).toBe('wiring');
    expect(classifyPath('.gitignore')).toBe('wiring');
    expect(classifyPath('.npmrc')).toBe('wiring');
    expect(classifyPath('src/api/index.ts')).toBe('wiring');
    expect(classifyPath('src/types.d.ts')).toBe('wiring');
    expect(classifyPath('messages/en/prReview.json')).toBe('wiring');
    expect(classifyPath('README.md')).toBe('wiring');
    expect(classifyPath('docs/architecture.md')).toBe('wiring');
  });

  it('test files stay core (deliberate — a test change is often the change under review)', () => {
    expect(classifyPath('src/middleware/ratelimit.ts')).toBe('core');
    expect(classifyPath('src/foo.test.ts')).toBe('core');
  });
});

describe('groupFiles', () => {
  it('groups in role order, omits empty groups', () => {
    const files = [
      toSmartDiffFile({ path: 'package-lock.json', additions: 10, deletions: 0 }, []),
      toSmartDiffFile({ path: 'src/foo.ts', additions: 5, deletions: 0 }, []),
    ];
    const groups = groupFiles(files);
    expect(groups.map((g) => g.role)).toEqual(['core', 'boilerplate']);
  });

  it('sorts within a group: finding count DESC, then changed lines DESC, then path ASC', () => {
    const files = [
      toSmartDiffFile({ path: 'src/b.ts', additions: 100, deletions: 0 }, []),
      toSmartDiffFile(
        { path: 'src/a.ts', additions: 1, deletions: 0 },
        [{ findingId: 'f1', file: 'src/a.ts', line: 1, severity: 'CRITICAL' }],
      ),
      toSmartDiffFile({ path: 'src/c.ts', additions: 1, deletions: 0 }, []),
    ];
    const groups = groupFiles(files);
    const core = groups.find((g) => g.role === 'core')!;
    expect(core.files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });
});

describe('toSmartDiffFile / toSmartDiffFiles', () => {
  it('attaches findings by exact path match, sorted by line ASC then finding_id ASC, not deduplicated', () => {
    const file = toSmartDiffFile(
      { path: 'src/a.ts', additions: 10, deletions: 0 },
      [
        { findingId: 'f-b', file: 'src/a.ts', line: 5, severity: 'WARNING' },
        { findingId: 'f-a', file: 'src/a.ts', line: 5, severity: 'CRITICAL' },
        { findingId: 'f-c', file: 'src/a.ts', line: 2, severity: 'SUGGESTION' },
        { findingId: 'f-other-file', file: 'src/other.ts', line: 1, severity: 'CRITICAL' },
      ],
    );
    expect(file.pseudocode_summary).toBeNull();
    expect(file.findings).toEqual([
      { line: 2, finding_id: 'f-c' },
      { line: 5, finding_id: 'f-a' },
      { line: 5, finding_id: 'f-b' },
    ]);
  });

  it('findings whose file matches no changed file are ignored', () => {
    const files = toSmartDiffFiles(
      [{ path: 'src/a.ts', additions: 1, deletions: 0 }],
      [{ findingId: 'f1', file: 'src/no-such-file.ts', line: 1, severity: 'CRITICAL' }],
    );
    expect(files[0]!.findings).toEqual([]);
  });
});

describe('buildSplitSuggestion', () => {
  it('below threshold: too_big false, no proposals', () => {
    const result = buildSplitSuggestion([{ path: 'a.ts', additions: 10, deletions: 0 }]);
    expect(result.too_big).toBe(false);
    expect(result.total_lines).toBe(10);
    expect(result.proposed_splits).toEqual([]);
  });

  it('above threshold: buckets by first path segment, remainder bucket, every file present exactly once', () => {
    const files = [
      { path: 'a/one.ts', additions: SPLIT_TOO_BIG_LINES + 1, deletions: 0 },
      { path: 'b/one.ts', additions: 10, deletions: 0 },
      { path: 'c/one.ts', additions: 9, deletions: 0 },
      { path: 'd/one.ts', additions: 8, deletions: 0 },
      { path: 'e/one.ts', additions: 7, deletions: 0 },
      { path: 'root.ts', additions: 1, deletions: 0 },
    ];
    const result = buildSplitSuggestion(files);
    expect(result.too_big).toBe(true);

    const allSplitFiles = result.proposed_splits.flatMap((s) => s.files);
    expect(allSplitFiles.sort()).toEqual(files.map((f) => f.path).sort());

    // at most SPLIT_MAX_PROPOSALS named buckets + one remainder bucket
    expect(result.proposed_splits.length).toBeLessThanOrEqual(SPLIT_MAX_PROPOSALS + 1);
    const remainder = result.proposed_splits.find((s) => s.name === SPLIT_REMAINDER_NAME);
    expect(remainder).toBeDefined();
  });

  it('root-level files bucket under the root bucket name', () => {
    const files = Array.from({ length: 1 }, (_, i) => ({
      path: `root-${i}.ts`,
      additions: SPLIT_TOO_BIG_LINES + 1,
      deletions: 0,
    }));
    const result = buildSplitSuggestion(files);
    expect(result.proposed_splits[0]!.name).toBe('(root)');
  });
});

describe('SmartDiff.parse on a fully-built response', () => {
  it('validates end-to-end', () => {
    const files = toSmartDiffFiles(
      [
        { path: 'src/a.ts', additions: 5, deletions: 0 },
        { path: 'package-lock.json', additions: 100, deletions: 0 },
      ],
      [{ findingId: 'f1', file: 'src/a.ts', line: 3, severity: 'CRITICAL' }],
    );
    const groups = groupFiles(files);
    const split_suggestion = buildSplitSuggestion(files);
    expect(() => SmartDiff.parse({ groups, split_suggestion })).not.toThrow();
  });
});

describe('SmartDiffService', () => {
  it('throws NotFoundError when the pull is not found in the workspace', async () => {
    const service = new SmartDiffService({
      reviews: {
        pullExists: async () => false,
        prFileSummaries: async () => [],
        latestFindingLocations: async () => [],
      },
    });
    await expect(service.get('ws1', 'pr1')).rejects.toThrow('Pull request not found');
  });

  it('composes groups + split suggestion from the repository reads', async () => {
    const service = new SmartDiffService({
      reviews: {
        pullExists: async () => true,
        prFileSummaries: async () => [
          { path: 'src/a.ts', additions: 5, deletions: 0 },
          { path: 'package-lock.json', additions: 3, deletions: 0 },
        ],
        latestFindingLocations: async () => [
          { findingId: 'f1', file: 'src/a.ts', line: 1, severity: 'CRITICAL' },
        ],
      },
    });
    const result = await service.get('ws1', 'pr1');
    expect(result.groups.map((g) => g.role)).toEqual(['core', 'boilerplate']);
    expect(result.groups[0]!.files[0]!.findings).toEqual([{ line: 1, finding_id: 'f1' }]);
    expect(result.split_suggestion.total_lines).toBe(8);
  });

  it('empty PR returns empty groups and a zero split suggestion', async () => {
    const service = new SmartDiffService({
      reviews: {
        pullExists: async () => true,
        prFileSummaries: async () => [],
        latestFindingLocations: async () => [],
      },
    });
    const result = await service.get('ws1', 'pr1');
    expect(result.groups).toEqual([]);
    expect(result.split_suggestion).toEqual({ too_big: false, total_lines: 0, proposed_splits: [] });
  });
});
