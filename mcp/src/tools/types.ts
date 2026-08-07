import type { z } from 'zod';
import type { DevDigestApi } from '../devdigest/api.js';
import { ApiError, ApiUnreachableError } from '../devdigest/api.js';
import { ToolError } from '../devdigest/resolve.js';
import { apiErrorMessage, genericApiErrorNextStep, RATE_LIMITED_MESSAGE, unexpectedErrorMessage } from '../constants.js';

/**
 * Ring 4 — the vocabulary tool files share. Deliberately **not** the MCP
 * SDK's own types: a tool file exports a plain `ToolDefinition` object,
 * which is what makes every tool testable without a transport and keeps the
 * SDK swappable (§1). `src/index.ts` is the only file that adapts these into
 * `McpServer.registerTool()` calls.
 */

export type ToolInputShape = Record<string, z.ZodTypeAny>;

export interface ToolContent {
  type: 'text';
  text: string;
}

export interface ToolResult {
  content: ToolContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolDeps {
  api: DevDigestApi;
  /** run_agent_on_pr's poll-loop soft-timeout budget (§6); unused by the
   * other four tools. */
  runWaitBudgetMs: number;
}

export interface ToolDefinition<Args extends ToolInputShape = ToolInputShape> {
  name: string;
  title: string;
  description: string;
  inputSchema: Args;
  outputSchema?: ToolInputShape;
  annotations?: ToolAnnotations;
  /** No handler may reject — every throw is caught by `index.ts` (or, in
   * tests, by the caller) and rendered via `renderToolError` (§11, constraint 8). */
  handler: (args: { [K in keyof Args]: z.infer<Args[K]> }, deps: ToolDeps) => Promise<ToolResult>;
}

/** Identity helper purely for generic inference: lets each tool file write a
 * plain object literal and have TypeScript infer `Args` from `inputSchema`
 * instead of hand-annotating `ToolDefinition<{...}>` everywhere. */
export function defineTool<Args extends ToolInputShape>(def: ToolDefinition<Args>): ToolDefinition<Args> {
  return def;
}

/** `ToolError` is defined in `devdigest/resolve.ts` (ring 2, so `resolve.ts`
 * itself can throw it without importing anything from `tools/`) and
 * re-exported here alongside `ToolDefinition` for tool files to import from
 * one place. */
export { ToolError };

/**
 * Renders any thrown error as a Tool Execution Error (`isError: true`) —
 * never a rejection (constraint 8). `ToolError` messages are already fully
 * forward-leading (§11); `ApiError`/`ApiUnreachableError` get a fixed,
 * endpoint-appropriate next step appended, never text derived from the API's
 * own error body beyond what `apiErrorMessage` already surfaces (§15).
 */
export function renderToolError(err: unknown, toolName: string): ToolResult {
  return { content: [{ type: 'text', text: toErrorMessage(err, toolName) }], isError: true };
}

function toErrorMessage(err: unknown, toolName: string): string {
  if (err instanceof ToolError) return err.message;
  if (err instanceof ApiUnreachableError) return err.message;
  if (err instanceof ApiError) {
    if (err.status === 429) return RATE_LIMITED_MESSAGE;
    return `${apiErrorMessage(err.status, err.code, err.message)} ${genericApiErrorNextStep(toolName)}`;
  }
  const detail = err instanceof Error ? err.message : String(err);
  return unexpectedErrorMessage(toolName, detail);
}
