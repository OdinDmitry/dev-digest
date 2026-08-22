# Development Plan: Eval content-trigger scoring

Spec: docs/specs/cross/SPEC-03-eval-pipeline.md (amended AC-11..14, AC-16, AC-20, AC-46..52)
Date: 2026-08-22
Execution mode: single implementer

Follow-on to Phases A–C (`docs/plans/2026-08-22-eval-pipeline-*.md`). Does not
rewrite those plans; this file owns the scoring-model change only.

## Goal

Replace zone-overlap pass/fail with content-trigger polarity (positive: ≥1
grounded finding; negative: 0), redefine precision/subtext accordingly, and make
eval invocation content-only (no project-context resolution), aligned with the
harness `evals/` quality-tier fixture model under the product ban on LLM judges.

## Out of scope

- Porting `llmJudge` / practices into product scoring.
- Replacing unified diff with bare code fences.
- Recomputing metrics on historical suite runs.
- Widening seed diffs (hunk / ±N lines).

## Tasks

- [ ] T1 Amend SPEC-03 + `docs/tasks/eval-pipeline.md` §4.4–4.5/4.8 — owner: `implementer` → AC-12..16, AC-20, AC-11, AC-46..50
- [ ] T2 Rewrite `server/src/modules/evals/scoring.ts` `scoreCase` / CaseScore docs — owner: `implementer` → AC-12, AC-13, AC-14, AC-16, AC-20
- [ ] T3 Force empty context in `resolveCaseContext`; `repoId: null` on from-finding create; `resolves_context: false` — owner: `implementer` → AC-11, AC-46, AC-49, AC-50
- [ ] T4 Update `server/test/eval-scoring.test.ts` (+ metrics if needed) — owner: `implementer` → AC-12..20
- [ ] T5 Client copy / forbidden-zones provenance note if needed — owner: `implementer` → AC-10, AC-20, AC-50

## Traceability

| AC | Task | Test |
|----|------|------|
| AC-12 | T2 | eval-scoring unit |
| AC-13 | T2 | eval-scoring unit |
| AC-14 | T2 | eval-scoring unit |
| AC-16 | T2 | eval-scoring unit |
| AC-20 | T2 | eval-scoring unit |
| AC-11 / AC-49 | T3 | existing runner/context tests or scoring callers |
| AC-46 / AC-50 | T3 | case create path / DTO |

## Verification

**Fast loop:** `cd server && pnpm test:unit --reporter=dot` (scoring + metrics).

**Full:** unchanged IT suite; historical run metrics not recomputed.
