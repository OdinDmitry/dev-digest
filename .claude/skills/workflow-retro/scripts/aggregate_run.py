#!/usr/bin/env python3
"""
aggregate_run.py — turn a session's raw agent transcripts into a compact,
context-safe telemetry table.

Why this exists: a single subagent transcript in this project measured 1.5 MB
across 86 JSONL lines. Reading even one of them into an agent's context to
"see how the run went" costs more than the run being analysed. This script
streams them line by line and prints only aggregates — counts, sums, paths and
names. It never prints file contents, prompt text or model output, so its
output is always safe to read in full.

Stdlib only. Works on Windows and POSIX.

Usage:
  python aggregate_run.py --tasks-dir <dir>/tasks [--transcript <session>.jsonl]
  python aggregate_run.py --auto            # newest tasks/ dir under the temp claude root
  python aggregate_run.py ... --json        # machine-readable instead of the table

Exit codes: 0 ok, 2 nothing found to analyse.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

# Tools whose first string argument is a filesystem path we care about.
PATH_ARG = {"Read": "file_path", "Write": "file_path", "Edit": "file_path",
            "NotebookEdit": "notebook_path"}
SEARCH_TOOLS = {"Grep": "pattern", "Glob": "pattern"}
WRITE_TOOLS = {"Write", "Edit", "NotebookEdit"}

AGENT_ID_RE = re.compile(r"agentId:\s*([A-Za-z0-9_-]+)")
MAX_LIST = 25  # never print an unbounded list into someone's context

# Anthropic list prices, USD per million tokens: (input, output).
# Snapshot taken 2026-08-16 from the claude-api skill's model table. Prices
# change — re-check that table (or platform.claude.com/docs/en/pricing) rather
# than trusting these numbers for anything that matters financially.
PRICES = {
    "claude-fable-5": (10.00, 50.00),
    "claude-mythos-5": (10.00, 50.00),
    "claude-opus-5": (5.00, 25.00),
    "claude-opus-4-8": (5.00, 25.00),
    "claude-opus-4-7": (5.00, 25.00),
    "claude-opus-4-6": (5.00, 25.00),
    "claude-opus-4-5": (5.00, 25.00),
    "claude-sonnet-5": (3.00, 15.00),
    "claude-sonnet-4-6": (3.00, 15.00),
    "claude-sonnet-4-5": (3.00, 15.00),
    "claude-haiku-4-5": (1.00, 5.00),
}
# Fast mode is a different SKU on the models that support it.
FAST_PRICES = {"claude-opus-5": (10.00, 50.00), "claude-opus-4-8": (10.00, 50.00)}
# Sonnet 5 carries introductory pricing through this date.
SONNET_5_INTRO = (2.00, 10.00)
SONNET_5_INTRO_UNTIL = "2026-08-31"
PRICE_SNAPSHOT = "2026-08-16"

CACHE_WRITE_MULT = 1.25  # 5-minute TTL. A 1h-TTL write is 2x — see note below.
CACHE_READ_MULT = 0.10

# The default Windows console codepage mangles the box-drawing and dash
# characters used in the table, which makes the output look like corruption
# rather than data. Force UTF-8 where the runtime allows it.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass


def parse_ts(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def iter_jsonl(path: Path):
    """Yield parsed objects, skipping blank and malformed lines.

    A truncated last line is normal for a transcript whose agent was killed
    mid-write, so a parse failure is not an error worth reporting.
    """
    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue
    except OSError:
        return


def blocks(obj):
    msg = obj.get("message") or {}
    content = msg.get("content")
    return content if isinstance(content, list) else []


def scan_transcript(path: Path) -> dict:
    """Aggregate one transcript. Returns measured facts only."""
    st = {
        "path": str(path),
        "bytes": path.stat().st_size if path.exists() else 0,
        "lines": 0,
        "models": set(),
        "speeds": set(),
        "tokens": Counter(),
        "tools": Counter(),
        "reads": [],          # ordered, may repeat — repeats are a signal
        "writes": [],
        "searches": [],
        "assistant_turns": 0,
        "user_turns": 0,
        "first_ts": None,
        "last_ts": None,
        "session_id": None,
        "agent_id": None,
        "spawned": [],        # Agent tool_use calls seen in this transcript
    }
    for obj in iter_jsonl(path):
        st["lines"] += 1
        st["session_id"] = st["session_id"] or obj.get("sessionId")
        st["agent_id"] = st["agent_id"] or obj.get("agentId")
        ts = parse_ts(obj.get("timestamp"))
        if ts:
            st["first_ts"] = min(st["first_ts"], ts) if st["first_ts"] else ts
            st["last_ts"] = max(st["last_ts"], ts) if st["last_ts"] else ts

        kind = obj.get("type")
        if kind == "user":
            st["user_turns"] += 1
            continue
        if kind != "assistant":
            continue

        st["assistant_turns"] += 1
        msg = obj.get("message") or {}
        if msg.get("model"):
            st["models"].add(msg["model"])
        usage = msg.get("usage") or {}
        if isinstance(usage.get("speed"), str):
            st["speeds"].add(usage["speed"])
        for key, val in usage.items():
            if isinstance(val, int):
                st["tokens"][key] += val

        for blk in blocks(obj):
            if not isinstance(blk, dict) or blk.get("type") != "tool_use":
                continue
            name = blk.get("name") or "?"
            st["tools"][name] += 1
            args = blk.get("input") or {}
            if not isinstance(args, dict):
                continue
            if name in PATH_ARG:
                p = args.get(PATH_ARG[name])
                if isinstance(p, str):
                    (st["writes"] if name in WRITE_TOOLS else st["reads"]).append(norm(p))
            if name in SEARCH_TOOLS:
                pat = args.get(SEARCH_TOOLS[name])
                if isinstance(pat, str):
                    st["searches"].append((name, pat))
            if name == "Agent":
                st["spawned"].append({
                    "subagent_type": args.get("subagent_type") or "general-purpose",
                    "description": args.get("description") or "",
                })
    return st


def norm(p: str) -> str:
    """Normalise a path enough that the same file read by two agents matches."""
    p = p.replace("\\", "/")
    try:
        p = str(Path(p).resolve()).replace("\\", "/")
    except (OSError, ValueError):
        pass
    return p.rstrip("/")


def rel(p: str, root: str | None) -> str:
    if root:
        r = root.replace("\\", "/").rstrip("/") + "/"
        if p.startswith(r):
            return p[len(r):]
    return p


def map_agent_names(main: dict, main_path: Path) -> dict:
    """Map agentId -> {subagent_type, description, order} from the main transcript.

    The Agent tool_use block carries the subagent_type; the agentId only shows
    up in the tool_result that follows it. Pair them positionally, then repair
    the pairing wherever a result explicitly names its agentId.
    """
    launches, ids = [], []
    for obj in iter_jsonl(main_path):
        for blk in blocks(obj):
            if not isinstance(blk, dict):
                continue
            if blk.get("type") == "tool_use" and blk.get("name") == "Agent":
                args = blk.get("input") or {}
                launches.append({
                    "subagent_type": args.get("subagent_type") or "general-purpose",
                    "description": args.get("description") or "",
                    "background": bool(args.get("run_in_background")),
                })
            elif blk.get("type") == "tool_result":
                text = blk.get("content")
                if isinstance(text, list):
                    text = " ".join(c.get("text", "") for c in text
                                    if isinstance(c, dict))
                if isinstance(text, str):
                    m = AGENT_ID_RE.search(text)
                    if m:
                        ids.append(m.group(1))
    out = {}
    for i, agent_id in enumerate(ids):
        meta = launches[i] if i < len(launches) else {}
        out[agent_id] = {**meta, "order": i + 1}
    return out


def fmt_int(n) -> str:
    return f"{n:,}" if isinstance(n, int) else str(n)


DATE_SUFFIX_RE = re.compile(r"-\d{8}$")


def rates(model: str, fast: bool, when) -> tuple[float, float] | None:
    """List price (input, output) per million tokens, or None if unknown."""
    if not model:
        return None
    key = DATE_SUFFIX_RE.sub("", model)
    if fast and key in FAST_PRICES:
        return FAST_PRICES[key]
    if key == "claude-sonnet-5" and when and \
            when.strftime("%Y-%m-%d") <= SONNET_5_INTRO_UNTIL:
        return SONNET_5_INTRO
    return PRICES.get(key)


def cost_usd(st) -> float | None:
    """List-price cost of one agent's raw token sums.

    Returns None when the model is not in the price table, so an unknown model
    reads as "unknown" rather than as free. Cache writes are priced at the
    5-minute-TTL multiplier: the transcript does not record which TTL was
    requested, and 1h writes cost 2x instead of 1.25x, so a workload using 1h
    caching is under-reported here.
    """
    fast = "fast" in st["speeds"]
    priced = [r for m in st["models"] if (r := rates(m, fast, st["first_ts"]))]
    if not priced or len(priced) != len(st["models"]):
        return None
    # One agent normally runs one model; average if it somehow ran several.
    r_in = sum(r[0] for r in priced) / len(priced)
    r_out = sum(r[1] for r in priced) / len(priced)
    t = st["tokens"]
    return (
        t.get("input_tokens", 0) * r_in
        + t.get("cache_creation_input_tokens", 0) * r_in * CACHE_WRITE_MULT
        + t.get("cache_read_input_tokens", 0) * r_in * CACHE_READ_MULT
        + t.get("output_tokens", 0) * r_out
    ) / 1_000_000


def fmt_cost(value) -> str:
    if value is None:
        return "?"
    return f"${value:,.2f}" if value >= 0.01 else f"${value:.4f}"


def duration(st) -> str:
    if not st["first_ts"] or not st["last_ts"]:
        return "—"
    secs = (st["last_ts"] - st["first_ts"]).total_seconds()
    if secs < 90:
        return f"{secs:.0f}s"
    return f"{secs / 60:.1f}m"


def collect(tasks_dir: Path, transcript: Path | None, root: str | None):
    agents = []
    for f in sorted(tasks_dir.glob("*.output")):
        st = scan_transcript(f)
        st["agent_id"] = st["agent_id"] or f.stem
        st["file_stem"] = f.stem
        agents.append(st)

    main = None
    names = {}
    if transcript and transcript.exists():
        main = scan_transcript(transcript)
        names = map_agent_names(main, transcript)

    for st in agents:
        meta = names.get(st["agent_id"]) or names.get(st["file_stem"]) or {}
        st["name"] = meta.get("subagent_type") or "unknown"
        st["description"] = meta.get("description") or ""
        st["order"] = meta.get("order")
    # Agents the main transcript never named still need a stable order.
    unordered = [a for a in agents if not a["order"]]
    used = {a["order"] for a in agents if a["order"]}
    nxt = 1
    for a in sorted(unordered, key=lambda x: x["first_ts"] or datetime.max):
        while nxt in used:
            nxt += 1
        a["order"] = nxt
        used.add(nxt)
    agents.sort(key=lambda a: a["order"])
    return agents, main


def analyse(agents, root):
    """Derive the cross-agent signals. All of these are mechanical."""
    read_by = defaultdict(set)
    wrote_by = defaultdict(list)
    searches = defaultdict(set)
    for a in agents:
        label = f"{a['order']}. {a['name']}"
        for p in set(a["reads"]):
            read_by[p].add(label)
        for p in a["writes"]:
            wrote_by[p].append(label)
        for tool, pat in a["searches"]:
            searches[(tool, pat)].add(label)

    overlap = sorted(((p, sorted(who)) for p, who in read_by.items() if len(who) > 1),
                     key=lambda x: (-len(x[1]), x[0]))
    repeated = sorted(((k, sorted(who)) for k, who in searches.items() if len(who) > 1),
                      key=lambda x: (-len(x[1]), x[0][1]))
    rework = []
    for p, who in wrote_by.items():
        distinct = list(dict.fromkeys(who))
        if len(distinct) > 1:
            rework.append((p, distinct))
    rework.sort(key=lambda x: (-len(x[1]), x[0]))

    # Re-reads inside one agent: the same path opened more than once.
    rereads = []
    for a in agents:
        c = Counter(a["reads"])
        for p, n in c.items():
            if n > 1:
                rereads.append((f"{a['order']}. {a['name']}", p, n))
    rereads.sort(key=lambda x: -x[2])

    anomalies = []
    for a in agents:
        if a["bytes"] == 0:
            try:
                age = datetime.now().timestamp() - Path(a["path"]).stat().st_mtime
                hint = " (touched <2 min ago — it may still be running)" if age < 120 \
                    else ""
            except OSError:
                hint = ""
            anomalies.append(
                f"{a['order']}. {a['name']} — transcript is 0 bytes "
                f"({a['file_stem']}.output){hint}. No turns were recorded, so this "
                f"file cannot tell you what the agent did — it may have died before "
                f"flushing, been killed, or not be a workflow agent at all. An empty "
                f"transcript is NOT evidence that the work did not happen: check the "
                f"deliverables on disk before concluding anything about this agent.")
        elif a["assistant_turns"] and not a["tools"]:
            anomalies.append(
                f"{a['order']}. {a['name']} — {a['assistant_turns']} turns, zero tool "
                f"calls. It answered from context without reading anything.")
        if a["tokens"].get("cache_creation_input_tokens", 0) > \
           a["tokens"].get("cache_read_input_tokens", 0) and a["assistant_turns"] > 2:
            anomalies.append(
                f"{a['order']}. {a['name']} — cache creation "
                f"({fmt_int(a['tokens']['cache_creation_input_tokens'])}) exceeds cache "
                f"reads ({fmt_int(a['tokens'].get('cache_read_input_tokens', 0))}): its "
                f"context was rebuilt rather than reused.")
    return overlap, repeated, rework, rereads, anomalies


def render(agents, main, root, out=sys.stdout):
    p = lambda *a: print(*a, file=out)
    total = Counter()
    for a in agents:
        total.update(a["tokens"])
    if main:
        total.update({f"main_{k}": v for k, v in main["tokens"].items()})

    p("# Run telemetry (measured)\n")
    if main:
        p(f"session: {main['session_id']}")
        p(f"main-agent turns: {main['assistant_turns']} assistant / "
          f"{main['user_turns']} user")
    p(f"subagents: {len(agents)}\n")

    p("## Agents, in launch order\n")
    p("| # | agent | model | turns | dur | input | output | cache create | cache read | cost | tools |")
    p("|---|-------|-------|-------|-----|-------|--------|--------------|------------|------|-------|")
    for a in agents:
        t = a["tokens"]
        model = ", ".join(sorted(a["models"])) or "—"
        tools = ", ".join(f"{k}×{v}" for k, v in a["tools"].most_common()) or "—"
        p(f"| {a['order']} | {a['name']} | {model} | {a['assistant_turns']} | "
          f"{duration(a)} | {fmt_int(t.get('input_tokens', 0))} | "
          f"{fmt_int(t.get('output_tokens', 0))} | "
          f"{fmt_int(t.get('cache_creation_input_tokens', 0))} | "
          f"{fmt_int(t.get('cache_read_input_tokens', 0))} | "
          f"{fmt_cost(cost_usd(a))} | {tools} |")
    p("")
    for a in agents:
        if a["description"]:
            p(f"- {a['order']}. **{a['name']}** — {a['description']}")
    p("")

    p("## Token totals (subagents only, four-way split)\n")
    for k in ("input_tokens", "output_tokens", "cache_creation_input_tokens",
              "cache_read_input_tokens"):
        p(f"- {k}: {fmt_int(total.get(k, 0))}")
    p("\nThese are raw per-message sums from the transcripts. They are NOT the same")
    p("quantity as the `subagent_tokens` figure the Agent tool reports on")
    p("completion — do not present one as the other.\n")

    costs = [cost_usd(a) for a in agents]
    known = [c for c in costs if c is not None]
    unpriced = [a for a, c in zip(agents, costs) if c is None]
    p("## Cost at list price (subagents only)\n")
    p(f"- total: **{fmt_cost(sum(known)) if known else '?'}**"
      + (f" (excludes {len(unpriced)} agent(s) on an unpriced model)" if unpriced else ""))
    for a in unpriced:
        p(f"- {a['order']}. {a['name']} — not priced: model "
          f"{', '.join(sorted(a['models'])) or 'unknown'} is not in the price table")
    p("\nHow this is computed and where it can be wrong — state these alongside the")
    p("number, because a cost figure without them invites the wrong conclusion:\n")
    p(f"- Anthropic **list prices**, snapshot {PRICE_SNAPSHOT}. This is what the same")
    p("  work would cost billed per token — not necessarily what anyone was charged.")
    p("  On a subscription plan there is no per-token bill at all, so read this as a")
    p("  measure of the work's size, not of money that changed hands.")
    p(f"- Cache writes are priced at the {CACHE_WRITE_MULT}× multiplier (5-minute TTL) and")
    p(f"  reads at {CACHE_READ_MULT}×. The transcript does not record which TTL was requested;")
    p("  a 1-hour-TTL write costs 2×, so a workload using 1h caching costs more than")
    p("  this figure says.")
    p("- Only subagents are counted. The main agent's own tokens are not in these")
    p("  transcripts, so the session as a whole cost more than the total above.\n")

    overlap, repeated, rework, rereads, anomalies = analyse(agents, root)

    p("## Files read by more than one agent (duplicated context)\n")
    if not overlap:
        p("none\n")
    else:
        for path, who in overlap[:MAX_LIST]:
            p(f"- `{rel(path, root)}` — {', '.join(who)}")
        if len(overlap) > MAX_LIST:
            p(f"- … {len(overlap) - MAX_LIST} more")
        p("")

    p("## Identical searches run by more than one agent\n")
    if not repeated:
        p("none\n")
    else:
        for (tool, pat), who in repeated[:MAX_LIST]:
            p(f"- {tool} `{pat}` — {', '.join(who)}")
        if len(repeated) > MAX_LIST:
            p(f"- … {len(repeated) - MAX_LIST} more")
        p("")

    p("## Same file written by more than one agent (re-work)\n")
    if not rework:
        p("none\n")
    else:
        for path, who in rework[:MAX_LIST]:
            p(f"- `{rel(path, root)}` — {' → '.join(who)}")
        p("")

    p("## Same file re-read inside one agent\n")
    if not rereads:
        p("none\n")
    else:
        for label, path, n in rereads[:MAX_LIST]:
            p(f"- {label} read `{rel(path, root)}` ×{n}")
        p("")

    p("## Artifacts claimed on disk (verify these against each agent's report)\n")
    for a in agents:
        files = list(dict.fromkeys(a["writes"]))
        if not files:
            p(f"- {a['order']}. {a['name']} — wrote nothing")
            continue
        for f in files[:MAX_LIST]:
            exists = "exists" if Path(f).exists() else "MISSING"
            size = Path(f).stat().st_size if Path(f).exists() else 0
            p(f"- {a['order']}. {a['name']} — `{rel(f, root)}` "
              f"({exists}, {fmt_int(size)} bytes)")
    p("")

    p("## Anomalies\n")
    if not anomalies:
        p("none\n")
    else:
        for line in anomalies:
            p(f"- {line}")
        p("")


def find_tasks_dir() -> Path | None:
    """Newest tasks/ directory under the platform temp claude root."""
    import tempfile
    root = Path(tempfile.gettempdir()) / "claude"
    if not root.exists():
        return None
    candidates = [d for d in root.glob("*/*/tasks") if d.is_dir()]
    if not candidates:
        return None
    return max(candidates, key=lambda d: d.stat().st_mtime)


def find_transcript(session_id: str | None, project_dir: Path | None) -> Path | None:
    base = project_dir or (Path.home() / ".claude" / "projects")
    if not base.exists():
        return None
    if session_id:
        hits = list(base.glob(f"**/{session_id}.jsonl"))
        if hits:
            return hits[0]
    files = list(base.glob("**/*.jsonl"))
    return max(files, key=lambda f: f.stat().st_mtime) if files else None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tasks-dir", type=Path)
    ap.add_argument("--transcript", type=Path,
                    help="main session .jsonl; auto-discovered when omitted")
    ap.add_argument("--project-dir", type=Path,
                    help="~/.claude/projects/<slug>, for auto-discovery")
    ap.add_argument("--repo-root", default=os.getcwd(),
                    help="paths are printed relative to this (default: cwd)")
    ap.add_argument("--auto", action="store_true")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    tasks = args.tasks_dir or (find_tasks_dir() if args.auto else None)
    if not tasks or not tasks.exists():
        print("No tasks directory found. Pass --tasks-dir <scratchpad>/../tasks.",
              file=sys.stderr)
        return 2

    outputs = list(tasks.glob("*.output"))
    if not outputs:
        print(f"No agent transcripts in {tasks} — nothing to analyse.", file=sys.stderr)
        return 2

    probe = scan_transcript(max(outputs, key=lambda f: f.stat().st_size))
    transcript = args.transcript or find_transcript(probe["session_id"], args.project_dir)
    root = norm(str(args.repo_root))

    agents, main_stats = collect(tasks, transcript, root)

    if args.json:
        payload = {
            "session": main_stats["session_id"] if main_stats else None,
            "agents": [{
                "order": a["order"], "name": a["name"], "agent_id": a["agent_id"],
                "models": sorted(a["models"]), "turns": a["assistant_turns"],
                "tokens": dict(a["tokens"]), "tools": dict(a["tools"]),
                "reads": sorted(set(a["reads"])), "writes": list(dict.fromkeys(a["writes"])),
                "bytes": a["bytes"],
            } for a in agents],
        }
        json.dump(payload, sys.stdout, indent=2)
        print()
        return 0

    render(agents, main_stats, root)
    return 0


if __name__ == "__main__":
    sys.exit(main())
