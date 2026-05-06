# /queue-next

Pick the top actionable item from `QUEUE.md`, route it through the agent pipeline, report back when done.

## Steps

1. **Read `QUEUE.md`** under `## Active queue`.
2. **Pick top by priority** (P0 > P1 > P2 > P3) and `Status: queued`.
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

## Stop conditions

- Queue empty → report.
- Force-close state machine touched without state diagram → STOP, call planner.
- Hook fires → resolve.

## Don't

- Don't propose upstream PRs to `hjdhjd/homebridge-ratgdo`.
- Don't skip `npm test` smoke pass before PR.
- Don't update characteristic value without checking against last reported value (HomeKit duplicate-event noise).
