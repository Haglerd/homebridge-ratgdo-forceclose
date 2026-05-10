# homebridge-ratgdo-forceclose work queue

Priority-ordered list of pending work items. Top = next to work.

## Format

```
### [P0|P1|P2|P3] <title>
**Status:** queued | in-progress | blocked | done <commit>
**Acceptance:** <testable done state>
**Notes:** <state-machine touched? schema-sync needed? deploy-to-Pi smoke?>
```

- **P0** -- door operation broken / HomeKit unusable
- **P1** -- bug confirmed in Home app
- **P2** -- UX / config improvement
- **P3** -- nice-to-have

---

## Active queue

### [P2] lastObstructed never updated when only garageDoorService is active
**Status:** queued
**Acceptance:** ObstructionDetected fires at most once per real state edge when presentAsGarageDoor=true and enableObstructionSensor=false; no duplicate HomeKit events on every poll cycle
**Source:** codebase-audit 2026-05-10
**Complexity:** S
**Notes:** index.js:542-557. When garageDoorService is present but obstructionService is absent, the garageObstructed branch checks this.lastObstructed !== status.garageObstructed but never assigns this.lastObstructed = status.garageObstructed. The assignment only happens inside the obstructionService branch at line 551. Net effect: ObstructionDetected on the door tile fires on every poll cycle (duplicate event noise). Fix: update lastObstructed inside the garageDoorService block, or before both branches. No state-machine touch; deploy-to-Pi smoke recommended.

### [P2] getStatusJson swallows JSON.parse SyntaxError with misleading log
**Status:** queued
**Acceptance:** Non-JSON responses from ratgdo log a clear message and return null; error is not attributed to a network failure
**Source:** codebase-audit 2026-05-10
**Complexity:** S
**Notes:** index.js:832. JSON.parse(res.body) is inside the same try block as httpRequestWithAuth, so a SyntaxError is caught at line 833 and logged as "Pre-flight status read failed" -- correct outcome but misleading. Also, waitForRatgdoReady (line 912) has its own inconsistent inline try/catch around JSON.parse. Defensive-parsing category; no state-machine touch.

### [P2] resetSwitch crashes silently when switchService is undefined
**Status:** queued
**Acceptance:** resetSwitch() is a no-op when switchService is undefined (presentAsGarageDoor=true); no silent TypeError in the finally path of handleOnSet
**Source:** codebase-audit 2026-05-10
**Complexity:** S
**Notes:** index.js:337-343. resetSwitch() unconditionally calls this.switchService.updateCharacteristic(...) with no null guard. When presentAsGarageDoor=true, switchService is never assigned. TypeError is swallowed by inner try/catch so invisible, but the switch never auto-resets. Compare resetRebootSwitch (line 381) which correctly guards with if (!this.rebootService) return. No state-machine touch.

### [P2] handleTargetDoorStateSet open-path swallows HAP errors silently
**Status:** queued
**Acceptance:** Failed open POST maps to HAPStatus.SERVICE_COMMUNICATION_FAILURE (or re-throws) so HomeKit slider reflects failure rather than silently snapping back
**Source:** codebase-audit 2026-05-10
**Complexity:** S
**Notes:** index.js:294-301. The OPEN branch catches postSetGdoMulti errors, logs them, and returns undefined. HAP interprets void return as success so the slider animates to Open while the door did not move. HAPStatus-translation category; no state-machine touch; no schema-sync.

### [P3] Dead function buildDigestAuthHeader (line 1169)
**Status:** queued
**Acceptance:** buildDigestAuthHeader removed; node --check passes; no call site references it
**Source:** codebase-audit 2026-05-10
**Complexity:** S
**Notes:** index.js:1169-1198. Full 30-line digest auth builder that is never called -- superseded by buildDigestAuthHeaderFromCached (line 1137). Also contains an inline require('crypto') at line 1170. Dead-code category; no state-machine touch; no schema-sync.

### [P3] postSetGdo single-line wrapper never called
**Status:** queued
**Acceptance:** postSetGdo removed (or a real call site discovered and retained); no dangling reference
**Source:** codebase-audit 2026-05-10
**Complexity:** S
**Notes:** index.js:839-841. async postSetGdo(key, value) is a one-liner around postSetGdoMulti with zero call sites -- superseded by postSetGdoMulti and postSetGdoWithRetry. Simplification/dead-code category; no state-machine touch.

### [P3] require('crypto') inside hot-path auth function
**Status:** queued
**Acceptance:** crypto required once at module top alongside http/https/url; buildDigestAuthHeaderFromCached no longer re-requires it on each call
**Source:** codebase-audit 2026-05-10
**Complexity:** S
**Notes:** index.js:1138. const crypto = require('crypto') inside buildDigestAuthHeaderFromCached, called on every authenticated request. Node caches require() so correctness is fine, but inconsistent with module-level requires at lines 3-5. Bundle/dep-hygiene category.

### [P3] package.json missing peerDependencies for homebridge
**Status:** queued
**Acceptance:** package.json declares peerDependencies matching engines.homebridge range; npm warns on version mismatches during install
**Source:** codebase-audit 2026-05-10
**Complexity:** S
**Notes:** package.json has engines.homebridge but no peerDependencies block. Homebridge plugin best practice and the plugin registry expect peerDependencies for compatibility warnings. No code change; no state-machine touch.

### [P3] truncate() is a single-use helper candidate for inlining
**Status:** queued
**Acceptance:** truncate() inlined at its one call site (index.js:1115) or explicitly documented as kept for future reuse
**Source:** codebase-audit 2026-05-10
**Complexity:** S
**Notes:** index.js:1072-1075 (definition), 1115 (sole call site). Four-line function used exactly once. Simplification category; no state-machine touch.

---

## Force-close-touch findings (DO NOT auto-queue)

These findings touch force-close state-machine timing. Human review required before any fix is planned or scheduled.

### [FC-1] forceClose poll loop MAX_WAIT_MS=30000 hardcoded -- ignores closeWaitMs
**File:line:** index.js:642
**Category:** state-machine / magic-number
**Confidence:** high
**Detail:** const MAX_WAIT_MS = 30000 hardcoded inside runForceClose() useForceClose branch. User-configurable closeWaitMs (default 60s, max 180s) applies only to the legacy obstFromStatus branch. A user with a slow door who sets closeWaitMs=60000 still hits the 30s ceiling in useForceClose mode -- FAILED log fires at line 669 even if the door was seconds from closing. Decision needed: wire MAX_WAIT_MS to closeWaitMs, or add a separate forceCloseWaitMs config key? Either path changes close-monitoring loop timing.

---

## Recently completed

_(prune to last 10)_
