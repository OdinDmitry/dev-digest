import type { WireAgent, WireBlast, WireConvention, WireFinding } from './devdigest/wire.js';
import type {
  AgentOut,
  AgentsListResult,
  BlastRadiusResult,
  BlastSymbolOut,
  ConventionOut,
  ConventionsListResult,
  FindingOut,
  ReviewResult,
} from './tools/schemas.js';
import { MAX_BLAST_CALLERS_PER_SYMBOL, MAX_BLAST_SYMBOLS } from './tools/schemas.js';
import {
  BLAST_EMPTY_NEXT_STEP,
  BLAST_PARTIAL_NEXT_STEP,
  BLAST_TRUNCATED_NEXT_STEP,
  MAX_DESCRIPTION_CHARS,
  MAX_RATIONALE_CHARS,
  MAX_RESULT_CHARS,
  MAX_RULE_CHARS,
  RESULT_TRUNCATED_NOTE,
  SEVERITY_ORDER,
} from './constants.js';

/**
 * Ring 2 — pure API-shape → compact-result projections (§10). No
 * `DevDigestApi`, no I/O, no SDK type — every function here takes plain data
 * and returns plain data, which is what lets `project.test.ts` drive it with
 * literals (step 6's "done when").
 */

export type McpSeverity = (typeof SEVERITY_ORDER)[number];

const WIRE_TO_MCP_SEVERITY: Record<'CRITICAL' | 'WARNING' | 'SUGGESTION', McpSeverity> = {
  CRITICAL: 'critical',
  WARNING: 'warning',
  SUGGESTION: 'suggestion',
};
const MCP_TO_WIRE_SEVERITY: Record<McpSeverity, 'CRITICAL' | 'WARNING' | 'SUGGESTION'> = {
  critical: 'CRITICAL',
  warning: 'WARNING',
  suggestion: 'SUGGESTION',
};

/** Wire vocabulary (uppercase) → MCP vocabulary (lowercase). */
export function normalizeSeverity(wire: 'CRITICAL' | 'WARNING' | 'SUGGESTION'): McpSeverity {
  return WIRE_TO_MCP_SEVERITY[wire];
}
/** MCP vocabulary → wire vocabulary — the inverse of `normalizeSeverity`. */
export function denormalizeSeverity(mcp: McpSeverity): 'CRITICAL' | 'WARNING' | 'SUGGESTION' {
  return MCP_TO_WIRE_SEVERITY[mcp];
}

/** Generic truncation with a trailing ellipsis when a string exceeds a char
 * budget (list_agents' description, get_conventions' rule, a finding's
 * rationale, ReviewResult's summary — §5/§8/§10). */
export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 1) return '…'.slice(0, Math.max(0, maxChars));
  return `${text.slice(0, maxChars - 1)}…`;
}

// ---- Findings (shared by run_agent_on_pr and get_findings) ----------------

interface SortableFinding {
  severity: McpSeverity;
  category: string;
  title: string;
  file: string;
  start_line: number;
  end_line: number;
  rationale: string | null;
  suggestion: string | null;
}

const SEVERITY_RANK: Record<McpSeverity, number> = Object.fromEntries(
  SEVERITY_ORDER.map((s, i) => [s, i]),
) as Record<McpSeverity, number>;

/** Total order (constraint 12): severity → file → start_line → title. */
function compareFindings(a: SortableFinding, b: SortableFinding): number {
  if (a.severity !== b.severity) return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  if (a.start_line !== b.start_line) return a.start_line - b.start_line;
  if (a.title !== b.title) return a.title < b.title ? -1 : 1;
  return 0;
}

/** Undismissed findings, normalized + sorted to the total order. Does NOT
 * apply the `severity`/`file` tool-argument filters (`filterFindings`, next)
 * or the `limit` (the caller's job — `findings_total` must count post-filter,
 * pre-limit, §7). */
export function projectFindings(wireFindings: WireFinding[]): SortableFinding[] {
  return wireFindings
    .filter((f) => f.dismissed_at == null)
    .map((f) => ({
      severity: normalizeSeverity(f.severity),
      category: f.category,
      title: f.title,
      file: f.file,
      start_line: f.start_line,
      end_line: f.end_line,
      rationale: f.rationale ?? null,
      suggestion: f.suggestion ?? null,
    }))
    .sort(compareFindings);
}

