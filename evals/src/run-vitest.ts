/**
 * Run one child `vitest` quietly, with a live spinner + elapsed seconds so a long model run
 * visibly makes progress instead of hanging the terminal in silence. Full per-run trace is
 * suppressed (EVAL_QUIET) and captured; the caller prints the outcome line once the run ends.
 * Falls back to a single static line when stdout is not a TTY (CI logs).
 */

import { execFileSync, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DIM, RESET } from "./ansi.js";

const EVALS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// On Windows `pnpm` is a .cmd shim: spawning the bare name fails with ENOENT, and since Node
// 18.20 spawning the .cmd directly is refused too (CVE-2024-27980) — so eval:repeat / :delta /
// :benchmark all died instantly with `spawn pnpm ENOENT` and nothing ever ran. Going through the
// shell resolves the shim; because shell mode passes one command STRING, any argument containing
// whitespace (a `-t "some test name"` pattern) has to be quoted here rather than by Node.
const USE_SHELL = process.platform === "win32";

/**
 * Shape a `pnpm …` call for the platform: an (command, args) pair on POSIX, and a single
 * pre-quoted command STRING under shell mode — Node warns (DEP0190) that with `shell: true` it
 * concatenates an args array without escaping, so a `-t "some test name"` pattern would split.
 */
function pnpmInvocation(args: string[]): [string, string[]] {
  if (!USE_SHELL) return ["pnpm", args];
  const quoted = ["pnpm", ...args].map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a));
  return [quoted.join(" "), []];
}

/** How many test cases the pattern matches, via `vitest list` (no model calls). null on error. */
export function countTests(vitestArgs: string[]): number | null {
  try {
    const [cmd, args] = pnpmInvocation(["exec", "vitest", "list", ...vitestArgs]);
    const out = execFileSync(cmd, args, {
      cwd: EVALS_DIR,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      shell: USE_SHELL,
    });
    const n = out.split("\n").filter((l) => l.includes(" > ")).length;
    return n || null;
  } catch {
    return null;
  }
}

/** Run vitest once; resolves with the child's combined stdout+stderr (for crash diagnosis). */
export function runVitestOnce(label: string, vitestArgs: string[], extraEnv: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve) => {
    const start = Date.now();
    let out = "";
    const [cmd, args] = pnpmInvocation(["exec", "vitest", "run", "--reporter=dot", ...vitestArgs]);
    const child = spawn(cmd, args, {
      cwd: EVALS_DIR,
      env: { ...process.env, EVAL_QUIET: "1", ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
      shell: USE_SHELL,
    });
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));

    let timer: ReturnType<typeof setInterval> | undefined;
    if (process.stdout.isTTY) {
      let f = 0;
      const tick = () => {
        const secs = Math.round((Date.now() - start) / 1000);
        process.stdout.write(`\r  ${label}  ${FRAMES[(f = (f + 1) % FRAMES.length)]} running… ${DIM}${secs}s${RESET}   `);
      };
      tick();
      timer = setInterval(tick, 120);
    } else {
      process.stdout.write(`  ${label} running…\n`);
    }

    child.on("close", () => {
      if (timer) {
        clearInterval(timer);
        process.stdout.write("\r\x1b[K"); // clear the spinner line; caller prints the result
      }
      resolve(out);
    });
  });
}
