import type { BriefInput } from '@devdigest/reviewer-core';
import type { Tokenizer } from '../../adapters/tokenizer/index.js';
import { BRIEF_INPUT_TOKEN_BUDGET } from './constants.js';
import { renderChangeStats, type ChangeStats } from './helpers.js';

/**
 * Input assembly + budgeting for the brief — ring 2, server-side only.
 * `reviewer-core` receives an already-rendered, already-budgeted string; no
 * hunk body ever reaches this file (the input type is `path`/`additions`/
 * `deletions` only, via `ChangeStats`).
 */

export interface BriefInputDocument {
  path: string;
  text: string;
}

export interface BriefInputParts {
  title: string;
  intentText: string;
  blastSummaryLine: string;
  changeStats: ChangeStats;
  /** Grounding set — endpoints the model is shown via the blast summary
   *  (`endpointSet(blast)` at the call site). */
  endpoints: string[];
  /** Project-context documents, in attached order — the END of this array is
   *  dropped first on over-budget (AC-17: "last-attached-first"). */
  documents: BriefInputDocument[];
  issueText: string | null;
  body: string | null;
  /** Deterministic AC-2 fallback, built server-side from the change stats
   *  (T8's third arg). */
  fallbackWhat: string;
}

export type AssembleBriefInputResult = { overBudget: true } | ({ overBudget: false } & BriefInput);

function renderSection(heading: string, body: string): string {
  return `## ${heading}\n${body}`;
}

function render(
  parts: BriefInputParts,
  docs: BriefInputDocument[],
  issueText: string | null,
  body: string | null,
): string {
  const sections: string[] = [
    renderSection('PR title', parts.title),
    renderSection('Intent', parts.intentText),
    renderSection('Blast radius', parts.blastSummaryLine),
    renderSection('Change statistics', renderChangeStats(parts.changeStats)),
  ];
  if (docs.length > 0) {
    sections.push(
      renderSection('Project context', docs.map((d) => `### ${d.path}\n${d.text}`).join('\n\n')),
    );
  }
  if (issueText) sections.push(renderSection('Referenced issue', issueText));
  if (body) sections.push(renderSection('PR description', body));
  return sections.join('\n\n');
}

/**
 * Assemble + budget-check the brief's model input. Required parts (title,
 * intent, blast summary, capped change statistics) are always present.
 * Optional parts (project-context documents, referenced issue text, PR body)
 * are dropped WHOLE, one unit at a time, while over budget: documents from
 * the end of the attached order first, then the issue text, then the PR body
 * (AC-17). Still over budget with everything optional dropped →
 * `{ overBudget: true }` and `messages` is never built downstream (no model
 * call — T17/AC-18).
 *
 * The returned `files`/`endpoints` grounding sets are taken from the SAME
 * assembled data (`changeStats.shown`, the endpoints passed in): grounding
 * can never be checked against something the model was not shown.
 */
export function assembleBriefInput(
  parts: BriefInputParts,
  tokenizer: Tokenizer,
): AssembleBriefInputResult {
  let docs = [...parts.documents];
  let issueText = parts.issueText;
  let body = parts.body;

  for (;;) {
    const rendered = render(parts, docs, issueText, body);
    if (tokenizer.count(rendered) <= BRIEF_INPUT_TOKEN_BUDGET) {
      return {
        overBudget: false,
        rendered,
        files: parts.changeStats.shown.map((f) => f.path),
        endpoints: parts.endpoints,
        title: parts.title,
        fallbackWhat: parts.fallbackWhat,
      };
    }
    if (docs.length > 0) {
      docs = docs.slice(0, -1);
      continue;
    }
    if (issueText != null) {
      issueText = null;
      continue;
    }
    if (body != null) {
      body = null;
      continue;
    }
    return { overBudget: true };
  }
}
