# Workflow Retro Ledger

One row per manually-run retro, newest at the bottom. Full reasoning and
evidence live in the chat response at run time — this file exists to compare
runs against each other, not to reproduce a report. `n/a (quick)` means the
run used quick mode and the field needs deep mode to populate.

| date | workflow | mode | agents | outcome | cost (list) | cache read:create | dup files | rework files | top action |
|------|----------|------|--------|---------|--------------|--------------------|-----------|--------------|------------|
| 2026-08-16 | project-context spec→plan | deep | 2 | completed with failures | $7.24 (1 agent unmeasured — empty transcript) | 3.7:1 | n/m* | 0* | pass decisions to `spec-creator` up front instead of resuming it |
| 2026-08-18 | project-context `/impl`→`/pr-self-review` | quick | 9 | completed with failures | n/a (quick) | n/a (quick) | n/a (quick) | n/a (quick) | add a security pass to `/impl` Phase 2 — the one traversal bug was found by `test-writer`, not the review phase |
| 2026-08-18 | context-attach-a11y `/impl` | quick | 5 | completed | n/a (quick) | n/a (quick) | n/a (quick) | n/a (quick) | none required — clean ownership boundaries, 1/2 fix iterations used; run deep mode on the next similar chain to convert the plan/mockup re-read signal into a real preload decision |
| 2026-08-22 | eval-pipeline `implementation-planner`→`/impl` Phase A | deep | 7 | completed with failures | $2.93 (measured for 1 of 7 agents — 5 empty transcripts, 1 unpriced model) | 10.2:1 | 9 | 0 | fix `aggregate_run.py`'s agent→transcript mapping — it labels rows by launch order, not by agentId, and mis-attributed a reviewer's 46 turns to `test-writer` |
