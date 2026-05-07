# /codebase-audit

Weekly static-analysis sweep over the homebridge plugin source for refactoring opportunities. **Read-only audit + queue items only. NEVER auto-fixes — refactor PRs require human review.**

Different from `/log-audit-and-fix` (runtime issues from Pi journalctl, daily, executes fixes). This is narrow, scheduled, file-only.

## Pipeline

1. Invoke `auditor` agent (read-only) with scope: `src/*.ts`, `package.json`, `config.schema.json`, `tsconfig.json`. **Skip:** `node_modules/`, `dist/`, `build/`, `coverage/`.

2. **Persist auditor changes to git BEFORE evaluating any follow-up.** If `git status --short QUEUE.md` shows modifications, branch (`audit/codebase-audit-<YYYY-MM-DD>-findings`), commit, push, open a PR via `/pr`, squash-merge after CI green. Same anti-loss pattern as `/log-audit-and-fix`.

3. **Dedupe against existing queue items** by title + acceptance fingerprint.

4. **File new findings as queue items only.** No source code edits. No auto-fixes. Each finding: title, description, source `codebase-audit <date>`, suggested priority (default P3), complexity (S/M/L).

## Scope of findings the auditor looks for

| Category | Examples |
|---|---|
| Dead code | Unused exports, unused TS types, unused config schema keys |
| Duplication | Multiple impls of the same characteristic mapping; copy-pasted try/catch |
| Oversized files / functions | Per-file LoC budget exceeded; >N-line accessory handlers |
| Architectural drift | New code using a different pattern than the surrounding accessory class |
| Magic numbers / hardcoded paths | Raw timeouts, hardcoded URLs, ms-literals not in named consts |
| Type safety | `any` usage, missing return types, unsafe assertions |
| Force-close state-machine hazards | Any new caller of `obstFromStatus`/force-close timing without state-diagram review |
| Bundle-size / dependency hygiene | New deps that bloat the npm package; unused deps |

## Safety rails (binding)

- **NEVER auto-fix.** Findings only.
- **NEVER touch force-close state machine** even in finding-only mode — flag as `force-close-touch` and surface; do not include in regular queue items.
- **No `npm publish` triggered from this command.** Pure read.
- **Don't run more than once per 7 days.**
- **Cap: 10 findings per run.**

## Schedule (suggested)

Weekly Sunday 03:30 CT (after the ratgdo32 codebase-audit). Local Windows Task Scheduler. Cloud-routine eligible (sandbox can read source via `gh api repos/.../contents/...`).

## Hard stops

- Cap reached (10/run)
- No new findings (queue up-to-date)
- 3 hook auto-recovery attempts failed

## Don't

- Don't auto-fix from this command.
- Don't bump `package.json` version or trigger `publish.yml`.
- Don't file duplicates of existing queue items.
- Don't include force-close state-machine findings in regular flow.
