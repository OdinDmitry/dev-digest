import type { DevDigestApi } from './api.js';
import {
  ambiguousAgentMessage,
  unknownAgentMessage,
  unknownPrMessage,
  unknownRepoMessage,
} from '../constants.js';

/**
 * Ring 2 — the human-scale-args ↔ uuid bridge (§4). Takes `DevDigestApi` and
 * plain data only — never the config object, never the logger, never an SDK
 * type. Deliberately uncached: all three lists are small and change while
 * the user works (importing a repo, creating an agent, opening a PR); a
 * stale cache would produce "not found" for something the user just added.
 */

/** A business-logic / resolution failure the model can read and self-correct
 * from — always rendered as a Tool Execution Error (`isError: true`), never
 * thrown out of the process (§11). The message is pre-rendered in full (what
 * happened → what's available → the exact next call) by the builders in
 * `constants.ts`. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

const REPO_SLUG_PATTERN = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/;
const GITHUB_URL_PATTERN = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?(?:[/?#].*)?$/i;

/**
 * Normalise a `repo` argument to `owner/name`. Accepts `"owner/name"` or a
 * full GitHub URL (with or without `.git`/trailing slash/extra path
 * segments). Pure — no I/O, unit-tested directly (§16). Validated beyond
 * shape per §15: rejects `..`, a leading `-` on either segment, and anything
 * not matching the slug pattern.
 */
export function parseRepoArg(repoArg: string): string {
  const trimmed = repoArg.trim();
  const urlMatch = trimmed.match(GITHUB_URL_PATTERN);
  const slug = urlMatch ? `${urlMatch[1]}/${urlMatch[2]}` : trimmed;

  if (!REPO_SLUG_PATTERN.test(slug) || slug.includes('..')) {
    throw new ToolError(
      `"${repoArg}" is not a valid repository reference. Use "owner/name" or a GitHub URL like https://github.com/owner/name.`,
    );
  }
  const [owner, name] = slug.split('/') as [string, string];
  if (owner.startsWith('-') || name.startsWith('-')) {
    throw new ToolError(`"${repoArg}" is not a valid repository reference (must not start with "-").`);
  }
  return slug;
}

/** `repo` → `{ id, full_name }`. Exact, case-insensitive match against
 * `Repo.full_name` only — no fuzzy/prefix matching, which would silently
 * target the wrong repository (§4). */
export async function resolveRepo(
  api: DevDigestApi,
  repoArg: string,
): Promise<{ id: string; full_name: string }> {
  const slug = parseRepoArg(repoArg);
  const repos = await api.listRepos();
  const match = repos.find((r) => r.full_name.toLowerCase() === slug.toLowerCase());
  if (!match) {
    throw new ToolError(unknownRepoMessage(repoArg, repos.map((r) => r.full_name)));
  }
  return { id: match.id, full_name: match.full_name };
}

/** `(repoId, prNumber)` → `{ id, number, title }`, resolved against `GET
 * /repos/:id/pulls` — never `GET /pulls/:id` (its `files[]`+patches payload
 * is huge and nothing here needs it, constraint 10). Rows with a `null` id
 * are skipped (the contract allows it). */
export async function resolvePr(
  api: DevDigestApi,
  repo: { id: string; full_name: string },
  prNumber: number,
): Promise<{ id: string; number: number; title: string }> {
  const pulls = await api.listPulls(repo.id);
  const addressable = pulls.filter((p): p is typeof p & { id: string } => p.id != null);
  const match = addressable.find((p) => p.number === prNumber);
  if (!match) {
    const available = addressable
      .map((p) => p.number)
      .sort((a, b) => b - a);
    throw new ToolError(unknownPrMessage(prNumber, repo.full_name, available));
  }
  return { id: match.id, number: match.number, title: match.title };
}

/** `agent` → `{ id, name }`, matched case-insensitively against `GET
 * /agents`. Two enabled agents sharing a name case-insensitively is
 * ambiguity: name both and ask for an exact-case name, then match
 * case-sensitively on the retry — never silently pick the first (§4). */
export async function resolveAgent(
  api: DevDigestApi,
  agentName: string,
): Promise<{ id: string; name: string }> {
  const agents = await api.listAgents();
  const ciMatches = agents.filter((a) => a.name.toLowerCase() === agentName.toLowerCase());

  if (ciMatches.length === 0) {
    throw new ToolError(unknownAgentMessage(agentName, agents.map((a) => a.name)));
  }
  if (ciMatches.length === 1) {
    const only = ciMatches[0]!;
    return { id: only.id, name: only.name };
  }

  // Ambiguous case-insensitive tie — an exact-case match narrows it (the
  // "retry" the error message asks for).
  const csMatches = ciMatches.filter((a) => a.name === agentName);
  if (csMatches.length === 1) {
    const only = csMatches[0]!;
    return { id: only.id, name: only.name };
  }
  throw new ToolError(ambiguousAgentMessage(agentName, ciMatches.map((a) => a.name)));
}
