import { z } from 'zod';
import { Verdict, Finding } from './findings.js';
import { EvalExpectation, EvalCaseOrigin, EvalRunState, EvalPerTrace, Conformance } from './knowledge.js';

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

/** One generated file in the CI bundle (path + editable contents). */
export const CiFile = z.object({
  path: z.string(),
  contents: z.string(),
  editable: z.boolean().default(true),
});
export type CiFile = z.infer<typeof CiFile>;

/** Request body for `POST /agents/:id/export-ci`. */
export const CiExportInput = z.object({
  repo: z.string().min(1), // "owner/name"
  target: CiTarget.default('gha'),
  /** "open_pr" opens a PR with the files; "files" just returns/persists them. */
  action: z.enum(['open_pr', 'files']).default('open_pr'),
  post_as: z.enum(['github_review', 'pr_comment', 'none']).default('github_review'),
  triggers: z.array(z.string()).default(['opened', 'synchronize', 'reopened']),
  base: z.string().default('main'),
});
export type CiExportInput = z.infer<typeof CiExportInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type CiExportInputBody = z.input<typeof CiExportInput>;

/** A persisted CI installation (mirrors `ci_installations`). */
export const CiInstallation = z.object({
  id: z.string(),
  agent_id: z.string(),
  repo: z.string(),
  target_type: CiTarget,
  installed_at: z.string(),
});
export type CiInstallation = z.infer<typeof CiInstallation>;

/** Response of `POST /agents/:id/export-ci`. */
export const CiExport = z.object({
  installation: CiInstallation,
  files: z.array(CiFile),
  pr_url: z.string().nullable(),
});
export type CiExport = z.infer<typeof CiExport>;

export const CiRunStatus = z.enum(['succeeded', 'failed', 'no_findings', 'running']);
export type CiRunStatus = z.infer<typeof CiRunStatus>;

/** A CI run row (mirrors `ci_runs`) — ingested from GitHub Actions artifacts. */
export const CiRun = z.object({
  id: z.string(),
  ci_installation_id: z.string().nullable(),
  pr_number: z.number().int().nullable(),
  ran_at: z.string().nullable(),
  status: z.string().nullable(),
  findings_count: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  github_url: z.string().nullable(),
  source: z.string().nullable(),
  agent: z.string().nullish(),
  duration_s: z.number().nullish(),
});
export type CiRun = z.infer<typeof CiRun>;

/**
 * The artifact shape uploaded by the CI action (`devdigest-result.json`).
 * Ingested back on refresh to populate `ci_runs` (L06).
 */
export const CiResultArtifact = z.object({
  findings_count: z.number().int(),
  critical: z.number().int().nullish(),
  warning: z.number().int().nullish(),
  suggestion: z.number().int().nullish(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullish(),
  agent: z.string(),
  version: z.string().nullish(),
  pr_number: z.number().int().nullish(),
});
export type CiResultArtifact = z.infer<typeof CiResultArtifact>;

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
