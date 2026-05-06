# /queue-next

**Drain the queue**: process eligible items from `QUEUE.md` one at a time, each producing its own PR, until empty or stop condition.

## Usage
- `/queue-next` — drain mode, cap 10
- `/queue-next 3` — up to 3
- `/queue-next <id>` — single item

## Steps (looped per item)

0. **Defensive branch sync** — `git checkout main && git pull --ff-only origin main`. Reset branch-shift stamp (`rm .git/.claude_session_branch`). Preempts external-process branch shifts.

1. **Read `QUEUE.md`** under `## Active queue`.
2. **Pick top by priority** (P0 > P1 > P2 > P3) and `Status: queued`. If empty, report and stop.
3. **Mark `in-progress`**.
4. **Route:**
   - **Item has `**Issue:**` field** → fetch issue body via `gh issue view <n> --repo Haglerd/homebridge-ratgdo-forceclose`, use the embedded plan; skip planner; go straight to software-engineer.
   - **Item is `needs-human-planning`** → STOP, surface to user.
   - State-machine edit (force-close, obstFromStatus) → planner first
   - HTTP integration change → planner first (cancellation paths matter)
   - Schema sync change → software-engineer + run config-schema-sync skill
   - Logger / characteristic update → software-engineer directly
5. **Pipeline:** software-engineer → code-review → smoke-test (`npm test`) → optional homebridge-deploy skill if user wants Pi-side verification.
6. **PR via /pr** (always `--repo Haglerd/homebridge-ratgdo-forceclose`). If item has `**Issue:**` field, include `Closes #<number>` in PR body.
7. **Update queue**: mark `done <pr-url>`, move to Recently completed.
8. **On success**: loop back to step 0 unless cap reached or hard stop fires.
9. **On hook fire** (AI-attribution / branch-shift / fork-PR / tsc warning): apply auto-recovery (see below), retry. After 3 retries on same hook+item, mark `in-progress (auto-fix exhausted: <hook>)` and **continue to next item** — don't halt the whole batch.

## Recovery by hook type

| Hook | Auto-recovery |
|------|---------------|
| AI-attribution | strip forbidden patterns from commit message, retry |
| Branch-shift | `git checkout main && git pull --ff-only origin main`, reset stamp, retry |
| Fork-PR | rebuild `gh pr create` with `--repo Haglerd/homebridge-ratgdo-forceclose`, retry |
| Post-edit tsc (warns) | invoke software-engineer to fix type errors before next commit |

## Hard stops (halt the drain)

- Cap reached, queue empty
- `needs-human-planning` item → STOP, surface
- Force-close state machine without diagram → STOP, call planner

## Drain summary
```
Queue drain summary (homebridge-ratgdo-forceclose):
- Items processed: N
- PRs opened: <list>
- Stopped at: <reason>
- Queue remaining: <count>
```

## Partial drains are normal

If a hook, branch shift, or failure stops the drain mid-batch, remaining items stay queued. Re-run `/queue-next` to continue.

## Stop conditions

- Queue empty → report.
- Force-close state machine touched without state diagram → STOP, call planner.
- Hook fires → resolve.

## Don't

- Don't propose upstream PRs to `hjdhjd/homebridge-ratgdo`.
- Don't skip `npm test` smoke pass before PR.
- Don't update characteristic value without checking against last reported value (HomeKit duplicate-event noise).
