# reviewer-core/ — agent map

`@devdigest/reviewer-core` — pure review engine: diff → prompt → LLM →
grounded findings. No database, GitHub, or filesystem; the only side effect
is an LLM call through an **injected** `LLMProvider`. Full picture:
[README.md](README.md).

## Commands
`npm test` (vitest, hermetic, stubbed `LLMProvider`) · `npm run typecheck`
(doubles as the build — this package never emits JS)

## Where things live
- `src/prompt.ts` — `assemblePrompt()` / `wrapUntrusted()` + `INJECTION_GUARD`
- `src/grounding.ts` — `groundFindings()` / `groundingSummary()`, the
  mechanical citation gate against the diff
- `src/llm/openrouter.ts` — the `LLMProvider` implementation used in prod
- `src/llm/structured.ts` — `toJsonSchema()` / `extractJson()` /
  `parseWithRepair()` for structured LLM output
- `src/review/run.ts` — orchestrates a single-pass run · `reduce()` — the
  map-reduce path for larger diffs
- `src/index.ts` — the public API surface; contracts (`Review`, `Finding`,
  `Verdict`) come from `@devdigest/shared`

## Further reading (load only if relevant to the task)
- [docs/](docs/) — deep dives per topic
- [specs/](specs/) — design specs for planned/in-progress features
- [insights.md](insights.md) — decisions & gotchas log

## Non-default conventions
- Stay pure: no DB/network/filesystem access here — only the injected
  `LLMProvider` performs I/O. This is what keeps the package mock-testable
  and reusable from the (future) CI runner.
- Optional prompt slots (`skills`, `memory`, `specs`, `callers`) exist for
  later course lessons — leave them `undefined`/omitted rather than stubbing
  fake data; `assemblePrompt` already handles absence gracefully.

## Gotchas
- **Grounding is mandatory**: a finding without a real diff line citation is
  dropped, and the score is recomputed from surviving findings — never trust
  the model's self-reported score.
- The prompt-injection defense is the one shared `INJECTION_GUARD` rule, not
  keyword/text scanning — don't add a denylist, it only catches one phrasing.
- The server consumes this package as TypeScript **source** via a tsconfig
  path alias, not a built artifact — `pnpm build` here is a no-op beyond
  typecheck.
