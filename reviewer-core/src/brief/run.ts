import type { BriefDoc, LLMProvider } from '@devdigest/shared';
import { assembleBriefPrompt, type BriefInput } from './prompt.js';
import { groundBrief } from './grounding.js';
import { enforceNotTitle } from './helpers.js';
import { RawBrief } from './schema.js';

export type { BriefInput };

/**
 * Name for the structured-output schema/tool call. Local to this package —
 * `generateBrief`'s signature is frozen at `{ llm, model, input }`, so this
 * cannot be threaded in from the caller (the server has its own, separate
 * `BRIEF_SCHEMA_NAME` constant for its own observability logging).
 */
const RAW_BRIEF_SCHEMA_NAME = 'RawBrief';

export interface BriefOutcome {
  doc: BriefDoc;
  /** Exactly one structured call per generation, never a second one — the
   *  `maxRetries` below is the provider's own transport/JSON-repair loop
   *  (`llm/structured.ts`), not a second generation. */
  modelCalls: 1;
}

/**
 * generateBrief — the brief engine entry point: one structured LLM call,
 * the AC-2 post-condition, then the mandatory citation-grounding gate.
 * No DB, GitHub, or filesystem access — the only side effect is the
 * injected `LLMProvider` (`reviewer-core/CLAUDE.md`).
 */
export async function generateBrief(args: {
  llm: LLMProvider;
  model: string;
  input: BriefInput;
}): Promise<BriefOutcome> {
  const { llm, model, input } = args;
  const { messages } = assembleBriefPrompt(input);

  const result = await llm.completeStructured({
    model,
    schema: RawBrief,
    schemaName: RAW_BRIEF_SCHEMA_NAME,
    temperature: 0.1,
    maxRetries: 2,
    messages,
  });

  const what = enforceNotTitle(result.data.what, input.title, input.fallbackWhat);
  const grounded = groundBrief(result.data, {
    files: new Set(input.files),
    endpoints: new Set(input.endpoints),
  });

  const doc: BriefDoc = {
    what,
    why: result.data.why,
    risk_level: result.data.risk_level,
    risks: grounded.risks,
    review_focus: grounded.review_focus,
  };

  return { doc, modelCalls: 1 };
}
