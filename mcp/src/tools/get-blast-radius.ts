import { resolvePr, resolveRepo, ToolError } from '../devdigest/resolve.js';
import { projectBlast, renderBlastText } from '../project.js';
import { BlastRadiusResult, DepthArg, PrArg, RepoArg } from './schemas.js';
import { blastDegradedMessage } from '../constants.js';
import { defineTool, renderToolError } from './types.js';

const TOOL_NAME = 'get_blast_radius';

/**
 * §10 — a pure Postgres read over the `repo-intel` index via `GET
 * /pulls/:id/blast`: which symbols the PR's changed files declare, who
 * calls them, and which HTTP endpoints are reachable through the 2-hop
 * reverse-import graph. No LLM call, no request-time AST/ripgrep scan.
 */
export const getBlastRadiusTool = defineTool({
  name: TOOL_NAME,
  title: 'Blast radius of a pull request',
  description:
    "Show which symbols, callers and HTTP endpoints a pull request's changed files reach through the import graph. Read-only, no LLM call.",
  inputSchema: { repo: RepoArg, pr: PrArg, depth: DepthArg },
  outputSchema: BlastRadiusResult.shape,
  annotations: { readOnlyHint: true, openWorldHint: false },
  async handler(args, { api }) {
    // `depth` shipped in `0004` for input-schema stability. The server
    // traversal is fixed at `BFS_DEPTH = 2` (repo-intel) and the route
    // takes no depth parameter, so this argument is deliberately never
    // forwarded — a documented simplification, not a TODO
    // (`specs/0005-blast-radius.md` §10, Out of scope).
    void args.depth;
    try {
      const repo = await resolveRepo(api, args.repo);
      const pr = await resolvePr(api, repo, args.pr);
      const wire = await api.getBlastRadius(pr.id);

      if (wire.state === 'degraded') {
        // The index isn't ready — never a fake empty success (§3 step 4 /
        // §10). No `structuredContent` at all on this path.
        throw new ToolError(blastDegradedMessage(repo.full_name, wire.reason ?? null));
      }

      const result = projectBlast(wire, repo.full_name, pr.number);
      return {
        content: [{ type: 'text', text: renderBlastText(result) }],
        structuredContent: result,
      };
    } catch (err) {
      return renderToolError(err, TOOL_NAME);
    }
  },
});
