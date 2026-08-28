import { z } from 'zod';
import { Verdict, Finding } from './findings.js';
import { EvalExpectation, EvalCaseOrigin, EvalRunState, EvalPerTrace, Conformance, Provider, CiFailOn } from './knowledge.js';

/**
 * A4 — Eval / CI / Compose / Conformance API contracts (L06).
 *
 * These EXTEND the barrel; they do not modify existing contract files. The base
 * `EvalRun`, `EvalCase`, `EvalOwnerKind`, `Conformance` live in `knowledge.ts`;
 * here we add the *API-facing* request/response shapes (records persisted in
 * `eval_runs`, `composed_reviews`, `ci_installations`, `ci_runs`,
 * `conformance_checks`) plus the eval-dashboard aggregate.
 */

// ===========================================================================
// Eval — case input + persisted run record + dashboard
// ===========================================================================

/**
 * Create/update payload for an eval case. `owner_kind`/`owner_id` are NOT
 * accepted here — the owning agent is derived server-side from the route
 * (security A08: never trust ownership from the request body).
 */
export const EvalCaseInput = z.object({
  name: z.string().min(1),
  input_diff: z.string().min(1),
  repo_id: z.string().uuid().nullable(),
  expectations: z.array(EvalExpectation),
  notes: z.string().nullish(),
});
export type EvalCaseInput = z.infer<typeof EvalCaseInput>;

export const EvalCaseUpdate = EvalCaseInput.partial();
export type EvalCaseUpdate = z.infer<typeof EvalCaseUpdate>;

export const EvalMetricDelta = z.object({
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  cost_usd: z.number().nullable(),
});
export type EvalMetricDelta = z.infer<typeof EvalMetricDelta>;

/** One row of an agent's run history. RESHAPED. */
export const EvalRunRecord = z.object({
  id: z.string(),
  agent_id: z.string(),
  started_at: z.string(),
  state: EvalRunState,
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  errored_count: z.number().int(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
  delta: EvalMetricDelta.nullable(), // AC-38; null for the earliest run
});
export type EvalRunRecord = z.infer<typeof EvalRunRecord>;

/** A preview result, never stored (AC-33). RESHAPED. */
export const EvalRunResult = z.object({
  case_id: z.string(),
  stored: z.literal(false),
  result: EvalPerTrace,
});
export type EvalRunResult = z.infer<typeof EvalRunResult>;

/**
 * One point on the dashboard trend (per run, chronological). Unreferenced —
 * `EvalDashboard` no longer carries `trend`; kept as unused starter
 * scaffolding per root CLAUDE.md ("don't repurpose or clean up unused tables").
 */
export const EvalTrendPoint = z.object({
  ran_at: z.string(),
  recall: z.number(),
  precision: z.number(),
  citation_accuracy: z.number(),
  pass_rate: z.number(),
  cost_usd: z.number().nullable(),
});
export type EvalTrendPoint = z.infer<typeof EvalTrendPoint>;

export const EvalDashboardEntry = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  model: z.string(),
  cases_total: z.number().int(),
  never_run: z.boolean(),
  running: z.boolean(),
  last_run_started_at: z.string().nullable(),
  traces_passed: z.number().int().nullable(),
  traces_total: z.number().int().nullable(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
});
export type EvalDashboardEntry = z.infer<typeof EvalDashboardEntry>;

/** The workspace dashboard (no trend, no alert: both are non-goals). RESHAPED. */
export const EvalDashboard = z.object({
  agents: z.array(EvalDashboardEntry),
  // AC-32's confirmation payload, read with the dashboard so no extra call is
  // needed before the confirm dialog opens.
  run_all: z.object({ agent_count: z.number().int(), case_count: z.number().int() }),
});
export type EvalDashboard = z.infer<typeof EvalDashboard>;

// NEW (no existing slot) — Phase B fills it, Phase C renders it.
export const EvalPromptDiffLine = z.object({
  kind: z.enum(['same', 'added', 'removed']),
  text: z.string(),
});
export type EvalPromptDiffLine = z.infer<typeof EvalPromptDiffLine>;

