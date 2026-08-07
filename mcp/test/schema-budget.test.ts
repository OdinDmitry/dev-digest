import { describe, it, expect, beforeAll } from 'vitest';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildTools } from '../src/tools/index.js';
import { INSTRUCTIONS } from '../src/instructions.js';
import { FakeDevDigestApi } from './helpers/fake-api.js';

const MAX_DESCRIPTION_LENGTH = 200;
const MAX_TOOL_JSON_BYTES = 2048;
const MAX_INSTRUCTIONS_BYTES = 2048;

const EXPECTED_TOOL_NAMES = [
  'list_agents',
  'run_agent_on_pr',
  'get_findings',
  'get_conventions',
  'get_blast_radius',
];

/**
 * §12/§16 — measures what actually goes over the wire (the real MCP SDK's
 * own zod → JSON-schema conversion), not a hand-rolled approximation.
 */
describe('token-budget guards (§12)', () => {
  let listed: Awaited<ReturnType<Client['listTools']>>['tools'];

  beforeAll(async () => {
    const tools = buildTools({ api: new FakeDevDigestApi(), runWaitBudgetMs: 180_000 });
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (async (args: any) => tool.handler(args, { api: new FakeDevDigestApi(), runWaitBudgetMs: 180_000 })) as never,
      );
    }

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'schema-budget-test', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.listTools();
    listed = result.tools;
  });

  it('is exactly five tools with exactly the five fixed names', () => {
    expect(listed.map((t) => t.name)).toEqual(EXPECTED_TOOL_NAMES);
  });

  it('every description is <= 200 characters', () => {
    for (const tool of listed) {
      expect(tool.description!.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
    }
  });

  it('every input parameter is a scalar/enum (no nested object/array) with a non-empty description', () => {
    for (const tool of listed) {
      const properties = (tool.inputSchema.properties ?? {}) as Record<string, { type?: unknown; enum?: unknown; description?: string }>;
      for (const [param, prop] of Object.entries(properties)) {
        expect(['string', 'number', 'integer', 'boolean']).toContain(prop.type);
        expect(prop.description, `${tool.name}.${param} must have a description`).toBeTruthy();
      }
    }
  });

  it('the serialised {name, description, inputSchema} of every tool is < 2048 bytes', () => {
    for (const tool of listed) {
      const payload = JSON.stringify({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      });
      expect(Buffer.byteLength(payload, 'utf8')).toBeLessThan(MAX_TOOL_JSON_BYTES);
    }
  });

  it('title, outputSchema and annotations are present where §5-§9 specify them', () => {
    const byName = Object.fromEntries(listed.map((t) => [t.name, t]));
    for (const name of EXPECTED_TOOL_NAMES) {
      expect(byName[name]!.title).toBeTruthy();
      expect(byName[name]!.annotations).toBeTruthy();
    }
    expect(byName['get_blast_radius']!.outputSchema).toBeUndefined();
    for (const name of ['list_agents', 'run_agent_on_pr', 'get_findings', 'get_conventions']) {
      expect(byName[name]!.outputSchema).toBeTruthy();
    }
  });

  it('the instructions constant is under 2048 bytes and its first sentence names the product', () => {
    expect(Buffer.byteLength(INSTRUCTIONS, 'utf8')).toBeLessThan(MAX_INSTRUCTIONS_BYTES);
    const firstSentence = INSTRUCTIONS.split(/[.\n]/)[0]!;
    expect(firstSentence).toContain('DevDigest');
  });
});

// Sanity: the raw (pre-registration) input shape objects, checked directly
// against zod, catching a regression before it ever reaches the SDK.
describe('input shapes are flat (no ZodObject/ZodArray at the top level)', () => {
  const tools = buildTools({ api: new FakeDevDigestApi(), runWaitBudgetMs: 180_000 });

  it.each(tools.map((t) => [t.name, t] as const))('%s', (_name, tool) => {
    for (const schema of Object.values(tool.inputSchema)) {
      const inner = schema instanceof z.ZodOptional ? schema._def.innerType : schema;
      expect(inner).not.toBeInstanceOf(z.ZodObject);
      expect(inner).not.toBeInstanceOf(z.ZodArray);
    }
  });
});
