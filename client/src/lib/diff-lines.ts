import type { Line } from "../components/diff-viewer";

/**
 * Line-level diff between two texts, rendered with the diff viewer's own
 * `Line` shape (`lineRowFor`/`lineSignFor` from `components/diff-viewer` accept
 * it directly — no cast, since `diffLines` only ever emits `add`/`del`/`ctx`,
 * a strict subset of `Line["kind"]`).
 *
 * Classic LCS with backtracking. The server has its own `lineDelta` in
 * `server/src/modules/skills/helpers.ts` that computes only the ADDED/REMOVED
 * counts (no backtracking, so no full matrix) — the two are deliberately
 * duplicated rather than shared, and that duplication is safe: the LCS
 * LENGTH is unique even when the LCS PATH is not, so the two implementations
 * can never disagree on the counts no matter how each ties-break.
 */

export interface DiffLinesResult {
  lines: Line[];
  /** True when the pair was too large to diff exactly — `lines` is empty. */
  truncated: boolean;
}

/** Longest side we'll run the exact DP on. */
export const MAX_DIFF_LINES = 2_000;

/**
 * Cap on (n × m) cells for the backtracking DP. At 1M cells the flat
 * `Int32Array` is 4 MB — acceptable in a browser tab; 5000×5000 would be
 * 100 MB, which is not, hence the hard cap rather than a "probably fine".
 */
export const MAX_DIFF_CELLS = 1_000_000;

function splitLines(text: string): string[] {
  return text === "" ? [] : text.split("\n");
}

export function diffLines(a: string, b: string): DiffLinesResult {
  if (a === b) {
    const lines = splitLines(a).map(
      (text, i): Line => ({ kind: "ctx", text, oldNo: i + 1, newNo: i + 1 }),
    );
    return { lines, truncated: false };
  }

  const aLines = splitLines(a);
  const bLines = splitLines(b);

  if (aLines.length === 0) {
    return {
      lines: bLines.map((text, i): Line => ({ kind: "add", text, newNo: i + 1 })),
      truncated: false,
    };
  }
  if (bLines.length === 0) {
    return {
      lines: aLines.map((text, i): Line => ({ kind: "del", text, oldNo: i + 1 })),
      truncated: false,
    };
  }

  // Strip the common prefix/suffix of identical lines first — a version bump
  // usually touches a handful of lines out of hundreds, so this alone
  // collapses the DP to near-nothing in the common case, and it's what keeps
  // MAX_DIFF_LINES/MAX_DIFF_CELLS meaningful for large-but-similar bodies.
  let prefix = 0;
  const maxPrefix = Math.min(aLines.length, bLines.length);
  while (prefix < maxPrefix && aLines[prefix] === bLines[prefix]) prefix++;

  let suffix = 0;
  const maxSuffix = maxPrefix - prefix;
  while (
    suffix < maxSuffix &&
    aLines[aLines.length - 1 - suffix] === bLines[bLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  const aMid = aLines.slice(prefix, aLines.length - suffix);
  const bMid = bLines.slice(prefix, bLines.length - suffix);

  if (
    aMid.length > MAX_DIFF_LINES ||
    bMid.length > MAX_DIFF_LINES ||
    aMid.length * bMid.length > MAX_DIFF_CELLS
  ) {
    return { lines: [], truncated: true };
  }

  const n = aMid.length;
  const m = bMid.length;
  const width = m + 1;
  const dp = new Int32Array((n + 1) * width);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cur = i * width + j;
      dp[cur] =
        aMid[i - 1] === bMid[j - 1]
          ? dp[(i - 1) * width + (j - 1)]! + 1
          : Math.max(dp[(i - 1) * width + j]!, dp[i * width + (j - 1)]!);
    }
  }

  // Backtrack from (n, m). On a tie, prefer emitting the ADD first (this
  // becomes the FIRST of the pair after the reverse() below), so a pure
  // replacement renders as "del" immediately followed by "add" — matching
  // unified-diff convention and `parsePatch`'s output order.
  type MidOp = { kind: "add" | "del" | "ctx"; text: string };
  const midOps: MidOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (aMid[i - 1] === bMid[j - 1]) {
      midOps.push({ kind: "ctx", text: aMid[i - 1]! });
      i--;
      j--;
    } else if (dp[i * width + (j - 1)]! >= dp[(i - 1) * width + j]!) {
      midOps.push({ kind: "add", text: bMid[j - 1]! });
      j--;
    } else {
      midOps.push({ kind: "del", text: aMid[i - 1]! });
      i--;
    }
  }
  while (i > 0) {
    midOps.push({ kind: "del", text: aMid[i - 1]! });
    i--;
  }
  while (j > 0) {
    midOps.push({ kind: "add", text: bMid[j - 1]! });
    j--;
  }
  midOps.reverse();

  const lines: Line[] = [];
  let oldNo = 1;
  let newNo = 1;
  for (let k = 0; k < prefix; k++) {
    lines.push({ kind: "ctx", text: aLines[k]!, oldNo, newNo });
    oldNo++;
    newNo++;
  }
  for (const op of midOps) {
    if (op.kind === "ctx") {
      lines.push({ kind: "ctx", text: op.text, oldNo, newNo });
      oldNo++;
      newNo++;
    } else if (op.kind === "del") {
      lines.push({ kind: "del", text: op.text, oldNo });
      oldNo++;
    } else {
      lines.push({ kind: "add", text: op.text, newNo });
      newNo++;
    }
  }
  for (let k = 0; k < suffix; k++) {
    const text = aLines[aLines.length - suffix + k]!;
    lines.push({ kind: "ctx", text, oldNo, newNo });
    oldNo++;
    newNo++;
  }

  return { lines, truncated: false };
}
