#!/usr/bin/env bash
# Block any git commit whose message contains AI attribution.

input=$(cat)

if echo "$input" | grep -qE 'git[[:space:]]+commit'; then
  if echo "$input" | grep -qiE '(co-authored-by:[[:space:]]*claude|generated[[:space:]]+with[[:space:]]+\[?claude|claude[[:space:]]+code|noreply@anthropic\.com|🤖[[:space:]]*Generated)'; then
    echo "ERROR: commit message contains AI attribution. Strip Co-Authored-By/Generated-with lines and retry." >&2
    exit 2
  fi
fi

exit 0
