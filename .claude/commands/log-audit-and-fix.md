# /log-audit-and-fix

Combined log audit + autonomous fix pipeline. Used by the scheduled task for unattended monitoring.

## Pipeline

1. Invoke `log-auditor` agent → pulls Pi journalctl since checkpoint, appends new findings to QUEUE.md
2. If new findings count > 0, evaluate top eligible item against safety rails (below)
3. If eligible: fetch the linked issue's plan (or invoke planner if no plan / `needs-human-planning` flag — planner ALWAYS produces a plan), route to `software-engineer` → `code-review` → `npm test` → `/pr` (with `Closes #<issue-number>`) → **agent merges after CI green**: `gh pr checks <#> --watch` then `gh pr merge <#> --squash --delete-branch`.
4. If no eligible item, report and exit.

## Safety rails — auto-fix eligibility

A finding can be picked for auto-fix ONLY IF all of these are true:

- **Severity** is P0 OR P1
- **Status** is `queued`
- **Source** is `log-audit`
- **NOT** touching force-close state machine (`obstFromStatus` toggles, force-close timing) — those require planner-first
- **NOT** changing config.schema.json shape (breaks user configs)
- **NOT** touching > 3 files
- **Recurrence count >= 2** OR **severity P0**

Sort by priority (P0 first, then P1) and earliest recurrence; auto-fix up to **5 items per run**. Each gets its own commit + PR. Branch-shift guard fires between items — stops the batch if branch shifted mid-run.

## Recovery from hook fires (autonomy: fix the fix, don't abort)

| Hook | Auto-recovery |
|------|---------------|
| AI-attribution | strip forbidden patterns from commit message, retry |
| Branch-shift | `git checkout main && git pull --ff-only origin main`, reset stamp, retry |
| Fork-PR | rebuild `gh pr create` with `--repo Haglerd/homebridge-ratgdo-forceclose`, retry |
| `npx tsc --noEmit` fails | invoke software-engineer to fix the type errors, retry tsc |
| `npm test` fails | invoke software-engineer to fix the failing test (or the production code if test is correct and code is wrong), retry test |

3-retry budget per hook+item. After exhaustion, mark `in-progress (auto-fix exhausted)` and continue to next item.

## Hard stops (last resort)

- Cap reached (5/run)
- Queue empty
- 3 planner-revision iterations on same item didn't converge
- 3 engineer+test iterations didn't pass
- 3 hook auto-recovery attempts failed on same hook+item

Each halt files a comment on the linked issue with everything tried.

## After auto-fix

- PR opened against `Haglerd/homebridge-ratgdo-forceclose` main with description (log evidence + plan summary + smoke-test result)
- **Agent waits for CI then merges** (`gh pr checks --watch` then `gh pr merge --squash --delete-branch`). If CI red, leaves open + comments.
- QUEUE.md item marked `done <pr-url>`, moved to "Recently completed"
- Checkpoint updated

## Don't
- Don't run > 5 fixes per invocation (current cap; adjust here if needed).
- Don't auto-pick force-close state-machine items.
- Don't run /audit automatically.
