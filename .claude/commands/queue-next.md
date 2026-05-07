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
   - **Item has `**Issue:**` field with embedded plan** → fetch issue body via `gh issue view <n> --repo Haglerd/homebridge-ratgdo-forceclose`, use embedded plan, go to software-engineer.
   - **Item is `needs-human-planning`** → invoke planner; planner ALWAYS produces a plan (picks default-with-rationale on ambiguity), proceed to engineer. PR is the user's review gate.
   - State-machine edit (force-close, obstFromStatus) → planner first
   - HTTP integration change → planner first (cancellation paths matter)
   - Schema sync change → software-engineer + run config-schema-sync skill
   - Logger / characteristic update → software-engineer directly
5. **Pipeline:** software-engineer → code-review → smoke-test (`npm test`) → optional homebridge-deploy skill if user wants Pi-side verification.
6. **PR via /pr** (always `--repo Haglerd/homebridge-ratgdo-forceclose`). If item has `**Issue:**` field, include `Closes #<number>` in PR body.
7. **Wait for CI + merge** — agent owns the merge:
   - `gh pr checks <#> --repo Haglerd/homebridge-ratgdo-forceclose --watch`
   - If green → `gh pr merge <#> --repo Haglerd/homebridge-ratgdo-forceclose --squash --delete-branch`
   - If red → leave open, surface failures, continue to next item
8. **Update queue**: mark `done <pr-url>`, move to Recently completed.
8a. **Auto-unblock dependent items.** Scan QUEUE.md for items whose `**Status:**` line contains `blocked` AND whose `**Notes:**` / `**Pre-req:**` text references the just-completed item's id. Flip those items from `blocked` back to `queued` (preserve other status modifiers like `needs-human-planning`). Commit + push the flip together with the `done` mark. **Mandatory** — without it, dependent items stay blocked indefinitely.
9. **On success**: loop back to step 0 unless cap reached or hard stop fires.
10. **On code-review architectural problem**: re-invoke planner with code-review findings as context. Loop up to 3 planner-revision iterations.
11. **On unit-test failure**: engineer fixes → code-review → retest. Loop up to 3 iterations.
12. **On hook fire**: apply auto-recovery, retry. After 3 retries on same hook+item, halt + comment on issue with full context.

## Recovery by hook type

| Hook | Auto-recovery |
|------|---------------|
| AI-attribution | strip forbidden patterns from commit message, retry |
| Branch-shift | `git checkout main && git pull --ff-only origin main`, reset stamp, retry |
| Fork-PR | rebuild `gh pr create` with `--repo Haglerd/homebridge-ratgdo-forceclose`, retry |
| Post-edit tsc (warns) | invoke software-engineer to fix type errors before next commit |

## Hard stops (last-resort halts only)

This list is **EXHAUSTIVE.** "Context is getting heavy", "checkpoint here", "let me confirm with the user" are NOT halt reasons — they are autonomy violations. Finish the current item and continue until one of the listed conditions actually fires.

- Cap reached, queue empty
- 3 planner-revision iterations on same item didn't converge
- 3 engineer+test iterations didn't pass
- 3 hook auto-recovery attempts in a row failed on same hook+item

Even at halt: file a comment on the linked issue summarizing every attempt (plans considered, code-review feedback per attempt, test failures). Halt is a hand-off with full context, not an early bail.

## End-of-batch release: tag + npm publish

After the drain finishes, if ANY merged PR in this batch touched plugin code (`src/*.ts`, `package.json` deps, `config.schema.json`), cut a release:

1. On `main`, bump `package.json` patch version: `npm version patch --no-git-tag-version` (just edits package.json + package-lock.json without committing)
2. Commit: `git add package.json package-lock.json && git commit -m "Release v<new-version>"`
3. Tag: `git tag v<new-version>`
4. Push: `git push origin main && git push origin v<new-version>`
5. `publish.yml` fires on the tag push → `npm publish --provenance`

Skip the bump if only doc / .claude / test-only files changed this batch.

This runs ONCE per drain (after all eligible items shipped), not per-PR.

## Drain summary
```
Queue drain summary (homebridge-ratgdo-forceclose):
- Items processed: N
- PRs opened: <list>
- Released: v<new-version> on npm (if applicable)
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
