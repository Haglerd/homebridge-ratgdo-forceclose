# /pr

Create a pull request for the current branch, **always against `Haglerd/homebridge-ratgdo-forceclose`** — never upstream.

## Steps

1. `git status --short` + `git log main..HEAD --oneline`
2. Push if needed: `git push -u origin HEAD`
3. Build PR title + body from commits
4. Create with explicit fork target:
   ```
   gh pr create --repo Haglerd/homebridge-ratgdo-forceclose --title "..." --body "..."
   ```

## Non-negotiable

- `--repo Haglerd/homebridge-ratgdo-forceclose` is mandatory. Pre-tool-use hook blocks calls without it.
- No AI attribution.
- For Homebridge plugin changes, body MUST include:
  - **HomeKit characteristic impact**: any added/changed traits?
  - **config.schema.json sync**: confirmed TS interface matches schema?
  - **Smoke test**: `npm test` result, deploy-to-Pi verification status
  - **Cancellation review**: any new pending operation has an abort path?
