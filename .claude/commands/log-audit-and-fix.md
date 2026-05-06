# /log-audit-and-fix

Combined log audit + autonomous fix pipeline. Used by the scheduled task for unattended monitoring.

## Pipeline

1. Invoke `log-auditor` agent → pulls Pi journalctl since checkpoint, appends new findings to QUEUE.md
2. If new findings count > 0, evaluate top eligible item against safety rails (below)
3. If eligible, fetch the linked issue's plan (generated at audit time), skip planner, route directly to `software-engineer` → `code-review` → npm test → `/pr` (with `Closes #<issue-number>`)
4. If no eligible item, report and exit

## Safety rails — auto-fix eligibility

A finding can be picked for auto-fix ONLY IF all of these are true:

- **Severity** is P0 OR P1
- **Status** is `queued`
- **Source** is `log-audit`
- **NOT** touching force-close state machine (`obstFromStatus` toggles, force-close timing) — those require planner-first
- **Has linked issue with embedded plan** (issue body has "Recommended fix (planner sub-agent output)" with actual content)
- **Auto-fix eligibility marker** in issue body says `auto-fixable` (NOT `needs-human-planning`)
- **NOT** changing config.schema.json shape (breaks user configs)
- **NOT** touching > 3 files
- **Recurrence count >= 2** OR **severity P0**

Sort by priority (P0 first, then P1) and earliest recurrence; auto-fix up to **5 items per run**. Each gets its own commit + PR. Branch-shift guard fires between items — stops the batch if branch shifted mid-run.

## Hard stops

- Branch-guard hook flags branch shift → abort
- Fork-PR hook would block → abort
- AI-attribution hook would block → abort
- `npx tsc --noEmit` fails after the engineer's edit → leave WIP, mark item `in-progress (build failed)`, exit
- `npm test` fails → leave WIP, mark item `in-progress (test failed)`, exit

## After auto-fix

- PR opened against `Haglerd/homebridge-ratgdo-forceclose` main with description (log evidence + plan summary + smoke-test result)
- QUEUE.md item marked `done <pr-url>`, moved to "Recently completed"
- Checkpoint updated
- User reviews PR, merges or closes

## Don't

- Don't merge the PR. PR is the review gate.
- Don't run > 5 fixes per invocation (current cap; adjust here if needed).
- Don't auto-pick force-close state-machine items.
- Don't run /audit automatically.
