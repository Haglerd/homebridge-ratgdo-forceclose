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

### [P1] Smoke test engines.node regex misses ^24 -- npm test fails on Node 24
**Status:** queued
**Acceptance:** `npm test` exits 0 on Node 24 (Pi target); assertion message still covers all declared LTS lines
**Source:** codebase-audit 2026-05-17
**Complexity:** S
**Notes:** tests/smoke.test.js:23. `assert.match(pkg.engines.node, /\^(18|20|22)/, ...)` does not match the `^24.0.0` token that was added to package.json engines.node in v1.4.1. Any `npm test` run on Node 24 (the Pi's runtime per CLAUDE.md) exits non-zero, making the test suite a false negative for the primary deploy target. Fix: extend regex to `/\^(18|20|22|24)/`. No state-machine touch; no schema-sync.

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

### [P2] handleRebootOnSet and handleReconnectHKOnSet swallow POST errors silently (HAPStatus gap)
**Status:** queued
**Acceptance:** Failed reboot/reconnect POST causes HomeKit to see a failure response (switch snaps back to off AND Home app shows error banner) rather than silently showing success
**Source:** codebase-audit 2026-05-17
**Complexity:** S
**Notes:** index.js:371-377 (reboot), 431-433 (reconnect). Both handlers fire `runReboot()`/`runReconnectHK()` in fire-and-forget style: `.catch((err) => this.log.error(...))` swallows the rejection and returns void, so HAP receives no error signal -- same class as existing finding above (handleTargetDoorStateSet OPEN path) but for two newer handlers added in v1.1.0/v1.3.0. HomeKit shows the switch as successfully tapped even when the HTTP request failed. HAPStatus-translation category; no state-machine touch; no schema-sync.

### [P2] SerialNumber derived from user-editable name -- accessory identity drifts on rename
**Status:** queued
**Acceptance:** SerialNumber is stable across config renames (derived from ratgdoHost or a fixed constant); no orphaned accessory in HomeKit after a name change
**Source:** codebase-audit 2026-05-17
**Complexity:** S
**Notes:** index.js:156. `Characteristic.SerialNumber` is set to `this.name.replace(/\s+/g, '-')`. `this.name` comes from `this.config.name`, which users commonly edit. HomeKit uses SerialNumber as part of accessory identity hashing; a change causes iOS to see a new accessory and ghost the old one (duplicate tile, lost automations). Fix: derive SerialNumber from the stable `ratgdoHost` value (already unique per accessory) or a hardcoded model string. Cached-accessory / UUID-identity category; no state-machine touch.

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

### [P3] Three handleXxxOnSet handlers copy-paste identical 25-line gate pattern
**Status:** queued
**Acceptance:** Cooldown-gate + busy-gate + host-gate + fire-and-forget + reset-switch logic extracted to a shared helper; each handler is <=10 lines; behavior identical
**Source:** codebase-audit 2026-05-17
**Complexity:** M
**Notes:** index.js:304-335 (handleOnSet), 348-378 (handleRebootOnSet), 408-453 (handleReconnectHKOnSet). Three handlers share an identical structural pattern: guard on `!value`, cooldown check with remaining-seconds log, busy check, ratgdoHost check, set busy+timestamp, fire async fn in background with `.then/.catch/.finally` cleanup. Only the variable names (cooldownMs/rebootCooldownMs/reconnectHKCooldownMs, busy/rebootBusy/reconnectHKBusy, resetSwitch/resetRebootSwitch/resetReconnectHKSwitch) differ. Simplification/dedup category; no state-machine touch; no schema-sync.

---

## Force-close-touch findings (DO NOT auto-queue)

These findings touch force-close state-machine timing. Human review required before any fix is planned or scheduled.

### [FC-1] forceClose poll loop MAX_WAIT_MS=30000 hardcoded -- ignores closeWaitMs
**File:line:** index.js:642
**Category:** state-machine / magic-number
**Confidence:** high
**Detail:** const MAX_WAIT_MS = 30000 hardcoded inside runForceClose() useForceClose branch. User-configurable closeWaitMs (default 60s, max 180s) applies only to the legacy obstFromStatus branch. A user with a slow door who sets closeWaitMs=60000 still hits the 30s ceiling in useForceClose mode -- FAILED log fires at line 669 even if the door was seconds from closing. Decision needed: wire MAX_WAIT_MS to closeWaitMs, or add a separate forceCloseWaitMs config key? Either path changes close-monitoring loop timing.

### [FC-2] verifyCloseStarted hardcodes maxWaitMs=10000 -- may time out before door starts moving when TTC is non-zero
**File:line:** index.js:803
**Category:** state-machine / magic-number
**Confidence:** medium
**Detail:** `const maxWaitMs = 10000` is hardcoded inside verifyCloseStarted(), called from the legacy obstFromStatus path only. When bundleTtcZero is false, the door's TTC window (typically 5-10s) consumes most of this budget before any motion begins. A 5s TTC plus status-read latency easily exceeds 10s, causing the function to return false and fire the CRITICAL log even though the door is about to close normally. Decision needed: tie maxWaitMs to a config value (closeWaitMs or a new key) or document why 10s is always sufficient.

---

## Recently completed

_(prune to last 10)_
