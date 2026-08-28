import { stringify } from 'yaml';
import { AgentManifest, MANIFEST_VERSION, type CiPostAs } from '@devdigest/shared';
import type { AgentRow } from '../agents/repository.js';
import { MANIFEST_DIR } from './constants.js';

/**
 * Pure generator (ring 2): builds the `AgentManifest` written to
 * `.devdigest/agents/<slug>.yaml` for an exported CI agent. No HTTP, no SQL —
 * `CiService` resolves the agent row and skill slugs before calling in.
 */
export function buildManifest(args: {
  agent: AgentRow;
  skillSlugs: string[];
  postAs: CiPostAs;
}): AgentManifest {
  const { agent, skillSlugs, postAs } = args;
  return {
    manifest_version: MANIFEST_VERSION,
    name: agent.name,
    provider: agent.provider,
    model: agent.model,
    system_prompt: agent.systemPrompt,
    skills: skillSlugs,
    strategy: agent.strategy,
    ci_fail_on: agent.ciFailOn,
    post_as: postAs,
  };
}

/** Serialize a validated manifest to the YAML text written into the export bundle. */
export function serializeManifest(manifest: AgentManifest): string {
  return stringify(manifest);
}

/** `.devdigest/agents/<slug>.yaml` — the checked-in manifest path. */
export function manifestPath(agentSlug: string): string {
  return `${MANIFEST_DIR}/${agentSlug}.yaml`;
}
