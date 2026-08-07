/**
 * Stderr-only logger. stdout is the JSON-RPC channel (constraint 7) — not one
 * byte of logging may reach it, so this wraps `console.error` exclusively and
 * is the only place in the package allowed to call it directly.
 */

export interface Logger {
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
  /** Only emitted when the logger was created with `debug: true`
   * (`DEVDIGEST_MCP_DEBUG=1`) — silent by default (§3). Never logs response
   * bodies at the default level; callers must pass debug-only data here. */
  debug(msg: string, data?: unknown): void;
}

function safeStringify(data: unknown): string {
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

function write(level: string, msg: string, data?: unknown): void {
  const suffix = data === undefined ? '' : ` ${safeStringify(data)}`;
  // eslint-disable-next-line no-console -- the one sanctioned stderr sink
  console.error(`[devdigest-mcp] ${level}: ${msg}${suffix}`);
}

export function createLogger(debug: boolean): Logger {
  return {
    info: (msg, data) => write('info', msg, data),
    warn: (msg, data) => write('warn', msg, data),
    error: (msg, data) => write('error', msg, data),
    debug: (msg, data) => {
      if (debug) write('debug', msg, data);
    },
  };
}
