/**
 * Export-to-CI module constants (ring 2). Literal paths, filenames, and the
 * pinned external action revisions the generated workflow embeds — see
 * `docs/plans/2026-08-28-export-to-ci-a-contracts-generation-install.md`'s
 * Frozen surface.
 */

export const CI_BRANCH = 'devdigest/ci';
export const CI_PR_TITLE = 'Add DevDigest CI review';
export const WORKFLOW_PATH = '.github/workflows/devdigest-review.yml';
export const WORKFLOW_FILE = 'devdigest-review.yml'; // Phase B looks runs up by this
export const MANIFEST_DIR = '.devdigest/agents';
export const SKILLS_DIR = '.devdigest/skills';
export const RUNNER_PATH = '.devdigest/runner/index.js';
export const RESULT_ARTIFACT_NAME = 'devdigest-result';
export const RESULT_FILE = 'devdigest-result.json';
export const WORKFLOW_VERSION_MARKER = '# devdigest-workflow-version:';
/** Pinned to an exact immutable revision (spec NFR); tags resolved 2026-08-28. */
export const ACTION_CHECKOUT = 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683'; // v4.2.2
export const ACTION_UPLOAD_ARTIFACT =
  'actions/upload-artifact@b4b15b8c7c6ac21ea08fcf65892d2ee8f75cf882'; // v4.4.3
export const SECRET_MODEL_KEY = 'OPENROUTER_API_KEY';
export const SECRET_GITHUB_TOKEN = 'GITHUB_TOKEN';
