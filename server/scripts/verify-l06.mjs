/**
 * `pnpm verify:l06` — AC-57's runner: typecheck both packages, run the
 * deterministic eval-scorer unit tests, the suite-run integration test
 * (needs Docker), the client eval-surface smoke tests, and a static purity
 * check on the pure scorer module.
 *
 * Each step is spawned with an explicit `cwd` — never a shell `&&`/`cd` — so
 * this behaves identically under PowerShell, cmd and bash (constraint 16).
 * Fails fast on the first non-zero exit.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_DIR = resolve(SERVER_DIR, "..", "client");

const EVAL_SCORER_UNIT_TESTS = [
  "test/eval-scoring.test.ts",
  "test/eval-helpers.test.ts",
  "test/eval-metrics.test.ts",
  "test/eval-compare.test.ts",
  "test/eval-contracts.test.ts",
];

const CLIENT_EVAL_SURFACE_PATHS = [
  "src/app/evals",
  "src/components/eval-case-dialog",
  "src/app/agents",
];

// scoring.ts must stay a pure, model-free scorer (`onion-architecture` ring
// 2) — no LLM SDK, no reviewer-core, no adapter/container wiring.
const FORBIDDEN_IMPORT_NAMES = [
  "openai",
  "@anthropic-ai/sdk",
  "reviewer-core",
  "adapters/llm",
  "LLMProvider",
  "container",
];

let step = 0;
const totalSteps = 6;

/** Runs one step to completion; exits the whole process on a non-zero code. */
function run(label, cmd, args, cwd) {
  step += 1;
  console.log(`\n> [verify:l06] ${step}/${totalSteps} ${label}`);
  console.log(`  $ ${cmd} ${args.join(" ")}  (cwd: ${cwd})`);
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: true });
  if (result.error) {
    console.error(`\n[verify:l06] FAILED to spawn: ${label}\n${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`\n[verify:l06] FAILED: ${label} (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

/**
 * AC-57's static purity check. Scans only lines matching `/^\s*import\b/` —
 * NOT the raw file — so a doc comment explaining what scoring.ts deliberately
 * avoids (which necessarily names the same forbidden strings) can't trip the
 * guard on its own prose (`server/insights.md` 2026-08-07).
 */
function checkScoringPurity() {
  step += 1;
  console.log(`\n> [verify:l06] ${step}/${totalSteps} static purity check: modules/evals/scoring.ts`);
  const path = resolve(SERVER_DIR, "src/modules/evals/scoring.ts");
  const text = readFileSync(path, "utf8");
  const importLines = text.split(/\r?\n/).filter((line) => /^\s*import\b/.test(line));
  const offenders = importLines.filter((line) =>
    FORBIDDEN_IMPORT_NAMES.some((name) => line.includes(name)),
  );
  if (offenders.length > 0) {
    console.error("\n[verify:l06] FAILED: forbidden import found in scoring.ts:");
    for (const line of offenders) console.error(`  ${line.trim()}`);
    process.exit(1);
  }
}

run("server typecheck", "pnpm", ["typecheck"], SERVER_DIR);
run("client typecheck", "pnpm", ["typecheck"], CLIENT_DIR);
run(
  "server: deterministic scorer unit tests",
  "pnpm",
  ["exec", "vitest", "run", "--reporter=dot", ...EVAL_SCORER_UNIT_TESTS],
  SERVER_DIR,
);
run(
  "server: suite-run integration test (requires Docker)",
  "pnpm",
  ["exec", "vitest", "run", "--reporter=dot", "test/eval-runs.it.test.ts"],
  SERVER_DIR,
);
run(
  "client: eval-surface smoke tests",
  "pnpm",
  ["exec", "vitest", "run", "--reporter=dot", ...CLIENT_EVAL_SURFACE_PATHS],
  CLIENT_DIR,
);
checkScoringPurity();

console.log("\n[verify:l06] all steps passed.");
