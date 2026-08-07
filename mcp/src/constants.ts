/**
 * Every budget, limit, and fixed next-step/error string this package uses
 * (Development Plan `specs/0004-local-mcp-server.md`, §§5-11). Centralised
 * here so no user-facing message is composed ad hoc inside a tool handler —
 * `resolve.ts`/`tools/*.ts` call these builders rather than inlining prose.
 *
 * Ring 2 (pure TS + zod only, no I/O) — see the plan's §1 ring table.
 */

// ---- URLs referenced in messages -----------------------------------------
export const DEFAULT_API_URL = 'http://localhost:3001';
export const WEB_UI_URL = 'http://localhost:3000';

// ---- Text truncation (§5, §8, §10) ----------------------------------------
/** list_agents: `Agent.description` truncation (§5). */
export const MAX_DESCRIPTION_CHARS = 200;
/** get_conventions: `ConventionCandidate.rule` truncation (§8). */
export const MAX_RULE_CHARS = 400;
/** FindingOut.rationale truncation, `detail: 'full'` only (§10). */
export const MAX_RATIONALE_CHARS = 240;
/** ReviewResult.summary truncation (§10). */
export const MAX_SUMMARY_CHARS = 600;
/** Rendered `text` content-block ceiling, well under Claude Code's 25k-token
 * truncation (§10). */
export const MAX_RESULT_CHARS = 24_000;

// ---- "Available X" list caps in error messages (§11) ----------------------
export const MAX_LISTED_ALTERNATIVES = 20;

// ---- Pagination (§7, §8) ---------------------------------------------------
export const DEFAULT_FINDING_LIMIT = 50;
export const MAX_FINDING_LIMIT = 200;
export const DEFAULT_CONVENTION_LIMIT = 50;
export const MAX_CONVENTION_LIMIT = 200;

// ---- HTTP timeouts (§3) -----------------------------------------------------
export const HTTP_TIMEOUT_MS = 15_000;
/** `GET /repos/:id/pulls` does a live GitHub round-trip (constraint 10). */
export const HTTP_TIMEOUT_SLOW_MS = 30_000;

// ---- run_agent_on_pr polling (§6) ------------------------------------------
export const POLL_FAST_MS = 2_000;
export const POLL_FAST_WINDOW_MS = 60_000;
export const POLL_SLOW_MS = 5_000;
/** 3 min; overridable via `DEVDIGEST_MCP_RUN_TIMEOUT_MS` (open question 4). */
export const RUN_WAIT_BUDGET_MS = 180_000;

// ---- The MCP vocabulary's severity order (constraint 12: total order) -----
export const SEVERITY_ORDER = ['critical', 'warning', 'suggestion'] as const;

// ---- Alternatives-list formatting helper -----------------------------------
function listAlternatives(items: string[]): string {
  if (items.length === 0) return 'none';
  if (items.length <= MAX_LISTED_ALTERNATIVES) return items.join(', ');
  const shown = items.slice(0, MAX_LISTED_ALTERNATIVES);
  const more = items.length - MAX_LISTED_ALTERNATIVES;
  return `${shown.join(', ')}, … and ${more} more`;
}

// ---- §11 — errors that lead forward ----------------------------------------
// Every builder below takes only already-validated arguments (the caller's
// own repo/pr/agent/run_id) and resolved names from the API — never a
// finding title, summary, rule text or raw API error body (§15).

export function unknownAgentMessage(agent: string, availableNames: string[]): string {
  return (
    `Agent "${agent}" not found. Available agents: ${listAlternatives(availableNames)}. ` +
    `Call list_agents for details, then retry with an exact name.`
  );
}

export function ambiguousAgentMessage(agent: string, matchedNames: string[]): string {
  const quoted = matchedNames.map((n) => `"${n}"`).join(', ');
  return `Agent name "${agent}" matches ${matchedNames.length} agents: ${quoted}. Retry with the exact name.`;
}

export function unknownRepoMessage(repo: string, availableFullNames: string[]): string {
  return (
    `Repository "${repo}" is not in this DevDigest workspace. ` +
    `Available: ${listAlternatives(availableFullNames)}. Import a repository at ${WEB_UI_URL} first.`
  );
}

export function unknownPrMessage(pr: number, repoFullName: string, availableNumbers: number[]): string {
  const list = listAlternatives(availableNumbers.map((n) => `#${n}`));
  return (
    `PR #${pr} was not found in ${repoFullName}. Imported PRs include: ${list}. ` +
    `Open the repository at ${WEB_UI_URL} to import more.`
  );
}

export function unknownRunIdMessage(runId: string, pr: number, agent: string): string {
  return (
    `No review with run_id "${runId}" exists for PR #${pr}. ` +
    `Call get_findings without run_id for ${agent}'s latest review, or run_agent_on_pr to start a new one.`
  );
}

export function agentHasNoReviewMessage(
  agent: string,
  pr: number,
  agentsWithReview: string[],
): string {
  const list = listAlternatives(agentsWithReview);
  const example = agentsWithReview[0];
  const getFindingsClause = example ? `Call get_findings with agent="${example}", or ` : '';
  return (
    `Agent "${agent}" has not reviewed PR #${pr}. Agents that have: ${list}. ` +
    `${getFindingsClause}run_agent_on_pr with agent="${agent}" to review it now.`
  );
}

