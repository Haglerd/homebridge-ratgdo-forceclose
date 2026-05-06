#!/usr/bin/env bash
# Branch-shift guard: block git mutating operations when current branch
# differs from the branch we last operated on. Catches mid-flight branch
# switches by other processes (auto-release, scheduled agents, parallel
# sessions) that would otherwise land my commit on the wrong branch.
#
# State file: .git/.claude_session_branch
# - Re-stamped on every successful git mutating op
# - Mismatch at next op → block with override path

input=$(cat)
cmd=$(echo "$input" | grep -oE '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | sed -E 's/.*"command"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')

if ! echo "$cmd" | grep -qE 'git[[:space:]]+(commit|push|cherry-pick|rebase|merge|reset|stash[[:space:]]+(push|pop|drop|clear)|tag[[:space:]]+-)'; then
  exit 0
fi

git_dir=$(git rev-parse --git-dir 2>/dev/null)
if [ -z "$git_dir" ]; then
  exit 0
fi

current_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
state_file="$git_dir/.claude_session_branch"

if [ ! -f "$state_file" ]; then
  echo "$current_branch" > "$state_file"
  exit 0
fi

expected=$(cat "$state_file")
if [ "$expected" != "$current_branch" ]; then
  echo "ERROR: branch shifted mid-session ($expected -> $current_branch)." >&2
  echo "       Re-orient before continuing. To re-baseline:" >&2
  echo "         rm \"$state_file\"" >&2
  exit 2
fi

echo "$current_branch" > "$state_file"
exit 0
