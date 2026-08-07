import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { buildTools } from '../src/tools/index.js';
import type { ToolDeps } from '../src/tools/types.js';
import { INSTRUCTIONS } from '../src/instructions.js';
import { FakeDevDigestApi, makeAgent } from './helpers/fake-api.js';

/**
 * §16 `server.test.ts` — wires the REAL `McpServer` to a REAL `Client` over
 * `InMemoryTransport` (confirmed exported at
 * `@modelcontextprotocol/sdk/inMemory.js` in the installed 1.30.0), lists
 * tools, and calls `list_agents` end to end against the fake API. This is
 * the one test that exercises the actual SDK wiring `src/index.ts` performs
 * (registerTool, instructions, protocol round-trip) rather than calling a
 * `ToolDefinition.handler` directly.
 */
async function buildConnectedServerAndClient(deps: ToolDeps): Promise<{ client: Client; server: McpServer }> {
  const tools = buildTools(deps);
  const server = new McpServer({ name: 'devdigest', version: '0.0.0' }, { instructions: INSTRUCTIONS });

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
      },
      async (args): Promise<CallToolResult> => (await tool.handler(args, deps)) as CallToolResult,
    );
  }

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'server-test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

describe('McpServer wiring (real SDK, InMemoryTransport)', () => {
  it('lists the 5 tool names and the server instructions blurb', async () => {
    const api = new FakeDevDigestApi();
    const { client, server } = await buildConnectedServerAndClient({ api, runWaitBudgetMs: 180_000 });

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      'list_agents',
      'run_agent_on_pr',
      'get_findings',
      'get_conventions',
      'get_blast_radius',
    ]);

    const serverInstructions = client.getInstructions();
    expect(serverInstructions).toBe(INSTRUCTIONS);

    await server.close();
  });

  it('calls list_agents end to end against the fake API', async () => {
    const api = new FakeDevDigestApi();
    api.agents = [makeAgent({ name: 'General' }), makeAgent({ name: 'Security' })];
    const { client, server } = await buildConnectedServerAndClient({ api, runWaitBudgetMs: 180_000 });

    const result = await client.callTool({ name: 'list_agents', arguments: {} });

    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { count: number }).count).toBe(2);
    expect(Array.isArray(result.content)).toBe(true);

    await server.close();
  });

  it('an unknown-agent call round-trips as a Tool Execution Error, not a protocol error', async () => {
    const api = new FakeDevDigestApi();
    api.agents = [makeAgent({ name: 'General' })];
    api.repos = [{ id: 'r1', full_name: 'acme/payments-api' }];
    api.pulls['r1'] = [{ id: 'pr1', number: 482, title: 'x' }];
    const { client, server } = await buildConnectedServerAndClient({ api, runWaitBudgetMs: 180_000 });

    const result = await client.callTool({
      name: 'get_findings',
      arguments: { repo: 'acme/payments-api', pr: 482, agent: 'Secrity' },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toContain('list_agents');

    await server.close();
  });
});
