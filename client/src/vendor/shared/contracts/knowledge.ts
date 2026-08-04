import { z } from 'zod';

/**
 * Conformance, Onboarding, Eval, Memory, Conventions, Skills,
 * Agents and their DTOs.
 */

// ---- Conformance ----
export const ConformanceStatus = z.enum(['implemented', 'missing', 'out_of_scope']);
export type ConformanceStatus = z.infer<typeof ConformanceStatus>;

export const ConformanceItem = z.object({
  requirement: z.string(),
  status: ConformanceStatus,
  evidence_file: z.string().nullish(),
  notes: z.string().nullish(),
});
export type ConformanceItem = z.infer<typeof ConformanceItem>;

export const Conformance = z.object({
  spec_id: z.string(),
  spec_title: z.string(),
  items: z.array(ConformanceItem),
  completeness_pct: z.number().min(0).max(100),
});
export type Conformance = z.infer<typeof Conformance>;

// ---- Onboarding ----
export const OnboardingLink = z.object({
  label: z.string(),
  path: z.string(),
});
export type OnboardingLink = z.infer<typeof OnboardingLink>;

export const OnboardingSection = z.object({
  kind: z.string(),
  title: z.string(),
  body: z.string(), // markdown
  diagram: z.string().nullish(), // mermaid
  links: z.array(OnboardingLink),
});
export type OnboardingSection = z.infer<typeof OnboardingSection>;

export const Onboarding = z.object({
  sections: z.array(OnboardingSection),
});
export type Onboarding = z.infer<typeof Onboarding>;

// ---- Eval ----
export const EvalPerTrace = z.object({
  name: z.string(),
  pass: z.boolean(),
  expected: z.unknown(),
  actual: z.unknown(),
});
export type EvalPerTrace = z.infer<typeof EvalPerTrace>;

export const EvalRun = z.object({
  recall: z.number().min(0).max(1),
  precision: z.number().min(0).max(1),
  citation_accuracy: z.number().min(0).max(1),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
  per_trace: z.array(EvalPerTrace),
});
export type EvalRun = z.infer<typeof EvalRun>;

export const EvalOwnerKind = z.enum(['skill', 'agent']);
export type EvalOwnerKind = z.infer<typeof EvalOwnerKind>;

export const EvalCase = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string(),
  input_diff: z.string(),
  input_files: z.unknown(),
  input_meta: z.unknown(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCase = z.infer<typeof EvalCase>;

// ---- Memory ----
export const MemoryScope = z.enum(['repo', 'global', 'team']);
export type MemoryScope = z.infer<typeof MemoryScope>;

export const MemoryKind = z.enum([
  'decision',
  'convention',
  'preference',
  'fact',
  'learning',
]);
export type MemoryKind = z.infer<typeof MemoryKind>;

export const MemorySource = z.object({
  pr: z.number().int().nullish(),
  context: z.string(),
});
export type MemorySource = z.infer<typeof MemorySource>;

export const MemoryItem = z.object({
  content: z.string(),
  scope: MemoryScope,
  kind: MemoryKind,
  confidence: z.number().min(0).max(1),
  sources: z.array(MemorySource),
});
export type MemoryItem = z.infer<typeof MemoryItem>;

// ---- Skills ----
export const SkillType = z.enum(['rubric', 'convention', 'security', 'custom']);
export type SkillType = z.infer<typeof SkillType>;

export const SkillSource = z.enum(['manual', 'imported_url', 'extracted', 'community']);
export type SkillSource = z.infer<typeof SkillSource>;

export const Skill = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: SkillType,
  source: SkillSource,
  body: z.string(),
  enabled: z.boolean(),
  version: z.number().int(),
  evidence_files: z.array(z.string()).nullish(),
});
export type Skill = z.infer<typeof Skill>;

export const CommunitySkill = z.object({
  name: z.string(),
  repo: z.string(),
  stars: z.number().int(),
  lang: z.string(),
  desc: z.string(),
});
export type CommunitySkill = z.infer<typeof CommunitySkill>;

// An archive entry the importer refused to read. Executable members are matched
// on the zip's central directory BEFORE decompression, so a skipped entry is
// never inflated, never parsed and never persisted — only its path is reported
// so the import preview can show the user what was left out.
export const SkillImportSkipped = z.object({
  path: z.string(),
  reason: z.enum(['executable', 'binary', 'too_large', 'unsupported']),
});
export type SkillImportSkipped = z.infer<typeof SkillImportSkipped>;

// Result of POST /skills/import/preview — a parsed skill that has NOT been
// written to the database. The client shows it for confirmation and then
// creates the skill through the normal POST /skills path.
export const SkillImportPreview = z.object({
  name: z.string(),
  description: z.string(),
  type: SkillType,
  source: SkillSource,
  body: z.string(),
  /** Archive member the body came from; null for a plain markdown upload. */
  entry_path: z.string().nullable(),
  /** Other markdown paths found in the archive (paths only — bodies dropped). */
  evidence_files: z.array(z.string()),
  skipped: z.array(SkillImportSkipped),
});
export type SkillImportPreview = z.infer<typeof SkillImportPreview>;

