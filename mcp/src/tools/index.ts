import { listAgentsTool } from './list-agents.js';
import { runAgentOnPrTool } from './run-agent-on-pr.js';
import { getFindingsTool } from './get-findings.js';
import { getConventionsTool } from './get-conventions.js';
import { getBlastRadiusTool } from './get-blast-radius.js';
import type { ToolDefinition, ToolDeps } from './types.js';

/**
 * The five tools, in this fixed order — the names are fixed at five (Out of
 * scope: "A sixth tool"). Each `ToolDefinition` is a static object; `deps`
 * (the `DevDigestApi` + the run-wait budget, §1) is not consumed here — it
 * flows to each tool's `handler` as its second argument at CALL time
 * (step 7: "handler takes the validated args + DevDigestApi"), not at build
 * time. `buildTools` takes `deps` anyway so callers (`src/index.ts`, tests)
 * have one assembly point that mirrors the shape they'll invoke handlers
 * with.
 */
export function buildTools(deps: ToolDeps): ToolDefinition[] {
  void deps;
  return [listAgentsTool, runAgentOnPrTool, getFindingsTool, getConventionsTool, getBlastRadiusTool] as ToolDefinition[];
}
