import { z } from 'zod';
import { DEFAULT_API_URL, RUN_WAIT_BUDGET_MS } from './constants.js';

/**
 * The single `process.env` chokepoint (mirrors `SecretsProvider` on the
 * server — nothing else in this package reads `process.env` directly).
 * Validated once at startup; an invalid `DEVDIGEST_API_URL` is a *startup*
 * failure (§3) — `index.ts` is the only place allowed to `process.exit` on
 * it, and only before the transport connects (constraint 8).
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

const EnvSchema = z.object({
  DEVDIGEST_API_URL: z.string().url().default(DEFAULT_API_URL),
  DEVDIGEST_MCP_RUN_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  DEVDIGEST_MCP_DEBUG: z.string().optional(),
});

export interface McpConfig {
  /** Base URL of the local Fastify API, e.g. `http://localhost:3001`. */
  apiUrl: string;
  /** Soft-timeout budget for run_agent_on_pr's poll loop (§6). */
  runWaitBudgetMs: number;
  /** When true, `devdigest/http.ts` logs request/response summaries to stderr. */
  debug: boolean;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(`Invalid DevDigest MCP configuration: ${parsed.error.message}`);
  }
  const { DEVDIGEST_API_URL, DEVDIGEST_MCP_RUN_TIMEOUT_MS, DEVDIGEST_MCP_DEBUG } = parsed.data;

  // z.string().url() accepts protocols z.string().url() alone would allow
  // (e.g. `ftp:`); enforce the http(s)-only allowlist explicitly (§3, security).
  let protocol: string;
  try {
    protocol = new URL(DEVDIGEST_API_URL).protocol;
  } catch {
    throw new ConfigError(`DEVDIGEST_API_URL is not a valid URL: "${DEVDIGEST_API_URL}"`);
  }
  if (!ALLOWED_PROTOCOLS.has(protocol)) {
    throw new ConfigError(
      `DEVDIGEST_API_URL must use http: or https: (got "${protocol}" from "${DEVDIGEST_API_URL}")`,
    );
  }

  return {
    apiUrl: DEVDIGEST_API_URL,
    runWaitBudgetMs: DEVDIGEST_MCP_RUN_TIMEOUT_MS ?? RUN_WAIT_BUDGET_MS,
    debug: DEVDIGEST_MCP_DEBUG === '1',
  };
}
