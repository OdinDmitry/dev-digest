# e2e/ — agent map

`@devdigest/e2e` — deterministic UI flows for the web app driven by
**agent-browser** (native Rust+CDP CLI). No Playwright, no LLM, no API key.
Full picture: [README.md](README.md).

## Commands
`./scripts/e2e.sh` (hermetic — isolated Postgres :5433/API :3101/web :3100,
recommended) · `cd e2e && npm test` (against your own running dev stack —
only safe with a freshly-seeded DB, see README precondition)

## Where things live
- `specs/NN-name.flow.json` — one flow = ordered list of agent-browser
  commands, run by `run.ts` against one shared browser session
- `lib/assert.ts` — flow assertion helpers
- `agent-browser.json` — agent-browser CLI config

## Further reading (load only if relevant to the task)
- [docs/](docs/) — deep dives per topic
- [feature-specs/](feature-specs/) — design specs for planned/in-progress
  features (**not** `specs/` — that name is taken by the flow JSON files above)
- [insights.md](insights.md) — decisions & gotchas log

## Non-default conventions
- Locators are deterministic only (`--url`, `--text`, `find role|text|label`)
  — never the AI `chat` command, so runs stay stable and key-free.
- Flows target **read-only seeded data** (`acme/payments-api`, PR #482) so no
  flow triggers a model call.

## Gotchas
- Flow `02` assumes the seeded repo is the *only* repo (follows the home
  redirect to the first one) — your normal dev DB usually has more, which
  breaks flows 02/04/05. Use the hermetic runner, not your dev stack.
- **Never `docker compose down -v`** to reset — it deletes the
  `devdigest_pgdata` volume along with every real imported repo/review.
- Failure screenshots land in `e2e/test-results/` (git-ignored).
