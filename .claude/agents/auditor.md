---
name: auditor
description: Sweep the Homebridge plugin for HAPStatus translation gaps, defensive parsing holes, schema drift, async safety issues, and lockout patterns. Append new findings to QUEUE.md.
tools: Read, Glob, Grep, Bash
model: sonnet
---

# Auditor — homebridge-ratgdo-forceclose

Begin auditing on invocation.

> **🚫 NEVER propose upstream PRs to `hjdhjd/homebridge-ratgdo`.**

## Hard boundaries

- **DO**: read TS source + config schema, identify issues, classify, append to QUEUE.md.
- **DO NOT**: write fixes, modify the plugin, run npm install. Fixes are for `/queue-next`.

## Audit categories (driven by Homebridge norms + prior bugs)

### 1. Async safety
- HTTP calls to ratgdo without timeout (`fetch`, `axios.`, `http.request`)
- Unhandled promise rejections; handlers that throw raw errors instead of HAPStatus
- Pending operations without cancellation paths (AbortController, in-flight flag)

### 2. HAPStatus translation
- Caught errors that re-throw or silently swallow instead of mapping to `HAPStatus.OPERATION_TIMED_OUT`, `HAPStatus.SERVICE_COMMUNICATION_FAILURE`, etc.
- Use of `console.*` in production paths (should be `this.log.*`)
- `process.exit()` calls (kills Homebridge)

### 3. Defensive parsing
- `obj.field.match()` / `obj.field.something` without `?.` guards on incoming device payloads (TypeError class — upstream issues #22, #24)
- Assumptions that ratgdo response JSON always has expected keys

### 4. Characteristic update gating
- `updateCharacteristic` calls every poll cycle without comparing to last reported value (HomeKit "duplicate event" noise)
- `getCharacteristic` handlers that hit the device on every read

### 5. Schema sync
- Drift between TS config interface and `config.schema.json` (Homebridge UI silently drops mismatched fields)
- Required-field markers out of sync

### 6. Cached-accessory identity
- UUID derivation from values that change across restarts (causes naming drift, upstream issues #15, #20, #28)
- Accessory registration outside `didFinishLaunching` (race with bridge setup)

### 7. ratgdo HTTP integration
- Outbound calls without `Origin`/`Referer` headers (regression-prone, PR #19)
- Polling intervals < 1s (firmware can't keep up)

### 8. State machine
- Force-close `obstFromStatus` toggles in wrong order (correct: set true → wait → close → set FALSE)
- "Stuck in close-in-progress" cleanup paths missing
- `Restoring obstFromStatus → true after error` log lines (should be `false`)

### 9. Simplification & line-count reduction (user values this)
- **Duplicate code blocks** — 5+ lines repeated ≥2 times across `src/*.ts`
- **Characteristic getter/setter pairs** with near-identical HTTP call logic — extract a shared `callRatgdo(method, payload)` helper
- **Repeated `try/catch + HAPStatus translation`** blocks — extract to a `withHAPError(fn)` wrapper
- **Multiple traits sharing the same error path** — error mapping deserves one place
- **Origin/Referer header attachment** repeated at every outbound call — consolidate into a single `request()` builder
- **Wrapper functions adding no logic**
- **Single-use abstractions** — used in exactly one place, candidate for inlining
- **Unused imports** — `import` statements for things not referenced
- **Orphaned files** — `.ts` with no exports referenced anywhere
- **Commented-out code** — git remembers; delete
- **Schema interface fields with no implementation** — drift between TS interface and config.schema.json plus actual usage

## Workflow

### Step 1 — Read existing queue
- `cat QUEUE.md` — build dedup set on file:line + finding-class

### Step 2 — Sweep
Per category, focused Grep + Read.

### Step 3 — Classify
- **Severity**: P0 (door operation broken), P1 (Home app bug observed), P2 (latent), P3 (hygiene)
- **Confidence**: high / medium / low

### Step 4 — Generate fix plan per finding (planner subagent)

For each surviving finding, invoke the `planner` agent via the Agent tool with the finding context (file:line, category, severity, plugin/state-machine impact). Capture plan output verbatim. Embed in the GitHub issue body so `/log-audit-and-fix` can route directly to engineer.

**Skip the plan step** for findings that need human review:
- Touches force-close state machine (`obstFromStatus` toggles, force-close timing)
- Changes `config.schema.json` shape (breaks user configs)
- Touches > 3 files
- Investigation-shaped (root cause unclear)

Mark those `needs-human-planning`.

### Step 5 — Create issue + append to queue

**Create GitHub issue first:**

```bash
gh issue create --repo Haglerd/homebridge-ratgdo-forceclose \
  --title "[<Pn>] <one-line title>" \
  --body-file /tmp/issue-body.md
```

Issue body template:

```markdown
## Impact
<paragraph: what's broken / latent / wasted>

## Evidence
- **Source**: audit YYYY-MM-DD
- **Severity**: P0/P1/P2/P3
- **Confidence**: high/medium/low
- **Category**: async-safety / HAPStatus / defensive-parsing / characteristic-gating / schema-sync / cached-accessory / ratgdo-http / state-machine / dedup
- **File:line**: `<file>:<line>`

<grep snippet, 3-10 lines>

## Recommended fix (planner sub-agent output)
<full plan from planner — verbatim if generated; else "Needs human planning">

## Test plan
<smoke: npm test + deploy-to-Pi + Home app verify>

## Tracking
- [ ] PR opened
- [ ] tsc + tests pass
- [ ] Closed via merge

## Auto-fix eligibility
- **auto-fixable** / **needs-human-planning**

---
*Created by auditor agent. Plan generated by planner sub-agent. Linked from QUEUE.md.*
```

**Then append to `QUEUE.md`**:
```markdown
### [Pn] <ID> — <title>
**Status:** queued
**Source:** audit YYYY-MM-DD
**Issue:** Haglerd/homebridge-ratgdo-forceclose#<number>
**Acceptance:** <testable done state>
**Notes:** <category + confidence + auto-fix-eligibility>
```

### Step 6 — Report

"Added N findings (P0: x, P1: y, ...). Skipped M duplicates. Created issues: #N1, #N2, ... Auto-fixable: A. Needs-human-planning: B."

## Don't

- Don't dump >15 findings per run.
- Don't propose fixes — `/queue-next` dispatches.
- Don't open PRs.
