import { z } from 'zod';

/**
 * Ring 0 — shared input fragments + the shared output schema. `zod`, pure TS
 * only (Development Plan §1 ring table names this file explicitly as ring 0
 * even though it lives under `tools/`). §12's token-budget rules apply to
 * every field here: flat scalars, terse `.describe()`, `z.enum` for
 * constrained values.
 */

// ---- Shared input fragments (repo/pr/agent — the same flat triple every
// addressed tool takes; §7 explicitly requires this consistency) -----------

export const RepoArg = z
  .string()
  .min(1)
  .max(300)
  .describe('Repository as "owner/name" (a GitHub URL also works).');

export const PrArg = z.number().int().positive().max(1_000_000).describe('Pull request number.');

export const AgentArg = z.string().min(1).max(100).describe('Reviewer agent name from list_agents.');

export const RunIdArg = z
  .string()
  .uuid()
  .describe('Pin one specific run (from run_agent_on_pr). Omit for the agent’s latest review.')
  .optional();

export const SeverityArg = z
  .enum(['critical', 'warning', 'suggestion'])
  .describe('Return only findings of this severity.')
  .optional();

export const FileArg = z
  .string()
  .max(200)
  .describe('Return only findings in files whose path contains this text.')
  .optional();

export const FindingsLimitArg = z
  .number()
  .int()
  .min(1)
  .max(200)
  .describe('Max findings to return (default 50).')
  .optional();

export const ConventionsLimitArg = z
  .number()
  .int()
  .min(1)
  .max(200)
  .describe('Max conventions to return (default 50).')
  .optional();

export const DetailArg = z
  .enum(['compact', 'full'])
  .describe('"full" adds each finding’s rationale (uses ~3x the tokens).')
  .optional();

export const DepthArg = z
  .number()
  .int()
  .min(1)
  .max(3)
  .describe('Accepted for compatibility; traversal is fixed at 2 hops.')
  .optional();

// ---- The shared compact projection (§10) — reused by BOTH run_agent_on_pr
// and get_findings as their `outputSchema`. Do not fork it per tool. -------

export const FindingOut = z.object({
  severity: z.enum(['critical', 'warning', 'suggestion']),
  category: z.string(), // bug | security | perf | style | test
  title: z.string(),
  location: z.string(), // "src/auth/session.ts:42" or "src/auth/session.ts:42-48"
  suggestion: z.string().optional(),
  rationale: z.string().optional(), // ONLY when detail === 'full'
});
export type FindingOut = z.infer<typeof FindingOut>;

export const ReviewResult = z.object({
  repo: z.string(),
  pr: z.number().int(),
  agent: z.string(),
  status: z.enum(['completed', 'running']),
  verdict: z.string().nullable(), // approve | request_changes | comment
  score: z.number().nullable(), // 0-100, higher is better
  summary: z.string().nullable(),
  findings_total: z.number().int(),
  findings: z.array(FindingOut),
  truncated: z.boolean(),
  run_id: z.string().nullable(),
  next_step: z.string().nullable(),
});
export type ReviewResult = z.infer<typeof ReviewResult>;

// ---- list_agents' output (§5) ---------------------------------------------

export const AgentOut = z.object({
  name: z.string(),
  description: z.string(),
  provider: z.string(),
  model: z.string(),
  enabled: z.boolean(),
});
export type AgentOut = z.infer<typeof AgentOut>;

export const AgentsListResult = z.object({
  agents: z.array(AgentOut),
  count: z.number().int(),
  next_step: z.string().nullable(),
});
export type AgentsListResult = z.infer<typeof AgentsListResult>;

// ---- get_conventions' output (§8) -----------------------------------------

export const ConventionOut = z.object({
  rule: z.string(),
  category: z.string().nullable(),
  status: z.enum(['pending', 'accepted', 'rejected']),
  confidence: z.number().nullable(),
  evidence: z.string().nullable(), // "<evidence_path>:<start>-<end>" or null
});
export type ConventionOut = z.infer<typeof ConventionOut>;

export const ConventionsListResult = z.object({
  repo: z.string(),
  conventions: z.array(ConventionOut),
  conventions_total: z.number().int(),
  truncated: z.boolean(),
  next_step: z.string().nullable(),
});
export type ConventionsListResult = z.infer<typeof ConventionsListResult>;

// ---- get_blast_radius' output (`specs/0005-blast-radius.md` §10) ----------
// A separate, MCP-sized token budget from the server's UI-oriented 20/symbol
// cap (`repo-intel/constants.ts`'s `MAX_CALLERS_PER_SYMBOL`) — this is a
// context-window budget, not a UI-page budget.
export const MAX_BLAST_SYMBOLS = 25;
export const MAX_BLAST_CALLERS_PER_SYMBOL = 5;

export const BlastCallerOut = z.object({
  location: z.string(), // "src/payments/handler.ts:42"
  symbol: z.string(), // the enclosing symbol at the call site
});
export type BlastCallerOut = z.infer<typeof BlastCallerOut>;

export const BlastSymbolOut = z.object({
  symbol: z.string(),
  location: z.string(), // "src/payments/retry.ts:42", or file-only when the indexer recorded no line
  callers: z.array(BlastCallerOut),
});
export type BlastSymbolOut = z.infer<typeof BlastSymbolOut>;

export const BlastEndpointOut = z.object({
  endpoint: z.string(), // "METHOD /path"
  location: z.string(), // the declaring file — no line: PrBlastEndpoint carries none
  hops: z.number().int(), // 0 = changed file itself, 1-2 = importer distance
});
export type BlastEndpointOut = z.infer<typeof BlastEndpointOut>;

export const BlastRadiusResult = z.object({
  repo: z.string(),
  pr: z.number().int(),
  state: z.enum(['ok', 'partial']), // 'degraded' is always a Tool Execution Error, never a result
  reason: z.string().nullable(),
  changed_files_total: z.number().int(),
  symbols: z.array(BlastSymbolOut),
  endpoints: z.array(BlastEndpointOut),
  callers_total: z.number().int(), // pre-cap, as reported by the server
  truncated: z.boolean(),
  next_step: z.string().nullable(),
});
export type BlastRadiusResult = z.infer<typeof BlastRadiusResult>;
