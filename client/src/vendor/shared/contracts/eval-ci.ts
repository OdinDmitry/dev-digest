import { z } from 'zod';
import { Verdict, Finding } from './findings.js';
import { EvalRun, EvalOwnerKind, Conformance } from './knowledge.js';

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

/** Create/update payload for an eval case (id + owner resolved by the route). */
export const EvalCaseInput = z.object({
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string().min(1),
  input_diff: z.string().default(''),
  input_files: z.unknown().nullish(),
  input_meta: z.unknown().nullish(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCaseInput = z.infer<typeof EvalCaseInput>;

/** A persisted eval run row (one execution of a case), returned by the API. */
export const EvalRunRecord = z.object({
  id: z.string(),
  case_id: z.string(),
  case_name: z.string().nullish(),
  ran_at: z.string(),
  actual_output: z.unknown(),
  pass: z.boolean().nullable(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
});
export type EvalRunRecord = z.infer<typeof EvalRunRecord>;

/** Result of running a single case: the metrics (EvalRun) + the persisted row id. */
export const EvalRunResult = z.object({
  run_id: z.string(),
  case_id: z.string(),
  result: EvalRun,
});
export type EvalRunResult = z.infer<typeof EvalRunResult>;

/** One point on the dashboard trend (per run, chronological). */
export const EvalTrendPoint = z.object({
  ran_at: z.string(),
  recall: z.number(),
  precision: z.number(),
  citation_accuracy: z.number(),
  pass_rate: z.number(),
  cost_usd: z.number().nullable(),
});
export type EvalTrendPoint = z.infer<typeof EvalTrendPoint>;

/** Aggregate dashboard for an owner (agent/skill) or the whole workspace. */
export const EvalDashboard = z.object({
  owner_kind: EvalOwnerKind.nullable(),
  owner_id: z.string().nullable(),
  cases_total: z.number().int(),
  current: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number(),
    traces_passed: z.number().int(),
    traces_total: z.number().int(),
    cost_usd: z.number().nullable(),
  }),
  delta: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number(),
  }),
  trend: z.array(EvalTrendPoint),
  recent_runs: z.array(EvalRunRecord),
  alert: z.string().nullable(),
});
export type EvalDashboard = z.infer<typeof EvalDashboard>;

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

// ==== SPEC-03 eval pipeline ====

export const EvalExpectationKind = z.enum(['must_find', 'must_not_flag']);
export type EvalExpectationKind = z.infer<typeof EvalExpectationKind>;

export const EvalExpectation = z.object({
  id: z.string(),
  kind: EvalExpectationKind,
  file: z.string().min(1),
  start_line: z.number().int().min(1),
  end_line: z.number().int().min(1),
});
export type EvalExpectation = z.infer<typeof EvalExpectation>;

/** One finding as the agent returned it for a case, with its grounding outcome.
 *  `severity`/`title` are `.nullish()` on purpose: this object is persisted as
 *  jsonb and read back, and a stricter schema would reject a document written
 *  by an earlier shape (server/insights.md 2026-08-17). */
export const EvalReturnedFinding = z.object({
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  grounded: z.boolean(),
  severity: z.string().nullish(),
  title: z.string().nullish(),
});
export type EvalReturnedFinding = z.infer<typeof EvalReturnedFinding>;

/** POST /agents/:id/eval-cases — the expectation type is NOT on the wire.
 *  It is derived server-side from the finding's decision (AC-40, AC-41). */
export const EvalCaseCreate = z.object({
  finding_id: z.string().uuid(),
  name: z.string().min(1),
});
export type EvalCaseCreate = z.infer<typeof EvalCaseCreate>;

/** PUT /eval-cases/:id — the name is a case's ONLY mutable field. The
 *  fragment, file, range, severity, category and expectation are captured at
 *  creation and never change (AC-45; SPEC-04 § Contracts, Eval case). */
export const EvalCaseUpdate = z.object({
  name: z.string().min(1),
});
export type EvalCaseUpdate = z.infer<typeof EvalCaseUpdate>;

/** A case's most recent outcome, from a suite run OR a verification. Persisted
 *  as jsonb on `eval_cases.latest_result`, so the read path safeParses it and
 *  falls back to null; a field added here later must be `.nullish()`. */
export const EvalCaseLatestResult = z.object({
  completed: z.boolean(),
  /** null when the invocation did not complete. */
  passed: z.boolean().nullable(),
  error: z.string().nullish(),
  findings: z.array(EvalReturnedFinding),
  /** AC-53's returned finding count: findings in this result that matched this
   *  case's expectation, counted server-side with the same rule the metrics
   *  use — never recomputed in the client. */
  matched_count: z.number().int(),
  ran_at: z.string(),
});
export type EvalCaseLatestResult = z.infer<typeof EvalCaseLatestResult>;

