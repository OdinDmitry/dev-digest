import { z } from 'zod';

/**
 * PR Brief building blocks: Intent, Blast radius, Risks, PR History,
 * Smart Diff. Composed into PrBrief.
 */

// ---- Intent ----
export const Intent = z.object({
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
});
export type Intent = z.infer<typeof Intent>;

// ---- Blast radius ----
export const ChangedSymbol = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbol>;

export const BlastCaller = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
});
export type BlastCaller = z.infer<typeof BlastCaller>;

export const DownstreamImpact = z.object({
  symbol: z.string(),
  callers: z.array(BlastCaller),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpact>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  summary: z.string(),
});
export type BlastRadius = z.infer<typeof BlastRadius>;

// ---- Risks ----
export const RiskSeverity = z.enum(['high', 'medium', 'low']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

export const Risk = z.object({
  kind: z.string(),
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  file_refs: z.array(z.string()),
});
export type Risk = z.infer<typeof Risk>;

export const Risks = z.object({
  risks: z.array(Risk),
});
export type Risks = z.infer<typeof Risks>;

// ---- PR History ----
export const PrHistoryItem = z.object({
  pr_number: z.number().int(),
  title: z.string(),
  merged_at: z.string(),
  author: z.string(),
  files_overlap: z.array(z.string()),
  notes: z.string(),
});
export type PrHistoryItem = z.infer<typeof PrHistoryItem>;

export const PrHistory = z.object({
  history: z.array(PrHistoryItem),
});
export type PrHistory = z.infer<typeof PrHistory>;

// ---- Smart Diff ----
export const SmartDiffRole = z.enum(['core', 'wiring', 'boilerplate']);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

export const SmartDiffFindingRef = z.object({
  line: z.number().int(), // new-side line number (finding.start_line)
  finding_id: z.string(), // findings.id — the navigation target
});
export type SmartDiffFindingRef = z.infer<typeof SmartDiffFindingRef>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  findings: z.array(SmartDiffFindingRef),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  files: z.array(SmartDiffFile),
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
});
export type SmartDiff = z.infer<typeof SmartDiff>;

// ---- Composed PR Brief (pr_brief.json) ----
export const PrBrief = z.object({
  intent: Intent,
  blast: BlastRadius,
  risks: Risks,
  history: PrHistory,
});
export type PrBrief = z.infer<typeof PrBrief>;

// ---- SPEC-02: the generated PR brief ----------------------------------

/** A reference the brief may point at. `path` is repository-relative and MUST
 *  be present in the pull request's changed files (grounded server-side).
 *  `endpoint`, when non-null, is an endpoint from the blast radius. */
export const BriefFileRef = z.object({
  path: z.string(),
  start_line: z.number().int().nullable().default(null),
  end_line: z.number().int().nullable().default(null),
  endpoint: z.string().nullable().default(null),
});
export type BriefFileRef = z.infer<typeof BriefFileRef>;

export const BriefRisk = z.object({
  kind: z.string(),
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  refs: z.array(BriefFileRef).min(1),
});
export type BriefRisk = z.infer<typeof BriefRisk>;

export const BriefFocusItem = z.object({
  refs: z.array(BriefFileRef).min(1),
  reason: z.string(),
});
export type BriefFocusItem = z.infer<typeof BriefFocusItem>;

/** The stored document (`pr_brief.json`). Replaced whole, never patched. */
export const BriefDoc = z.object({
  what: z.string(),
  why: z.string(),
  risk_level: RiskSeverity,
  risks: z.array(BriefRisk),
  review_focus: z.array(BriefFocusItem),
});
export type BriefDoc = z.infer<typeof BriefDoc>;

/** The stored document plus the identity it was produced for. */
export const BriefRecord = BriefDoc.extend({
  pr_id: z.string(),
  head_sha: z.string(),
});
export type BriefRecord = z.infer<typeof BriefRecord>;

/** `ready` — `brief` is present and matches the PR's current head commit.
 *  `absent` — nothing stored for this head commit; the client starts one
 *  generation. `unavailable` — this generation cannot produce a brief
 *  (input over budget after every optional drop, AC-18). */
export const BriefStatus = z.enum(['ready', 'absent', 'unavailable']);
export type BriefStatus = z.infer<typeof BriefStatus>;

export const BriefEnvelope = z.object({
  status: BriefStatus,
  brief: BriefRecord.nullable(),
  /**
   * Machine-readable cause when `status === 'unavailable'`, else null.
   * Exactly two values are produced: `'intent_absent'` (no persisted intent
   * yet — retryable, nothing stored, T17) and `'input_budget'` (over budget
   * with every optional input already dropped, T13/T17). Both mean "no model
   * call was made". Kept as a plain string, not an enum, so adding a cause
   * later is not a breaking contract change.
   */
  reason: z.string().nullable(),
});
export type BriefEnvelope = z.infer<typeof BriefEnvelope>;

/** The most recent completed review on a pull request, as one unit — either
 *  all four values or `null` for the whole object (AC-5). NOT `RunSummary`:
 *  that name is taken by contracts/trace.ts. */
export const PrRunSummary = z.object({
  verdict: z.string(),
  findings_count: z.number().int(),
  blockers_count: z.number().int(),
  score: z.number().int().nullable(),
});
export type PrRunSummary = z.infer<typeof PrRunSummary>;