export function filterFindings(
  findings: SortableFinding[],
  opts: { severity?: McpSeverity; file?: string },
): SortableFinding[] {
  return findings.filter((f) => {
    if (opts.severity && f.severity !== opts.severity) return false;
    if (opts.file && !f.file.toLowerCase().includes(opts.file.toLowerCase())) return false;
    return true;
  });
}

function collapseLocation(file: string, startLine: number, endLine: number): string {
  return startLine === endLine ? `${file}:${startLine}` : `${file}:${startLine}-${endLine}`;
}

/** `rationale` is dropped by default and included (truncated) only when
 * `detail === 'full'` — the `response_format: concise | detailed` idea
 * (§10). `run_agent_on_pr` always calls this with `'compact'`. */
export function toFindingOut(finding: SortableFinding, detail: 'compact' | 'full'): FindingOut {
  const out: FindingOut = {
    severity: finding.severity,
    category: finding.category,
    title: finding.title,
    location: collapseLocation(finding.file, finding.start_line, finding.end_line),
  };
  if (finding.suggestion) out.suggestion = finding.suggestion;
  if (detail === 'full' && finding.rationale) {
    out.rationale = truncateText(finding.rationale, MAX_RATIONALE_CHARS);
  }
  return out;
}

/** Cuts at a finding/line boundary when the rendered text would exceed
 * `MAX_RESULT_CHARS`, and always ends the result on `RESULT_TRUNCATED_NOTE` —
 * a trusted, fixed string — when it does (§10, §15: no untrusted string is
 * ever the last line of the text block). */
function capResultText(text: string): string {
  if (text.length <= MAX_RESULT_CHARS) return text;
  const budget = MAX_RESULT_CHARS - RESULT_TRUNCATED_NOTE.length - 1; // room for '\n' + note
  const slice = text.slice(0, Math.max(0, budget));
  const cutAt = slice.lastIndexOf('\n');
  const kept = cutAt > 0 ? slice.slice(0, cutAt) : slice;
  return `${kept}\n${RESULT_TRUNCATED_NOTE}`;
}

/** Deterministic text rendering of a `ReviewResult` (§10) — a fallback for
 * hosts that only read the `text` content block, not a second, chattier
 * version of `structuredContent`. The header (validated args only) is always
 * the first line and `next_step` (a fixed constant with validated-argument
 * interpolation, or the literal "none") is always the last — untrusted
 * fields (title/summary/rationale) only ever appear in labelled positions
 * under the `findings:` heading in between (§15). */
export function renderReviewText(result: ReviewResult): string {
  const lines: string[] = [
    `${result.repo} #${result.pr} — agent: ${result.agent} — status: ${result.status}`,
  ];
  if (result.verdict) {
    lines.push(`verdict: ${result.verdict}${result.score != null ? ` (score ${result.score})` : ''}`);
  }
  if (result.summary) lines.push(`summary: ${result.summary}`);
  lines.push(`findings: ${result.findings.length} of ${result.findings_total}`);
  for (const f of result.findings) {
    const parts = [`- [${f.severity}] ${f.category} ${f.location} ${f.title}`];
    if (f.suggestion) parts.push(`suggestion: ${f.suggestion}`);
    if (f.rationale) parts.push(`rationale: ${f.rationale}`);
    lines.push(parts.join(' — '));
  }
  lines.push(`next_step: ${result.next_step ?? 'none'}`);
  return capResultText(lines.join('\n'));
}

/** "Each agent's own most recent `kind: 'review'` row" (constraint 11) —
 * `created_at` DESC with `id` DESC as the tiebreaker (constraint 12). Mirrors
 * `pickLatestReviewIdPerAgent` (`server/src/modules/reviews/helpers.ts:67`)
 * so "which findings count" never drifts from the server's own definition. */
