#!/usr/bin/env bash
#
# PR self-review gate — PreToolUse hook for Claude Code.
#
# Wired in .claude/settings.json on the Bash tool. Reads the hook payload on
# stdin, ignores every command except `gh pr create`, and blocks that one
# unless the current tree has a recorded PASS from the `pr-self-review` skill.
#
#   exit 0 — allow (not a PR command, or a valid pass token exists)
#   exit 2 — block; stderr goes back to the agent as the reason
#
# The token is bound to tree content (HEAD + working diff + untracked), so any
# commit or edit after a pass invalidates it and the review must re-run.
#
# Manual check:
#   echo '{"tool_name":"Bash","tool_input":{"command":"gh pr create"}}' \
#     | bash scripts/pr-self-review-gate.sh; echo "exit=$?"

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE="$ROOT/.claude/.pr-self-review/state.json"

payload="$(cat)"

# Pull .tool_input.command out of the payload. jq when available, otherwise a
# sed fallback so the hook never fails open on a machine without jq.
if command -v jq >/dev/null 2>&1; then
  command_text="$(printf '%s' "$payload" | jq -r '.tool_input.command // ""' 2>/dev/null || echo "")"
else
  command_text="$(printf '%s' "$payload" \
    | tr -d '\n' \
    | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(\([^"\\]\|\\.\)*\)".*/\1/p')"
fi

# Not a PR-opening command → stay out of the way.
#
# Must match `gh` in *command position* — start of the string or after a
# separator — not any occurrence of the substring. Otherwise `echo "gh pr
# create"`, a grep for it, or a doc edit mentioning it all get blocked.
GH_PR_CREATE='(^|[;&|(]|&&|\|\|)[[:space:]]*(command[[:space:]]+)?gh[[:space:]]+([^[:space:]]+[[:space:]]+){0,4}pr[[:space:]]+create([[:space:]]|$)'
[[ "$command_text" =~ $GH_PR_CREATE ]] || exit 0

cd "$ROOT" || exit 0

# Outside a git repo there is nothing to gate.
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | cut -d' ' -f1
  else
    shasum -a 256 | cut -d' ' -f1
  fi
}

head_sha="$(git rev-parse HEAD 2>/dev/null || echo "")"
dirty_hash="$( { git diff HEAD; git status --porcelain; } 2>/dev/null | sha256 )"

block() {
  cat >&2 <<EOF
PR self-review gate: blocked.

$1

Run the \`pr-self-review\` skill on the current changes. It reviews the branch
diff against the skills that govern each changed file and records a pass when
no CRITICAL finding remains. Fix the blockers and re-run — that is what lifts
this gate.

Do not edit .claude/.pr-self-review/state.json to get past this.
EOF
  exit 2
}

[ -f "$STATE" ] || block "No review has been recorded for this branch yet."

state="$(cat "$STATE" 2>/dev/null || echo "")"

json_field() {
  printf '%s' "$state" \
    | tr -d '\n' \
    | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p"
}

state_verdict="$(json_field verdict)"
state_head="$(json_field head)"
state_dirty="$(json_field dirty)"

[ "$state_verdict" = "pass" ] \
  || block "The last review did not pass (verdict: ${state_verdict:-unknown})."

[ "$state_head" = "$head_sha" ] \
  || block "The last review covered commit ${state_head:0:12}; HEAD is now ${head_sha:0:12}."

[ "$state_dirty" = "$dirty_hash" ] \
  || block "The working tree changed since the last review."

exit 0