export const EvalComparisonMetric = z.object({
  key: z.enum(['recall', 'precision', 'citation_accuracy', 'cost_usd']),
  earlier: z.number().nullable(),
  later: z.number().nullable(),
  delta: z.number().nullable(),
});
export type EvalComparisonMetric = z.infer<typeof EvalComparisonMetric>;

export const EvalComparison = z.object({
  earlier: EvalRunRecord,
  later: EvalRunRecord,
  metrics: z.array(EvalComparisonMetric),
  prompt_diff: z.array(EvalPromptDiffLine),
  case_sets_differ: z.boolean(),
  earlier_case_count: z.number().int(),
  later_case_count: z.number().int(),
  context_differs: z.boolean(),
});
export type EvalComparison = z.infer<typeof EvalComparison>;

// NEW — the prefill returned for a finding (AC-1/AC-3/AC-4); persists nothing.
export const EvalCaseSeed = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  repo_id: z.string(),
  repo_full_name: z.string(),
  name: z.string(),
  input_diff: z.string(),
  expectations: z.array(EvalExpectation),
  origin: EvalCaseOrigin,
  /** Set when this finding already seeded a case — create must not duplicate. */
  existing_case_id: z.string().nullable(),
});
export type EvalCaseSeed = z.infer<typeof EvalCaseSeed>;

// ===========================================================================
// Compose Review
// ===========================================================================

export const ComposeReviewInput = z.object({
  /** Finding ids to fold into the draft (optional — body may be hand-written). */
  finding_ids: z.array(z.string()).default([]),
  /** Editable markdown body. If omitted, the server composes one from findings. */
  body: z.string().nullish(),
  verdict: Verdict.default('comment'),
  /** When true, attach selected findings as inline comments (path+line+body). */
  inline_comments: z.boolean().default(false),
});
export type ComposeReviewInput = z.infer<typeof ComposeReviewInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type ComposeReviewInputBody = z.input<typeof ComposeReviewInput>;

/** A persisted composed review (mirrors the `composed_reviews` row). */
export const ComposedReview = z.object({
  id: z.string(),
  pr_id: z.string(),
  body: z.string(),
  verdict: Verdict.nullable(),
  posted_at: z.string().nullable(),
  github_review_id: z.string().nullable(),
});
export type ComposedReview = z.infer<typeof ComposedReview>;

/** A preview (no GitHub side-effect) of what would be posted. */
export const ComposeReviewPreview = z.object({
  body: z.string(),
  verdict: Verdict,
  inline_comments: z.array(
    z.object({ path: z.string(), line: z.number().int(), body: z.string() }),
  ),
});
export type ComposeReviewPreview = z.infer<typeof ComposeReviewPreview>;

// ===========================================================================
// Export-to-CI + CI Runs
// ===========================================================================

export const CiTarget = z.enum(['gha', 'circle', 'jenkins', 'cli']);
export type CiTarget = z.infer<typeof CiTarget>;

/** Shape version of AgentManifest. Bump when the manifest's SHAPE changes. */
export const MANIFEST_VERSION = 1;
/** Stamped into the generated workflow and recorded on the installation. */
export const WORKFLOW_VERSION = '1';

export const CiPostAs = z.enum(['github_review', 'pr_comment', 'none']);
export type CiPostAs = z.infer<typeof CiPostAs>;
export const CiTriggerEvent = z.enum(['opened', 'synchronize', 'reopened']);
export type CiTriggerEvent = z.infer<typeof CiTriggerEvent>;
export const CiVerdict = z.enum(['approved', 'changes_requested', 'commented', 'skipped']);
export type CiVerdict = z.infer<typeof CiVerdict>;

/**
 * One generated file in the CI bundle (path + editable contents). `editable`
 * is explicit, never defaulted — exactly one generated file is editable and
 * the generator always says which.
 */
export const CiFile = z.object({
  path: z.string(),
  contents: z.string(),
  editable: z.boolean(),
});
export type CiFile = z.infer<typeof CiFile>;

