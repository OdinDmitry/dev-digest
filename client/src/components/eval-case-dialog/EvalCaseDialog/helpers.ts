/* EvalCaseDialog/helpers.ts — pure polarity/validation helpers for the
   eval-case editor (SPEC-03 T6). Mirrors, client-side and independently,
   the server's own `polarityOf`/`validateExpectations`
   (server/src/modules/evals/helpers.ts) — the dialog must reject bad JSON
   before it is ever sent to the API. */

import type { EvalExpectation } from "@devdigest/shared";

/** The polarity shared by every expectation in a (valid) list. An empty or
 *  not-yet-seeded draft defaults to `must_find` — a brand-new case (no
 *  `caseRecord`/seed) can never legitimately be `must_not_flag` (AC-9's
 *  server-side resolution table rejects an empty incoming list unless a
 *  STORED case is already negative), so there is nothing else to derive it
 *  from. */
export function polarityOf(expectations: EvalExpectation[]): EvalExpectation["kind"] {
  return expectations[0]?.kind ?? "must_find";
}

/** AC-7 — the "Expected output" editor's own displayed content: the real,
 *  editable JSON for a positive case; a fixed `"[]"` projection for a
 *  negative one. The real (non-empty) expectations for a negative case
 *  still live in the draft — they render separately as the read-only
 *  "Forbidden zones" list (AC-10) instead of through this editor. */
export function projectExpectedOutput(expectations: EvalExpectation[]): string {
  if (polarityOf(expectations) === "must_not_flag") return "[]";
  return JSON.stringify(expectations, null, 2);
}

/** Structural check mirroring the `EvalExpectation` Zod shape
 *  (src/vendor/shared/contracts/knowledge.ts) without importing it as a
 *  value — the shared barrel's `.js` specifiers are unresolvable by
 *  Next.js's webpack, so this validation must stay hand-written. Keep in
 *  sync with that schema if it changes. */
function isEvalExpectation(value: unknown): value is EvalExpectation {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.kind === "must_find" || candidate.kind === "must_not_flag") &&
    typeof candidate.file === "string" &&
    candidate.file.length > 0 &&
    Number.isInteger(candidate.start_line) &&
    (candidate.start_line as number) >= 0 &&
    Number.isInteger(candidate.end_line) &&
    (candidate.end_line as number) >= 0
  );
}

/** AC-9 (client half) — parse + validate the "Expected output" textarea's
 *  raw text: valid JSON, a non-empty array, every entry shaped like
 *  `EvalExpectation` (file/start_line/end_line included), and every entry
 *  sharing one `kind`. Returns `null` for anything invalid — bad JSON, wrong
 *  shape, empty, or mixed kinds — so the caller can show
 *  `caseEditor.expectedInvalid` without re-deriving why. */
export function parseExpectations(text: string): EvalExpectation[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  if (!parsed.every(isEvalExpectation)) return null;
  const kinds = new Set(parsed.map((e) => e.kind));
  if (kinds.size > 1) return null;
  return parsed;
}
