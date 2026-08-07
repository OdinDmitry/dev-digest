import { resolveRepo, ToolError } from '../devdigest/resolve.js';
import { projectConventions, renderConventionsText } from '../project.js';
import { ConventionsListResult, ConventionsLimitArg, RepoArg } from './schemas.js';
import { conventionsTruncatedNextStep, DEFAULT_CONVENTION_LIMIT, noConventionsExtractedMessage } from '../constants.js';
import { defineTool, renderToolError } from './types.js';

const TOOL_NAME = 'get_conventions';

/**
 * §8 — read-only. Deliberately NO `extract`/`status` parameter: this tool
 * must never call `POST /repos/:id/conventions/extract` (synchronous,
 * LLM-backed — an MCP tool must not silently spend money and minutes).
 */
export const getConventionsTool = defineTool({
  name: TOOL_NAME,
  title: 'List extracted coding conventions',
  description:
    'List accepted and pending coding conventions extracted for a repository. Read-only — never runs extraction itself.',
  inputSchema: { repo: RepoArg, limit: ConventionsLimitArg },
  outputSchema: ConventionsListResult.shape,
  annotations: { readOnlyHint: true, openWorldHint: false },
  async handler(args, { api }) {
    try {
      const repo = await resolveRepo(api, args.repo);
      const wireConventions = await api.listConventions(repo.id);
      const all = projectConventions(wireConventions);

      if (all.length === 0) {
        throw new ToolError(noConventionsExtractedMessage(repo.full_name));
      }

      const limit = args.limit ?? DEFAULT_CONVENTION_LIMIT;
      const shown = all.slice(0, limit);
      const truncated = all.length > shown.length;

      const result: ConventionsListResult = {
        repo: repo.full_name,
        conventions: shown,
        conventions_total: all.length,
        truncated,
        next_step: truncated ? conventionsTruncatedNextStep(shown.length, all.length) : null,
      };
      return {
        content: [{ type: 'text', text: renderConventionsText(result) }],
        structuredContent: result,
      };
    } catch (err) {
      return renderToolError(err, TOOL_NAME);
    }
  },
});
