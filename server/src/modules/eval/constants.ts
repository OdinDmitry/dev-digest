/**
 * Eval module constants.
 */

/**
 * Same hunk-header regex shape as `adapters/git/diff-parser.ts`'s parser
 * (`:46`) — kept here rather than imported so `helpers.ts` stays a pure
 * ring-2 module with no dependency on the diff-parsing adapter.
 */
export const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
