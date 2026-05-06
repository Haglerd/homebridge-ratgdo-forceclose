#!/usr/bin/env bash
# Block any `gh pr create` that doesn't target Haglerd/homebridge-ratgdo-forceclose.

input=$(cat)
cmd=$(echo "$input" | grep -oE '"command"\s*:\s*"[^"]*"' | sed -E 's/.*"command"\s*:\s*"(.*)"/\1/')

if echo "$cmd" | grep -qE 'gh\s+pr\s+create'; then
  if ! echo "$cmd" | grep -qE -- '--repo\s+Haglerd/homebridge-ratgdo-forceclose'; then
    echo "ERROR: gh pr create must include --repo Haglerd/homebridge-ratgdo-forceclose." >&2
    echo "       Fork-only routing is non-negotiable." >&2
    exit 2
  fi
fi

if echo "$cmd" | grep -qE 'git\s+push'; then
  if echo "$cmd" | grep -qE 'hjdhjd/homebridge-ratgdo'; then
    echo "ERROR: never push to hjdhjd/homebridge-ratgdo (upstream)." >&2
    exit 2
  fi
fi

exit 0
