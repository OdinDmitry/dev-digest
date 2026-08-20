/**
 * LLM Message Pattern judge, on the subscription. Binary PASS/FAIL per practice, PASS only with
 * a verbatim evidence quote. The judge defaults to a stronger family than the task to soften
 * single-model self-preference; the structural mitigations (blind + binary + verbatim) do the
 * rest, since on a shared subscription the families overlap.
 */

import { EVAL_JUDGE_MODEL } from "../config.js";
import { runContent } from "../runtime/dispatch.js";

const JUDGE_RUBRIC =
  "You are a strict, blind evaluator. Given an OUTPUT and a list of PRACTICES, judge each " +
  "practice independently.\n" +
  "Rules: (1) exactly PASS or FAIL per practice, no scales. (2) PASS only when a direct " +
  "verbatim quote from the OUTPUT is evidence the practice was met — a keyword is not " +
  "evidence. (3) Reply with ONLY minified JSON:\n" +
  '{"results":[{"practice":"<text>","passed":true,"evidence":"<verbatim quote>"}]}';

export interface Verdict {
  results: { practice: string; passed: boolean; evidence: string }[];
  passed: number;
  total: number;
  score: number;
}

const CONTROL_ESCAPES: Record<string, string> = {
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\b": "\\b",
  "\f": "\\f",
};

/**
 * Escape raw control characters that appear INSIDE a JSON string literal.
 *
 * The judge is asked for a verbatim `evidence` quote, and a verbatim quote is frequently
 * multi-line — so the model emits a literal newline inside the string. That is invalid JSON
 * (U+0000–U+001F must be escaped) and `JSON.parse` rejects the whole verdict. Left unhandled, a
 * judge that graded correctly is indistinguishable from a skill that failed: the case dies with
 * `SyntaxError: Bad control character in string literal`. Weaker/cheaper judge models hit this
 * far more often, so it shows up as CI-only flakiness.
 *
 * Exported for the unit test — this is deterministic string handling, so it is worth pinning.
 */
export function escapeControlChars(json: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of json) {
    if (escaped) {
      out += ch;
      escaped = false;
    } else if (ch === "\\") {
      out += ch;
      escaped = true;
    } else if (ch === '"') {
      inString = !inString;
      out += ch;
    } else if (inString && ch < " ") {
      out += CONTROL_ESCAPES[ch] ?? `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;
    } else {
      out += ch;
    }
  }
  return out;
}

function parseVerdict(text: string): Verdict["results"] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new Error(`judge returned no JSON: ${text.slice(0, 200)}`);
  const raw = text.slice(start, end + 1);
  let obj: { results?: unknown };
  try {
    obj = JSON.parse(raw);
  } catch {
    // One repair attempt, then give up with the offending payload in the message — a judge that
    // cannot be parsed is an EVAL failure, and the error must say so rather than look like a
    // low score.
    try {
      obj = JSON.parse(escapeControlChars(raw));
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      throw new Error(`judge returned unparseable JSON (${why}): ${raw.slice(0, 300)}`);
    }
  }
  if (!Array.isArray(obj.results)) throw new Error("judge JSON missing results[]");
  return obj.results as Verdict["results"];
}

/** Judge an output against a list of practices. Model defaults to the stronger judge family. */
export async function llmJudge(output: string, practices: string[], model = EVAL_JUDGE_MODEL): Promise<Verdict> {
  const listed = practices.map((p, i) => `${i + 1}. ${p}`).join("\n");
  const prompt = `${JUDGE_RUBRIC}\n\n## PRACTICES\n${listed}\n\n## OUTPUT\n${output}\n\nReturn the JSON now.`;
  const res = await runContent(prompt, { allowedTools: [], maxTurns: 1, model });
  const results = parseVerdict(res.text);
  const total = results.length || 1;
  const passed = results.filter((r) => r.passed).length;
  return { results, passed, total, score: passed / total };
}
