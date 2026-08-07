# mcp/ — agent map

`@devdigest/mcp` — a local **stdio MCP server** that exposes DevDigest to
Claude Code / Claude Desktop: five tools (`list_agents`, `run_agent_on_pr`,
`get_findings`, `get_conventions`, `get_blast_radius` — a stub) backed by the
already-running local Fastify API on `http://localhost:3001`. No database,
GitHub, filesystem, or secrets access — a thin HTTP client, nothing else.
Full picture: [README.md](README.md).

Before starting work here, read [insights.md](insights.md) — treat it as
high-confidence guidance unless told otherwise. At the end of the task,
update it; don't skip this step.

## Commands
`pnpm dev` (runs via `tsx`, stdio) · `pnpm build` (emits to `dist/`) ·
`pnpm start` (`node dist/index.js`) · `pnpm test` (vitest, hermetic) ·
`pnpm typecheck` · `pnpm inspect` (builds, then launches
`@modelcontextprotocol/inspector` against `dist/index.js`)

## Where things live
- `src/index.ts` — composition root: the ONLY file that imports the MCP SDK
  and the only place that constructs `HttpDevDigestApi`
- `src/config.ts` — the ONE `process.env` chokepoint (`DEVDIGEST_API_URL`,
  `DEVDIGEST_MCP_RUN_TIMEOUT_MS`, `DEVDIGEST_MCP_DEBUG`)
- `src/constants.ts` — every budget/limit/fixed next-step and error message
- `src/logging.ts` — the stderr-only logger (stdout is the JSON-RPC channel)
- `src/instructions.ts` — the `McpServer` `instructions` blurb
- `src/devdigest/api.ts` — the `DevDigestApi` port (interface only)
- `src/devdigest/http.ts` — `HttpDevDigestApi`, the ONLY file that calls `fetch`
- `src/devdigest/wire.ts` — narrow zod parsers for the API's wire payloads
  (this package's anti-corruption layer — see Non-default conventions)
- `src/devdigest/resolve.ts` — human-scale args (`repo`/`pr`/`agent`) → uuids
- `src/project.ts` — pure API-shape → compact-result projections
- `src/tools/*.ts` — one file per tool, each exporting a plain
  `ToolDefinition` object; `tools/index.ts`'s `buildTools()` assembles all five

## Non-default conventions
- **stdout is the JSON-RPC channel.** Not one byte of logging/banner/progress
  may reach it — all diagnostics go through `logging.ts` to stderr.
- **No vendored `@devdigest/shared`.** This package declares its own narrow
  Zod parsers in `devdigest/wire.ts` covering only the fields it projects,
  rather than copying the shared contracts barrel (a third sync burden for
  ~15 fields, and part of what it needs — `ReviewDto` — isn't even a shared
  contract; it's `server/src/modules/reviews/helpers.ts`, a server-internal
  type). Every response is `.parse()`d at the boundary in `http.ts`, so a
  renamed server field fails loudly here, never as a silent `undefined`.
- **The SDK is pinned to the stable v1 line
  (`@modelcontextprotocol/sdk@^1.30.0`), on purpose** — not the v2 beta line.
  Do not "helpfully upgrade" it.
- **Tools never import the MCP SDK.** A tool file exports a plain
  `ToolDefinition` (`{ name, title, description, inputSchema, outputSchema,
  annotations, handler }`); only `src/index.ts` adapts these into
  `McpServer.registerTool()` calls. This is what makes every tool testable
  without a transport.
- **No handler ever rejects.** Every tool's `handler` catches its own errors
  and renders them as a Tool Execution Error (`isError: true`) via
  `renderToolError` — never an uncaught exception. A crashed stdio server is
  not auto-restarted (see Gotchas), so staying alive matters more than usual.
- **No caching in `resolve.ts`.** Repo/PR/agent lists are small and change
  while the user works; a stale cache would show "not found" for something
  the user just added in the UI.

## Gotchas
- **`.mcp.json` needs `pnpm build` first.** It points at `mcp/dist/index.js`
  (git-ignored, built locally) — run `cd mcp && pnpm install && pnpm build`
  once, or Claude Code shows the `devdigest` server as failed.
- **A crashed stdio server is not auto-restarted** (unlike HTTP/SSE) — restart
  the Claude Code session. This is why no tool handler and no startup path
  may throw out of the process (see Non-default conventions).
- **The DevDigest API must be running** (`./scripts/dev.sh` from the repo
  root) — the MCP server itself starts regardless and reports an unreachable
  API from the first tool call, rather than health-checking on boot.

## Do-not-touch
- nothing yet
