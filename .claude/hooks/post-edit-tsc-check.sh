#!/usr/bin/env bash
# Post-edit hook: run `npx tsc --noEmit` after .ts edits.
# Non-blocking — emits warning to stderr but always exits 0 so in-flight
# refactors aren't killed by intermediate type errors. The model sees the
# warning in the next tool result and decides whether to fix immediately.

input=$(cat)
file=$(echo "$input" | grep -oE '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | sed -E 's/.*"file_path"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')

# Only fire for .ts/.tsx files
if ! echo "$file" | grep -qE '\.(ts|tsx)$'; then
  exit 0
fi

# Project must have package.json to attempt tsc
if [ ! -f "$CLAUDE_PROJECT_DIR/package.json" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR" || exit 0

# Run tsc with a 30s timeout. Use incremental cache for speed.
output=$(timeout 30 npx tsc --noEmit --incremental 2>&1)
rc=$?

if [ $rc -ne 0 ] && [ $rc -ne 124 ]; then
  echo "[post-edit tsc] TypeScript errors after editing $file:" >&2
  echo "$output" | grep -E '^[^:]+\.tsx?[[:space:]]*\([0-9]+,[0-9]+\)' | head -15 >&2
  echo "[post-edit tsc] (warning only — not blocking; fix before commit)" >&2
elif [ $rc -eq 124 ]; then
  echo "[post-edit tsc] tsc timed out after 30s — skipped this round" >&2
fi

exit 0