export function pickLatestReview<T extends { created_at: string; id: string }>(
  reviews: T[],
): T | undefined {
  if (reviews.length === 0) return undefined;
  return [...reviews].sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  })[0];
}

// ---- Agents (list_agents, §5) ----------------------------------------------

/** Enabled first, then name ascending, then the API's own response order as
 * the final tiebreak (constraint 12: a total, stable order). */
export function projectAgents(wireAgents: WireAgent[]): AgentOut[] {
  return wireAgents
    .map((a, index) => ({
      index,
      name: a.name,
      description: truncateText(a.description ?? '', MAX_DESCRIPTION_CHARS),
      provider: a.provider,
      model: a.model,
      enabled: a.enabled,
    }))
    .sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      if (a.name !== b.name) return a.name < b.name ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ index: _index, ...rest }) => rest);
}

export function renderAgentsText(result: AgentsListResult): string {
  const lines: string[] = [`agents: ${result.count}`];
  for (const a of result.agents) {
    lines.push(
      `- ${a.name} (${a.provider}/${a.model}, ${a.enabled ? 'enabled' : 'disabled'}) — ${a.description}`,
    );
  }
  lines.push(`next_step: ${result.next_step ?? 'none'}`);
  return capResultText(lines.join('\n'));
}

// ---- Conventions (get_conventions, §8) -------------------------------------

const CONVENTION_STATUS_RANK: Record<'accepted' | 'pending', number> = { accepted: 0, pending: 1 };

function buildEvidence(c: WireConvention): string | null {
  if (c.evidence_path == null || c.evidence_start_line == null || c.evidence_end_line == null) {
    return null;
  }
  return `${c.evidence_path}:${c.evidence_start_line}-${c.evidence_end_line}`;
}

/** Excludes `status === 'rejected'` (the user explicitly rejected them).
 * Order: accepted before pending, then confidence descending (nulls last),
 * then `id` ascending (constraint 12) — `id` never appears in the output. */