/**
 * AgentManifest — the agent contract shared by the studio and the CI runner.
 *
 * The studio (`CiService`) WRITES this shape to `.devdigest/agents/<slug>.yaml`;
 * the agent-runner READS it. Keeping one Zod schema for both ends guarantees the
 * formats never drift. `skills` are slugs resolved to `.devdigest/skills/<slug>.md`.
 */
export const AgentManifest = z.object({
  manifest_version: z.number().int().positive().default(MANIFEST_VERSION),
  name: z.string().min(1),
  provider: Provider.default('openrouter'),
  model: z.string().min(1),
  system_prompt: z.string(),
  // Tolerate both a missing key and an explicit `null` (YAML `skills:` with no
  // value parses to null, which `.default([])` does NOT catch) — normalize both
  // to an empty array so manifests without skills validate cleanly.
  skills: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  strategy: z.enum(['auto', 'single-pass', 'map-reduce']).default('auto'),
  // CI gate policy (see CiFailOn) — when the posted review should BLOCK
  // (REQUEST_CHANGES + fail the check) vs just comment. Default: block on critical.
  ci_fail_on: CiFailOn.default('critical'),
  // Publication mode carried through from the export request (AC-11).
  post_as: CiPostAs.default('github_review'),
});
export type AgentManifest = z.infer<typeof AgentManifest>;
/** Caller-facing input type — `.default()` fields stay optional. */
export type AgentManifestInput = z.input<typeof AgentManifest>;

/**
 * AC-4. `provided_by_platform` is a property of the PLATFORM, never a lookup
 * against any secret store — the studio never reads a secret's value.
 */
export const CiSecretExpectation = z.object({
  key: z.string(),
  provided_by_platform: z.boolean(),
});
export type CiSecretExpectation = z.infer<typeof CiSecretExpectation>;

/** Request body for the CI preview/install routes. */
export const CiExportInput = z.object({
  repo_id: z.string().uuid(),
  target: CiTarget.default('gha'),
  post_as: CiPostAs.default('github_review'),
  triggers: z.array(CiTriggerEvent).min(1).default(['opened', 'synchronize']),
  /** null → the repo's default branch. */
  base: z.string().min(1).nullish(),
  /** AC-22; null → generate it. */
  workflow_contents: z.string().nullish(),
});
export type CiExportInput = z.infer<typeof CiExportInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type CiExportInputBody = z.input<typeof CiExportInput>;

/** Response of the preview route. No GitHub side effect. */
export const CiExportPreview = z.object({
  files: z.array(CiFile), // AC-2
  workflow_version: z.string(),
  expected_secrets: z.array(CiSecretExpectation),
  repo: z.string(), // "owner/name", resolved server-side
  base: z.string(),
  ci_fail_on: CiFailOn, // the threshold that would be exported
  skill_count: z.number().int(), // 0 → "no skills attached"
});
export type CiExportPreview = z.infer<typeof CiExportPreview>;

/** A persisted CI installation (mirrors `ci_installations`). */
export const CiInstallation = z.object({
  id: z.string(),
  agent_id: z.string(),
  agent_name: z.string().nullable(),
  repo: z.string(),
  target_type: CiTarget,
  installed_at: z.string(),
  updated_at: z.string(),
  workflow_version: z.string().nullable(), // null = unknown ⇒ NOT current
  pr_url: z.string().nullable(),
  ci_fail_on: CiFailOn,
  current: z.boolean(), // AC-9, computed by installationToDto
});
export type CiInstallation = z.infer<typeof CiInstallation>;

/** Response of the install route. */
export const CiExport = z.object({
  installation: CiInstallation,
  files: z.array(CiFile),
  pr_url: z.string(),
});
export type CiExport = z.infer<typeof CiExport>;

/** AC-3 — the answer the wizard blocks on. */
export const CiWorkflowValidation = z.object({
  valid: z.boolean(),
  error: z.string().nullable(),
});
export type CiWorkflowValidation = z.infer<typeof CiWorkflowValidation>;

// The observable states of a run the studio holds. `rejected` is NOT a
// member: a rejected result records nothing (AC-15) and is reported on the
// refresh response instead.
export const CiRunStatus = z.enum(['in_progress', 'recorded', 'unavailable']);
export type CiRunStatus = z.infer<typeof CiRunStatus>;

