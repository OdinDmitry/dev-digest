import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  WORKFLOW_VERSION,
  type CiTriggerEvent,
  type CiWorkflowValidation,
  type CiSecretExpectation,
} from '@devdigest/shared';
import {
  ACTION_CHECKOUT,
  ACTION_UPLOAD_ARTIFACT,
  RESULT_ARTIFACT_NAME,
  RESULT_FILE,
  RUNNER_PATH,
  SECRET_GITHUB_TOKEN,
  SECRET_MODEL_KEY,
  WORKFLOW_VERSION_MARKER,
} from './constants.js';

/**
 * Pure generators (ring 2) for the exported GitHub Actions workflow. No HTTP,
 * no SQL, no GitHub calls — `CiService` is the only caller.
 */

const VERSION_RE = new RegExp(`^${WORKFLOW_VERSION_MARKER}\\s*(\\S+)`, 'm');

/**
 * Build the generated workflow YAML, in this order: the version marker
 * comment, `name`, `on.pull_request.types` built from `triggers` and nothing
 * else (AC-21), `permissions: { contents: read, pull-requests: write }` and no
 * other permission (NFR), one job with `actions/checkout` pinned by sha, a
 * `run: node .devdigest/runner/index.js` step whose `env` passes
 * `OPENROUTER_API_KEY` and `GITHUB_TOKEN` as `${{ secrets.* }}`
 * interpolations plus `GITHUB_REPOSITORY` and `PR_NUMBER`, and a final
 * `if: always()` upload of `devdigest-result.json` with
 * `if-no-files-found: ignore`. Uses `pull_request`, never
 * `pull_request_target` (NFR: no trigger that hands a fork's code a writable
 * credential). No `setup-node` step — the hosted runner's own Node provides
 * `fetch`.
 */
export function buildWorkflow(triggers: CiTriggerEvent[]): string {
  const doc = {
    name: 'DevDigest Review',
    on: {
      pull_request: {
        types: triggers,
      },
    },
    permissions: {
      contents: 'read',
      'pull-requests': 'write',
    },
    jobs: {
      review: {
        'runs-on': 'ubuntu-latest',
        steps: [
          { uses: ACTION_CHECKOUT },
          {
            name: 'Run DevDigest review',
            run: `node ${RUNNER_PATH}`,
            env: {
              OPENROUTER_API_KEY: `\${{ secrets.${SECRET_MODEL_KEY} }}`,
              GITHUB_TOKEN: `\${{ secrets.${SECRET_GITHUB_TOKEN} }}`,
              GITHUB_REPOSITORY: '${{ github.repository }}',
              PR_NUMBER: '${{ github.event.pull_request.number }}',
            },
          },
          {
            name: 'Upload DevDigest result',
            if: 'always()',
            uses: ACTION_UPLOAD_ARTIFACT,
            with: {
              name: RESULT_ARTIFACT_NAME,
              path: RESULT_FILE,
              'if-no-files-found': 'ignore',
            },
          },
        ],
      },
    },
  };
  return `${WORKFLOW_VERSION_MARKER} ${WORKFLOW_VERSION}\n${stringifyYaml(doc)}`;
}

/** Read the `# devdigest-workflow-version:` marker (AC-8/AC-9). Not a hash of
 *  the contents — a hash would report a user-edited workflow as out of date. */
export function readWorkflowVersion(contents: string): string | null {
  const match = contents.match(VERSION_RE);
  return match?.[1] ?? null;
}

/**
 * `yaml.parse` inside a try/catch, then three structural checks: the
 * document is an object, it has an `on` key, and it has a non-empty `jobs`
 * object. Returns a reason string, never throws. Deliberately does NOT check
 * that the runner step survived a user's edit — the spec says the export
 * cannot detect that and does not try.
 */
export function validateWorkflow(contents: string): CiWorkflowValidation {
  let doc: unknown;
  try {
    doc = parseYaml(contents);
  } catch (err) {
    return { valid: false, error: `Not valid YAML: ${(err as Error).message}` };
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return { valid: false, error: 'Workflow must be a YAML mapping (object)' };
  }
  const obj = doc as Record<string, unknown>;
  if (!('on' in obj)) {
    return { valid: false, error: 'Workflow is missing an "on" trigger key' };
  }
  const jobs = obj.jobs;
  const isEmptyJobs =
    typeof jobs !== 'object' || jobs === null || Array.isArray(jobs) || Object.keys(jobs).length === 0;
  if (isEmptyJobs) {
    return { valid: false, error: 'Workflow must have at least one job under "jobs"' };
  }
  return { valid: true, error: null };
}

const SECRET_RE = /\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/g;

/**
 * One entry per DISTINCT `secrets.<KEY>` interpolation found in the workflow
 * text, with `provided_by_platform === (key === 'GITHUB_TOKEN')`. Derived
 * from the key alone — never a lookup against any secret store (AC-4).
 */
export function expectedSecrets(contents: string): CiSecretExpectation[] {
  const seen = new Set<string>();
  const result: CiSecretExpectation[] = [];
  for (const match of contents.matchAll(SECRET_RE)) {
    const key = match[1]!;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ key, provided_by_platform: key === SECRET_GITHUB_TOKEN });
  }
  return result;
}
