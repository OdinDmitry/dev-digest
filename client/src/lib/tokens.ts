/**
 * Rough token count for prompt-budget hints in the editor.
 *
 * An explicit copy of `approxTokens` in `server/src/adapters/tokenizer/index.ts`
 * (the same 4-chars-per-token estimate the server itself falls back to). It is
 * computed here rather than fetched because the counter updates on every
 * keystroke: a server round-trip per edit would need debouncing and still lag,
 * and shipping a real BPE tokenizer to the browser drags ~1 MB of rank tables in
 * for an advisory number next to an 8,000 ceiling.
 *
 * Treat it as a hint, never as a billing figure.
 */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
