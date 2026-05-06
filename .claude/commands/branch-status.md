# /branch-status

Snapshot the current branch.

## Steps

1. `git status --short`
2. `git log main..HEAD --oneline`
3. `git diff main...HEAD --stat`
4. Flag risk areas:
   - State-machine edits (force-close, obstFromStatus)
   - HTTP-call additions (Origin/Referer headers? timeouts? cancellation?)
   - config.schema.json or config interface changes (parity check needed)
5. Confirm fork target: `git remote -v` — origin should be `Haglerd/homebridge-ratgdo-forceclose`

## Output format

```
Branch: <name> (X commits ahead of main)
Modified: <files>
Risk areas: <state-machine | http-integration | schema-sync | none>
Fork target: <OK | WRONG>
Next: <commit | push | PR>
```
