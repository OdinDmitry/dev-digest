import { AgentsListResult } from './schemas.js';
import { projectAgents, renderAgentsText } from '../project.js';
import { NO_AGENTS_CONFIGURED_NEXT_STEP } from '../constants.js';
import { defineTool, renderToolError } from './types.js';

const TOOL_NAME = 'list_agents';

/**
 * §5 — result-not-operation: the answer itself, not a handle. No input (one
 * boolean `enabled_only` flag is not worth the schema bytes). An empty list
 * is a non-error result whose `next_step` points at the UI.
 */
export const listAgentsTool = defineTool({
  name: TOOL_NAME,
  title: 'List reviewer agents',
  description:
    'List reviewer agents available in this DevDigest workspace. Call first to get an agent name for run_agent_on_pr or get_findings.',
  inputSchema: {},
  outputSchema: AgentsListResult.shape,
  annotations: { readOnlyHint: true, openWorldHint: false },
  async handler(_args, { api }) {
    try {
      const wireAgents = await api.listAgents();
      const agents = projectAgents(wireAgents);
      const result: AgentsListResult = {
        agents,
        count: agents.length,
        next_step: agents.length === 0 ? NO_AGENTS_CONFIGURED_NEXT_STEP : null,
      };
      return {
        content: [{ type: 'text', text: renderAgentsText(result) }],
        structuredContent: result,
      };
    } catch (err) {
      return renderToolError(err, TOOL_NAME);
    }
  },
});