export function noReviewsAtAllMessage(pr: number): string {
  return `PR #${pr} has no completed reviews. Call run_agent_on_pr with repo, pr and an agent name from list_agents.`;
}

export function apiUnreachableMessage(apiUrl: string): string {
  return `The DevDigest API is not reachable at ${apiUrl}. Start it with ./scripts/dev.sh from the repository root, then retry this tool.`;
}

/** The status/code/message triple only — callers append an endpoint-specific
 * next step of their own (also a fixed constant), per §11's table. */
export function apiErrorMessage(status: number, code: string, message: string): string {
  return `The DevDigest API returned ${status} (${code}): ${message}.`;
}

export const RATE_LIMITED_MESSAGE =
  'The DevDigest API is rate-limiting requests (10 reviews/minute). Wait a minute, then call run_agent_on_pr again.';

export function runFailedMessage(error: string | null): string {
  const reason = error ?? 'no error detail was recorded';
  return (
    `The review run failed: ${reason}. ` +
    `Check the model/API key for this agent in DevDigest Settings (${WEB_UI_URL}), then call run_agent_on_pr again.`
  );
}

export const RUN_CANCELLED_MESSAGE =
  'The review run was cancelled. Call run_agent_on_pr again to start a new one.';

export function noRunsStartedMessage(agent: string, pr: number): string {
  return (
    `DevDigest did not start a run for agent "${agent}" on PR #${pr}. This is unexpected — ` +
    `check the DevDigest API logs, then try run_agent_on_pr again.`
  );
}

export function reviewMissingAfterDoneMessage(runId: string, pr: number): string {
  return (
    `Run ${runId} finished but no matching review was found for PR #${pr}. This indicates an ` +
    `inconsistency in DevDigest — check the API logs, then try run_agent_on_pr again.`
  );
}

/** run_agent_on_pr soft timeout (§6 step 7) — the exact next call, every
 * argument value spelled out. */
export function stillRunningNextStep(repo: string, pr: number, agent: string, runId: string): string {
  return `Review is still running. Call get_findings with repo="${repo}", pr=${pr}, agent="${agent}", run_id="${runId}" in a minute to collect it.`;
}

/** get_findings "agent has an active run but no review yet" path (§7). */
export function findingsStillRunningNextStep(repo: string, pr: number, agent: string): string {
  return `The agent's review is still running. Call get_findings with repo="${repo}", pr=${pr}, agent="${agent}" again in a minute to collect it.`;
}

export function noConventionsExtractedMessage(repoFullName: string): string {
  return (
    `No conventions have been extracted for ${repoFullName} yet. Extract them in the DevDigest UI ` +
    `first: ${WEB_UI_URL} → the repository → Conventions → Extract (it makes an LLM call, so this ` +
    `tool will not run it for you). Then call get_conventions again.`
  );
}

/** get_blast_radius (§9) — not-implemented stub, both the tool description
 * lead-in and the Tool Execution Error carry this. */
export const BLAST_RADIUS_NOT_IMPLEMENTED_MESSAGE =
  `get_blast_radius is not implemented in this DevDigest build (it ships in course lesson L04). ` +
  `Nothing was analysed. For what a review found on this PR, call get_findings with repo, pr and ` +
  `an agent name from list_agents; to see the changed files themselves, open ${WEB_UI_URL}. Do not retry this tool.`;

/** list_agents empty-result next_step (§5) — a non-error result. */
export const NO_AGENTS_CONFIGURED_NEXT_STEP = `No agents are configured yet. Create one in the DevDigest UI: ${WEB_UI_URL} → Agents.`;

/** Appended when the rendered text block is cut at a finding boundary (§10). */
export const RESULT_TRUNCATED_NOTE =
  '… truncated; call get_findings with severity="critical" or a smaller limit.';

/** ReviewResult.next_step when more findings exist than `limit` returned
 * (data-level pagination, distinct from the character-level `RESULT_TRUNCATED_NOTE`). */
export function findingsTruncatedNextStep(shown: number, total: number): string {
  return `Showing ${shown} of ${total} findings. Call again with a higher limit or a severity filter to narrow the results.`;
}

/** ConventionsListResult.next_step when more conventions exist than `limit` returned. */
export function conventionsTruncatedNextStep(shown: number, total: number): string {
  return `Showing ${shown} of ${total} conventions. Call get_conventions again with a higher limit to see the rest.`;
}

/** Generic next step appended to an unrecognised API 4xx/5xx (§11's table:
 * "+ the endpoint-appropriate next step" — fixed text, never derived from
 * the API's own error body beyond the status/code/message already surfaced
 * by `apiErrorMessage`). */
export function genericApiErrorNextStep(toolName: string): string {
  return `Retry ${toolName} in a moment, or check the DevDigest API logs if this keeps happening.`;
}

/** A tool handler caught something that is neither a `ToolError` nor an
 * `ApiError`/`ApiUnreachableError` — an unexpected bug, not a resolvable
 * user mistake. Still rendered as a Tool Execution Error, never a rejection
 * (constraint 8). */
export function unexpectedErrorMessage(toolName: string, detail: string): string {
  return `${toolName} failed unexpectedly: ${detail}. Check the DevDigest API logs, then retry.`;
}
