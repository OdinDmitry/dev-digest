# reviewer-core/ — engineering insights

Append-only. Newest entry on top within each section. Never edit or delete
existing entries. Promote anything that becomes a standing rule into
[CLAUDE.md](CLAUDE.md) instead of leaving it here.

Entry test: if it'd be obvious to anyone reading the code, don't write it.
Each entry must be specific enough that a cold agent knows exactly what to
do without re-investigating.

## What Works

## What Doesn't Work

## Codebase Patterns

- **Finding line ranges are normalized twice**: `normalizeLineRange` /
  `normalizeFindingLines` in `@devdigest/shared` `contracts/findings.ts`
  (Zod `.transform` on `Finding` at LLM parse time + `.describe` on line fields
  for JSON Schema). `groundFindings` calls `normalizeFindingLines` again before
  the citation gate so callers that bypass Zod (tests, mocks) still persist
  `start_line <= end_line`. Extend transport shapes with `FindingBase.extend()`,
  not `Finding.extend()` — `Finding` is a `ZodEffects` after transform.

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes
<!-- written by a separate end-of-session wrap-up flow, not this skill -->

## Open Questions
