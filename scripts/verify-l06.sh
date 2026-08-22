#!/usr/bin/env bash
#
# Lesson 6 verification gate — runs the fast, deterministic checks that must
# stay green: server + client typecheck/tests, server integration tests
# (Docker/testcontainers), and the static, no-LLM eval quality check.
#
# Deliberately does NOT run ./scripts/e2e.sh and does NOT run any live model
# eval tier (evals/package.json's `eval`, `eval:skills`, `eval:agents`,
# `eval:workflow`, `eval:compare`, `eval:repeat`, `eval:benchmark` — those call
# real models, cost money, and fluctuate between runs). Only `eval:quality` is
# in scope here, since it is a static check with no model calls.
#
#   pnpm verify:l06
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

cd server && pnpm typecheck
cd "$ROOT"

cd server && pnpm test:unit --reporter=dot
cd "$ROOT"

cd server && pnpm test:integration --reporter=dot
cd "$ROOT"

cd client && pnpm typecheck
cd "$ROOT"

cd client && pnpm test:unit --reporter=dot
cd "$ROOT"

cd evals && pnpm eval:quality
cd "$ROOT"