/** A CI run row (mirrors `ci_runs`) — ingested from GitHub Actions artifacts. */
export const CiRun = z.object({
  id: z.string(),
  ci_installation_id: z.string().nullable(),
  agent_id: z.string().nullable(),
  agent_name: z.string().nullable(),
  repo: z.string(),
  pr_number: z.number().int().nullable(),
  head_sha: z.string().nullable(),
  status: CiRunStatus,
  verdict: CiVerdict.nullable(),
  unavailable_reason: z.string().nullable(),
  findings_count: z.number().int().nullable(),
  critical: z.number().int().nullable(),
  warning: z.number().int().nullable(),
  suggestion: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
  ran_at: z.string().nullable(),
  job_url: z.string(), // AC-16 "the location of the job"
  model: z.string().nullable(),
  manifest_version: z.number().int().nullable(),
  runner_build: z.string().nullable(),
});
export type CiRun = z.infer<typeof CiRun>;

/**
 * The artifact shape uploaded by the CI action (`devdigest-result.json`).
 * Ingested back on refresh to populate `ci_runs` (L06). Carries no secret,
 * no finding text (AC-13).
 */
export const CiResultArtifact = z.object({
  schema_version: z.number().int().positive().default(1),
  repo: z.string().min(1), // "owner/name"                (AC-15)
  head_sha: z.string().min(1), // pull_request.head.sha       (AC-15, US-8)
  workflow_sha: z.string().min(1), // process.env.GITHUB_SHA      (see Open questions)
  pr_number: z.number().int().positive(), // (AC-15)
  agent: z.string().min(1),
  manifest_version: z.number().int().positive(), // (US-8)
  model: z.string().min(1), // (US-8)
  runner_build: z.string().min(1), // replaces `version`         (US-8)
  verdict: CiVerdict, // (AC-16, AC-23)
  /** Non-null only when `verdict === 'skipped'` — AC-12's stated reason. */
  skip_reason: z.string().nullable(),
  findings_count: z.number().int(),
  critical: z.number().int(),
  warning: z.number().int(),
  suggestion: z.number().int(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
});
export type CiResultArtifact = z.infer<typeof CiResultArtifact>;

export const CiRefreshRejection = z.object({
  job_url: z.string(),
  reason: z.string(),
});
export type CiRefreshRejection = z.infer<typeof CiRefreshRejection>;

/** Response of `POST /ci/refresh`. */
export const CiRefreshResult = z.object({
  runs: z.array(CiRun),
  recorded: z.number().int(),
  skipped_existing: z.number().int(),
  rejected: z.array(CiRefreshRejection),
  installations_checked: z.number().int(),
});
export type CiRefreshResult = z.infer<typeof CiRefreshResult>;

// ===========================================================================
// Conformance (PRD ↔ PR) — API record (the analysis shape is `Conformance`)
// ===========================================================================

/** Request body for `POST /pulls/:id/conformance`. */
export const ConformanceInput = z.object({
  /** Spec path/id to compare against; if omitted, the first available spec. */
  spec: z.string().nullish(),
  provider: z.enum(['openai', 'anthropic']).nullish(),
  model: z.string().nullish(),
});
export type ConformanceInput = z.infer<typeof ConformanceInput>;

/** A persisted conformance check (mirrors `conformance_checks` + the report). */
export const ConformanceReport = z.object({
  id: z.string(),
  pr_id: z.string(),
  report: Conformance,
});
export type ConformanceReport = z.infer<typeof ConformanceReport>;

// ===========================================================================
// Hooks (Secret-Leak + Phantom-API detectors) — emit grounding-exempt findings
// ===========================================================================

export const HookKind = z.enum(['secret_leak', 'phantom']);
export type HookKind = z.infer<typeof HookKind>;

/** Result of running the built-in detectors over a PR. */
export const HookScanResult = z.object({
  pr_id: z.string(),
  review_id: z.string().nullable(),
  findings: z.array(Finding),
});
export type HookScanResult = z.infer<typeof HookScanResult>;