/** A stored eval case. `fragment`, `file`, `start_line`, `end_line` are
 *  captured at creation and never change (AC-9). */
export const EvalCaseRecord = z.object({
  id: z.string(),
  agent_id: z.string(),
  name: z.string(),
  /** The finding this case was born from. Kept as a plain id with no FK so the
   *  case survives the finding's deletion (Contracts § Diff fragment). */
  source_finding_id: z.string().nullable(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  fragment: z.string(),
  expectations: z.array(EvalExpectation),
  created_at: z.string(),
  /** null for a case created before severity/category were captured — states
   *  them as unavailable, never as a default severity (SPEC-04 edge case). */
  severity: z.string().nullable(),
  category: z.string().nullable(),
  latest_result: EvalCaseLatestResult.nullable(),
});
export type EvalCaseRecord = z.infer<typeof EvalCaseRecord>;

/** GET /findings/:id/eval-case-draft — `expectation_kind` REPLACES
 *  `default_expectation_kind`: it is derived, never a default to override
 *  (AC-40). null only when the finding carries no decision, in which case the
 *  action is unavailable and this endpoint is not reached (AC-42). */
export const EvalCaseDraft = z.object({
  finding_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
  suggested_name: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  fragment: z.string(),
  expectation_kind: EvalExpectationKind.nullable(),
  /** The case already created from this finding (AC-10); null when none. */
  existing_case: EvalCaseRecord.nullable(),
});
export type EvalCaseDraft = z.infer<typeof EvalCaseDraft>;

export const EvalRunStatus = z.enum(['running', 'completed', 'failed']);
export type EvalRunStatus = z.infer<typeof EvalRunStatus>;

/**
 * One skill as a run invoked it (AC-38): its identity plus the version of its
 * BODY that was invoked. `name` is a snapshot, not a join, so a comparison can
 * still label a skill that has since been deleted (SPEC-03 Edge cases).
 *
 * Known boundary, restated from the spec so nobody reads more into this than it
 * carries: `skill_version` tracks the body only — `skills/helpers.ts::isBodyChange`
 * does not bump it on a rename. A disable IS caught, because a disabled skill
 * drops out of the invoked set entirely.
 */
export const EvalInvokedSkill = z.object({
  skill_id: z.string(),
  skill_version: z.number().int(),
  name: z.string(),
});
export type EvalInvokedSkill = z.infer<typeof EvalInvokedSkill>;

export const EvalCaseResult = z.object({
  case_id: z.string(),
  case_name: z.string(),
  /** false when the invocation did not complete (AC-20/21/22). */
  completed: z.boolean(),
  error: z.string().nullable(),
  /** null when `completed` is false. */
  passed: z.boolean().nullable(),
  findings: z.array(EvalReturnedFinding),
  cost_usd: z.number().nullable(),
});
export type EvalCaseResult = z.infer<typeof EvalCaseResult>;

/** A run over one agent's whole case set. Every metric and the cost are
 *  `.nullable()` and NEVER `.default(0)` — absent is a distinct state from zero
 *  (AC-27, AC-37). */
export const EvalSuiteRun = z.object({
  id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
  agent_version: z.number().int(),
  /** The skills this run invoked, in the order the agent links them (AC-38).
   *  Empty when the agent had no enabled linked skill when the run started.
   *  REQUIRED — every hand-built EvalSuiteRun test fixture must supply it. */
  invoked_skills: z.array(EvalInvokedSkill),
  status: EvalRunStatus,
  started_at: z.string(),
  completed_at: z.string().nullable(),
  cases_total: z.number().int(),
  cases_completed: z.number().int(),
  cases_passed: z.number().int().nullable(),
  cases_failed_to_complete: z.number().int(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  cost_usd: z.number().nullable(),
  /** Ids of the cases this run covered, for AC-33. */
  case_ids: z.array(z.string()),
});
export type EvalSuiteRun = z.infer<typeof EvalSuiteRun>;

export const EvalSuiteRunDetail = EvalSuiteRun.extend({
  results: z.array(EvalCaseResult),
});
export type EvalSuiteRunDetail = z.infer<typeof EvalSuiteRunDetail>;

/** GET /eval-agents — AC-63. `latest_run` is the agent's most recent run of
 *  ANY status, or null when it has never been run (AC-4). */
export const EvalAgentSummary = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  latest_run: EvalSuiteRun.nullable(),
});
export type EvalAgentSummary = z.infer<typeof EvalAgentSummary>;
