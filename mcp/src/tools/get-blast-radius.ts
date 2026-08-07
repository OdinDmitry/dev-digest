import { DepthArg, PrArg, RepoArg } from './schemas.js';
import { BLAST_RADIUS_NOT_IMPLEMENTED_MESSAGE } from '../constants.js';
import { defineTool } from './types.js';

const TOOL_NAME = 'get_blast_radius';

/**
 * §9 — a deliberate not-yet-implemented stub, shipped with its FINAL
 * argument signature so nothing changes when course lesson L04 fills it in.
 * Makes NO HTTP call at all and always returns a Tool Execution Error —
 * never a fake empty success.
 */
export const getBlastRadiusTool = defineTool({
  name: TOOL_NAME,
  title: 'Blast radius (not implemented)',
  description:
    'Not implemented yet (ships in course lesson L04). Would show the import-graph impact of a pull request’s changes.',
  inputSchema: { repo: RepoArg, pr: PrArg, depth: DepthArg },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async handler(_args, _deps) {
    return {
      content: [{ type: 'text', text: BLAST_RADIUS_NOT_IMPLEMENTED_MESSAGE }],
      isError: true,
    };
  },
});
