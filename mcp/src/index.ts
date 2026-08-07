#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { loadConfig, ConfigError } from './config.js';
import { createLogger, type Logger } from './logging.js';
import { HttpDevDigestApi } from './devdigest/http.js';
import { buildTools } from './tools/index.js';
import { INSTRUCTIONS } from './instructions.js';

/**
 * Ring 4 — composition root. The ONLY file that imports the MCP SDK, the
 * ONLY file that constructs `HttpDevDigestApi`, and (with `test/server.test.ts`,
 * which exercises the same wiring) the only place `McpServer` is used (§1).
 */

const SERVER_NAME = 'devdigest';
const SERVER_VERSION = '0.0.0';

// A logger that exists before config is validated — the fallback sink for
// the one legitimate `process.exit` (constraint 8: an invalid config is a
// *startup* failure, and only a startup failure).
const bootLogger: Logger = createLogger(false);

async function main(): Promise<void> {
  // Throws ConfigError synchronously — nothing async has happened yet, so
  // this is still "before the transport connects".
  const config = loadConfig();
  const logger = createLogger(config.debug);

  const api = new HttpDevDigestApi(config.apiUrl, logger);
  const deps = { api, runWaitBudgetMs: config.runWaitBudgetMs };
  const tools = buildTools(deps);

  // The API being unreachable at this point is NOT a startup failure (§13) —
  // the server must start and register its tools regardless; the first tool
  // call reports the unreachable API (§11). No health check here.
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );

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
      async (args): Promise<CallToolResult> => {
        // No handler may reject (constraint 8) — every ToolDefinition
        // handler already catches its own errors via `renderToolError`, so
        // this call is not wrapped in a try/catch of its own.
        const result = await tool.handler(args, deps);
        return result as CallToolResult;
      },
    );
  }

  const transport = new StdioServerTransport();

  // A crash kills a stdio server for the rest of the session, unlike
  // HTTP/SSE (constraint 8) — log and keep running rather than exit, once
  // the transport is connected. Startup failures (above) are the exception.
  process.on('uncaughtException', (err) => {
    logger.error('uncaughtException', { message: err.message, stack: err.stack });
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandledRejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`received ${signal}, shutting down`);
    server
      .close()
      .catch((err: unknown) => logger.error('error while closing transport', { err }))
      .finally(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await server.connect(transport);
  logger.info('devdigest-mcp connected', { apiUrl: config.apiUrl });
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) {
    bootLogger.error(err.message);
  } else {
    bootLogger.error('fatal startup error', { message: err instanceof Error ? err.message : String(err) });
  }
  process.exit(1);
});