// A body snapshot in `skill_versions`. `note` is the author's optional "what
// changed?"; null on seeded/pre-note rows and on every v1, where the client
// renders "Initial version" instead. `lines_added`/`lines_removed` are computed
// server-side against the PREVIOUS snapshot (against "" for v1) so the history
// list can show a summary without shipping every body to the browser.
export const SkillVersion = z.object({
  skill_id: z.string(),
  version: z.number().int(),
  note: z.string().nullable(),
  created_at: z.string(),
  lines_added: z.number().int(),
  lines_removed: z.number().int(),
});
export type SkillVersion = z.infer<typeof SkillVersion>;

// GET /skills/:id/versions/:version — the list shape plus the snapshot body.
// Fetched only when the user opens a diff or restores, never on tab mount.
export const SkillVersionDetail = SkillVersion.extend({ body: z.string() });
export type SkillVersionDetail = z.infer<typeof SkillVersionDetail>;

// Per-skill rollup for the library rail (GET /skills/stats). Deliberately NOT
// folded into `Skill`, for the same reason `AgentListStats` is not folded into
// `Agent`: `Skill` is also the response of POST /skills and PUT /skills/:id,
// where the count is always 0 or unchanged and therefore misleading. Named
// `SkillListStats` (not `SkillStats`) so a richer per-skill detail contract
// (eval/accept, mirroring `AgentStats` in contracts/observability.ts) has a
// free name in a later lesson.
export const SkillListStats = z.object({
  skill_id: z.string(),
  agent_count: z.number().int(),
});
export type SkillListStats = z.infer<typeof SkillListStats>;

// ---- Conventions ----
export const ConventionCandidate = z.object({
  id: z.string(),
  rule: z.string(),
  evidence_path: z.string(),
  evidence_snippet: z.string(),
  confidence: z.number().min(0).max(1),
  accepted: z.boolean(),
});
export type ConventionCandidate = z.infer<typeof ConventionCandidate>;

// ---- Agents ----
export const Provider = z.enum(['openai', 'anthropic', 'openrouter']);
export type Provider = z.infer<typeof Provider>;

// Review execution strategy (matches @devdigest/reviewer-core's ReviewStrategy):
//  - single-pass: send the WHOLE diff in ONE model call (default)
//  - map-reduce:  one model call PER changed file (for very large diffs)
//  - auto:        single-pass, switching to map-reduce when the diff is large
export const ReviewStrategy = z.enum(['single-pass', 'map-reduce', 'auto']);
export type ReviewStrategy = z.infer<typeof ReviewStrategy>;

// CI gate policy — when a CI review should BLOCK (REQUEST_CHANGES + fail the
// check) vs just comment. Deterministic from severities; acted on ONLY in CI.
export const CiFailOn = z.enum(['never', 'critical', 'warning', 'any']);
export type CiFailOn = z.infer<typeof CiFailOn>;

export const Agent = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  enabled: z.boolean(),
  version: z.number().int(),
  strategy: ReviewStrategy.default('single-pass'),
  ci_fail_on: CiFailOn.default('critical'),
  // Inject repo-intel context (repo skeleton + callers + rank note) into this
  // agent's review prompt. Default on; gated again by the global flag.
  repo_intel: z.boolean().default(true),
});
export type Agent = z.infer<typeof Agent>;

export const AgentSkillLink = z.object({
  agent_id: z.string(),
  skill_id: z.string(),
  order: z.number().int(),
});
export type AgentSkillLink = z.infer<typeof AgentSkillLink>;

// Per-agent rollup for the agent CARDS (GET /agents/stats) — one row per agent
// in the workspace. Distinct from `AgentStats` in contracts/observability.ts,
// which is the far richer per-agent detail payload (accept rate, severity
// breakdown, trend) that GET /agents/:id/stats will serve in a later lesson.
//
// Deliberately NOT folded into `Agent`: that schema is also the response of
// POST/PUT /agents, where a run rollup would always be zero and therefore
// misleading. `avg_cost_usd` is null when no completed run recorded a cost —
// the UI renders that as "—", never as $0.00.
export const AgentListStats = z.object({
  agent_id: z.string(),
  skill_count: z.number().int(),
  run_count: z.number().int(),
  avg_cost_usd: z.number().nullable(),
});
export type AgentListStats = z.infer<typeof AgentListStats>;

// The immutable config snapshot captured in `agent_versions` whenever an agent's
// config changes (everything but `enabled`). Mirrors the shape written by the
// agents repository — provider/model/prompt/output_schema/strategy/gate/repo_intel
// plus the ordered skill ids linked at snapshot time. Used for reproducibility
// (eval replays a past version) and for surfacing an agent's edit history.
export const AgentVersionConfig = z.object({
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  strategy: ReviewStrategy,
  ci_fail_on: CiFailOn,
  repo_intel: z.boolean(),
  skills: z.array(z.string()),
});
export type AgentVersionConfig = z.infer<typeof AgentVersionConfig>;

export const AgentVersion = z.object({
  agent_id: z.string(),
  version: z.number().int(),
  config: AgentVersionConfig,
  created_at: z.string(),
});
export type AgentVersion = z.infer<typeof AgentVersion>;