export function projectConventions(wireConventions: WireConvention[]): ConventionOut[] {
  return wireConventions
    .filter((c): c is WireConvention & { status: 'accepted' | 'pending' } => c.status !== 'rejected')
    .map((c) => ({
      id: c.id,
      rule: truncateText(c.rule, MAX_RULE_CHARS),
      category: c.category ?? null,
      status: c.status,
      confidence: c.confidence ?? null,
      evidence: buildEvidence(c),
    }))
    .sort((a, b) => {
      const rankDiff = CONVENTION_STATUS_RANK[a.status] - CONVENTION_STATUS_RANK[b.status];
      if (rankDiff !== 0) return rankDiff;
      const aConf = a.confidence ?? -1;
      const bConf = b.confidence ?? -1;
      if (aConf !== bConf) return bConf - aConf; // descending; nulls (-1) sort last
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .map(({ id: _id, ...rest }) => rest);
}

export function renderConventionsText(result: ConventionsListResult): string {
  const lines: string[] = [
    `${result.repo} conventions: ${result.conventions.length} of ${result.conventions_total}`,
  ];
  for (const c of result.conventions) {
    const evidence = c.evidence ? ` (${c.evidence})` : '';
    lines.push(`- [${c.status}] ${c.rule}${evidence}`);
  }
  lines.push(`next_step: ${result.next_step ?? 'none'}`);
  return capResultText(lines.join('\n'));
}

// ---- Blast radius (get_blast_radius, `specs/0005-blast-radius.md` §10) ---

/** `PrBlastSymbol` now carries a nullable declaration `line`
 * (`server/src/vendor/shared/contracts/blast.ts` — `specs/0006-blast-radius-polish.md`
 * §1); `PrBlastEndpoint` still carries none. A symbol's "location" is
 * `file:line` when a line is known, `file` alone otherwise; an endpoint's
 * "location" stays file-only (out of scope, see `specs/0006-…` §"Out of
 * scope"); a caller's is `file:line`, the `0004` §10 `"path:line"` form. */
function symbolLocation(file: string, line: number | null): string {
  return line == null ? file : `${file}:${line}`;
}
function callerLocation(file: string, line: number): string {
  return `${file}:${line}`;
}

/**
 * `wire.state` must already be narrowed away from `'degraded'` by the
 * caller (`tools/get-blast-radius.ts` throws before ever reaching this
 * function) — this ternary is defensive, mirroring
 * `blast/service.ts`'s own `state = indexState.status === 'partial' ? …`
 * fallback server-side, never actually asked to resolve a `'degraded'` wire
 * value in practice.
 *
 * MCP-sized caps (`MAX_BLAST_SYMBOLS`, `MAX_BLAST_CALLERS_PER_SYMBOL`) are
 * separate from the server's UI-oriented 20/symbol budget — this is a
 * context-window budget, not a UI-page budget. `symbols`/`callers` grouping
 * is by `via_symbol === symbol.name` (mirrors the client's Blast tab, §7).
 */
export function projectBlast(wire: WireBlast, repoFullName: string, prNumber: number): BlastRadiusResult {
  const state: 'ok' | 'partial' = wire.state === 'partial' ? 'partial' : 'ok';

  const symbolsTruncated = wire.changed_symbols.length > MAX_BLAST_SYMBOLS;
  const shownSymbols = wire.changed_symbols.slice(0, MAX_BLAST_SYMBOLS);

  let callersPerSymbolTruncated = false;
  const symbols: BlastSymbolOut[] = shownSymbols.map((s) => {
    const matching = wire.callers.filter((c) => c.via_symbol === s.name);
    const shownCallers = matching.slice(0, MAX_BLAST_CALLERS_PER_SYMBOL);
    if (shownCallers.length < matching.length) callersPerSymbolTruncated = true;
    return {
      symbol: s.name,
      location: symbolLocation(s.file, s.line ?? null),
      callers: shownCallers.map((c) => ({ location: callerLocation(c.file, c.line), symbol: c.symbol })),
    };
  });

  const endpoints = wire.impacted_endpoints.map((e) => ({
    endpoint: e.endpoint,
    location: symbolLocation(e.file, null), // endpoints never carry a line — out of scope, §"Out of scope"
    hops: e.hops,
  }));

  const truncated =
    wire.callers_truncated ||
    wire.endpoints_truncated ||
    symbolsTruncated ||
    callersPerSymbolTruncated;

  let nextStep: string | null = null;
  if (state === 'partial') {
    nextStep = BLAST_PARTIAL_NEXT_STEP;
  } else if (symbols.length === 0) {
    nextStep = BLAST_EMPTY_NEXT_STEP;
  } else if (truncated) {
    nextStep = BLAST_TRUNCATED_NEXT_STEP;
  }

  return {
    repo: repoFullName,
    pr: prNumber,
    state,
    reason: wire.reason ?? null,
    changed_files_total: wire.changed_files.length,
    symbols,
    endpoints,
    callers_total: wire.callers_total,
    truncated,
    next_step: nextStep,
  };
}

/** Deterministic text rendering (§10, mirroring `renderReviewText`'s
 * shape) — the header is always the first line, `next_step` is always the
 * last, and every untrusted field (symbol/caller/endpoint names and paths,
 * sourced from indexed third-party code) only ever appears inside a
 * labelled list line in between. */
export function renderBlastText(result: BlastRadiusResult): string {
  const lines: string[] = [
    `${result.repo} #${result.pr} — blast radius (${result.state}) — ${result.changed_files_total} changed file(s)`,
  ];
  if (result.reason) lines.push(`reason: ${result.reason}`);
  lines.push(`symbols: ${result.symbols.length} — callers_total: ${result.callers_total}`);
  for (const s of result.symbols) {
    lines.push(`- ${s.symbol} (${s.location})`);
    if (s.callers.length === 0) {
      lines.push('  no known callers');
    }
    for (const c of s.callers) {
      lines.push(`  called via ${c.symbol} at ${c.location}`);
    }
  }
  lines.push(`endpoints: ${result.endpoints.length}`);
  for (const e of result.endpoints) {
    lines.push(`- ${e.endpoint} (${e.location}, ${e.hops} hop(s))`);
  }
  lines.push(`next_step: ${result.next_step ?? 'none'}`);
  return capResultText(lines.join('\n'));
}
