# Changelog

All notable changes to this plugin are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] — 2026-04-30

Adds support for a custom ratgdo firmware build that exposes a `forceClose` `/setgdo` handler. Also fixes a v1.1.0 UX bug where the new sensor/reboot services all displayed as the accessory name in iOS Home.

### Added

- **`useForceClose` option** (default `false`). When ON, the plugin sends a single `POST forceClose=<ms>` instead of the obstFromStatus/TTC dance. ratgdo simulates a wall-button hold-to-close — **no flash write, no reboot, no obstFromStatus toggle**. The only software path that closes past a fully-blocked photo eye. Requires a custom ratgdo firmware build that exposes the `forceClose` handler; vanilla upstream firmware will return an error and the plugin will log a clear hint.
- **`forceCloseHoldMs` option** (default `3500`, range `1000`–`10000`). How long ratgdo simulates the wall-button hold. 3.5s default covers most GDO motors.
- **Auto-retry on Sec+ 1.0 motors.** Some Sec+ 1.0 GDOs treat the first hold-to-close as accidental and require a second confirm. The plugin retries up to 3 times when `useForceClose` is ON and the door doesn't transition to `Closing` within ~5s of the POST. Each retry posts a fresh `forceClose` and re-verifies. Eliminates the need for users to tap the switch twice.

### Fixed

- **v1.1.0 service names now actually display in iOS Home.** The Service constructor's `displayName` arg wasn't reliably surfaced by iOS Home for non-primary services on a multi-service accessory — every service inherited the accessory name ("Force Close Garage" everywhere). Each new service now explicitly sets `Characteristic.Name`, which forces propagation. Names are now `Reboot`, `Obstruction`, `Motion` (the accessory name supplies context within the tile).

### Changed

- `runForceClose()` early-branches on `useForceClose` after the pre-flight read. Pre-flight (door-state read + already-Closed early exit) still runs in both modes; everything past that diverges. Existing `obstFromStatus` mode (default) is byte-for-byte unchanged.
- Schema gains a new "Custom firmware — forceClose mode" fieldset with the two new options. Both default OFF; existing configs keep their behavior.
- `FirmwareRevision` characteristic bumped from `1.1.0` → `1.2.0`.

### Notes

- `useForceClose` is mutually exclusive with the obstFromStatus dance. When ON, the plugin sends ONE POST and does no flash writes — `bundleTtcZero`, `closeWaitMs`, `postCloseSettleMs`, `interStepMaxWaitMs` are still read but only `closeWaitMs` is consulted (it caps the wait-for-Closed poll).
- Vanilla upstream `homekit-ratgdo` does not implement `forceClose`. Enable `useForceClose` only if you've flashed a firmware build that does. The README notes which firmware patches expose this handler.

## [1.1.0] — 2026-04-30

Additive feature release. Existing Force Close behavior is unchanged — every new feature is gated by an opt-in toggle, all of which default OFF. Existing v1.0.5 configs continue to work without modification.

### Added

- **Optional Reboot ratgdo switch.** Set `enableRebootButton: true` to register a second momentary HomeKit Switch ("`<name>` Reboot") that POSTs `/reboot` to ratgdo when tapped. Has its own cooldown (`rebootCooldownMs`, default 60s). The cached digest auth nonce is automatically cleared after a successful reboot so the next request re-challenges cleanly. Useful when ratgdo gets into a weird state and you'd otherwise have to open the device's IP in a browser.
- **Optional Obstruction Contact Sensor.** Set `enableObstructionSensor: true` to register a HomeKit `ContactSensor` that mirrors `status.json.garageObstructed`. ContactSensorState semantics: `NOT_DETECTED` (contact open) when obstructed = alarm; `DETECTED` (contact closed) when clear = normal. Enable per-accessory notifications in iOS Home → Settings → Notifications to get a phone alert on every obstruction state change.
- **Optional Motion Sensor.** Set `enableMotionSensor: true` to register a HomeKit `MotionSensor` mirroring `status.json.garageMotion`. Useful for activity-based automations.
- **Status polling loop** powering both new sensors. Configurable interval (`statusPollIntervalMs`, default 3000ms, range 1000–60000). Polling pauses while the force-close or reboot is busy (don't pile load on ratgdo during the flash-write recovery window). Backs off 2× on transient connection errors so a struggling ratgdo doesn't get hammered. Only runs when at least one sensor is enabled — no extra load if sensors are off.
- **Optional managed device settings.** Set `manageDeviceSettings: true` to push selected ratgdo settings from Homebridge config on plugin init. Allowlisted keys: `TTCseconds`, `occupancyDuration`, `lightHomeKit`, `motionHomeKit`, `LEDidle`. Each is independently optional — the plugin only sends keys you explicitly set, in a single bundled `/setgdo` POST = one flash save (same trick the per-tap `bundleTtcZero` uses). Lets users centralize a few common ratgdo settings in Homebridge instead of editing them in the device's web UI. Network/security/protocol settings are deliberately NOT exposed — they belong in the device's web UI.

### Changed

- `FirmwareRevision` characteristic on the AccessoryInformation service bumped from `1.0.5` → `1.1.0`.
- Schema layout: three new collapsed fieldsets (`Optional — Reboot button`, `Optional — Sensors`, `Optional — Manage device settings`). Existing fieldsets unchanged.

### Notes

- All five v1.1.0 features default OFF. A user who upgrades from v1.0.5 and doesn't change config gets identical behavior — no new HomeKit services, no new background traffic.
- HomeKit displays multiple services on a single accessory under one tile; users tap into the tile to access individual services. If you'd prefer separate tiles per service, that requires converting from `accessory` plugin → `platform` plugin (a future v2.0.0 change, not in scope here).
- Reboot is `POST /reboot` per the homekit-ratgdo HTTP API. Per the firmware docs the endpoint is auth-exempt; in practice some installs return 401, which the existing digest-auth path handles transparently.
- The polling interval intentionally starts conservative (3s). ratgdo's HTTP server is fragile under load (verified in v1.0.x debugging); shorter intervals risk increasing the chance of the firmware crash that v1.0.4 traced. Lower at your own risk.

## [1.0.5] — 2026-04-30

Speed pass on the force-close sequence — confirmed via reading the homekit-ratgdo32 firmware source.

### Added

- **`bundleTtcZero` option** (default `true`). The plugin reads the user's `TTCseconds` setting during pre-flight and, on the same flash POST that toggles `obstFromStatus=true`, also sets `TTCseconds=0`. ratgdo's `/setgdo` handler iterates `server.args()` and only calls `ESP8266_SAVE_CONFIG()` ONCE at the end of the loop, so bundling is a free piggyback — same flash, same reboot, same recovery time. Step 3 restores the original TTC in the same flash POST as the `obstFromStatus` restore. Skips the ~5–10s warning-beep window per close, **without permanently disabling the warning beep on normal HomeKit closes**. Disable in config if you want the warning beep during force-close (e.g. for safety when you can't see the door).
- **`postCloseSettleMs` option** (default `8000`). Small fixed wait after the door is observed `Closed` and before the restore POST, so ratgdo has a moment to settle before another flash-write reboots it.

### Changed

- **Active wait for `Closed` instead of fixed `closeWaitMs` sleep.** v1.0.4 always slept the full `closeWaitMs` (60s default) before firing Step 3 — even if the door physically closed in 12s. v1.0.5 polls `garageDoorState` every 500ms after Step 2 and fires Step 3 as soon as `Closed` is observed (capped at `closeWaitMs`). Saves ~40s on average for default-config users; old behavior is recoverable by setting `closeWaitMs=12000` and `postCloseSettleMs=0`.
- **`closeWaitMs` semantics changed** from "fixed sleep" to "max wait for Closed." Default and bounds unchanged. UI title relabeled to reflect this.
- New helper `postSetGdoMulti({k1: v1, k2: v2})` POSTs multiple key=value pairs in a single `/setgdo` request. Used by `postSetGdo` (single key) and the bundled flash POSTs.
- Pre-flight log line now includes `TTCseconds` reading when present.
- New "On tap:" summary line reflects the bundled flow with TTC.

### Notes

- `obstFromStatus` cannot be changed without a flash write — verified in homekit-ratgdo32 source. There is no in-memory or transient override path. The flash write is what reboots ratgdo on some installs; v1.0.4's "wait for fully ready" handling is unchanged in v1.0.5.
- For users who want even faster taps in the **skip-Step-1** fast path (where `obstFromStatus` already matches `bypassValue` so no flash happens at all), set `TTCseconds=0` permanently in the ratgdo web UI. The plugin can't help on that path because it doesn't trigger any flash POSTs.

## [1.0.4] — 2026-04-30

### Fixed

- **The actual real root cause of "POST 200 but door doesn't close":** when the obstFromStatus flash write crashes ratgdo, two layers come back at different times — the HTTP server recovers at ~12s post-reboot, but the wall-panel / GDO-comms layer doesn't recover until ~30s. During that ~18s gap, `/status.json` returns 200 OK with `garageDoorState: "Unknown"` and any `/setgdo` POST is accepted (200 OK) but **silently dropped** because the GDO-comms task isn't running yet. v1.0.3's `waitForRatgdoReady` only checked "did /status.json respond" — not enough. v1.0.4 now also requires `garageDoorState` to be a valid state (`Open` / `Closed` / `Opening` / `Closing` / `Stopped`) before declaring ratgdo ready and proceeding to Step 2. Confirmed by serial log analysis on a real ratgdo32 install.

### Changed

- **Restore value is now dynamic — uses the pre-flight reading instead of configured `normalValue`.** Previously Step 3 restored `obstFromStatus` to whatever `normalValue` was set to in the plugin config, which was wrong when the user's actual permanent state didn't match (e.g. pre-flight read `false` but `normalValue` was `true` → plugin permanently flipped the user's setting). v1.0.4 captures the original value during pre-flight and restores to that. Configured `normalValue` is now only used as a fallback when pre-flight reads fail entirely.
- **Step 3 now skipped when no change was made.** If Step 1 was skipped (because `obstFromStatus` already matched `bypassValue`), the restore POST would have been a no-op rewrite that still triggers a flash write. v1.0.4 skips Step 3 in that case.
- **`interStepMaxWaitMs` default raised from 30s → 45s, max from 60s → 90s.** Covers the full HTTP-recovery (~12s) + GDO-comms-recovery (~30s) window with margin. The plugin still proceeds as soon as ratgdo is actually ready, so this is a ceiling not a sleep.
- **`closeWaitMs` default raised from 18s → 60s, max from 60s → 180s.** The restore POST in Step 3 is also a flash write, and triggering it before the door is fully shut and the firmware has settled risks a second crash. 60s covers ~12s door close + ~48s settle.
- Polling logs now distinguish "HTTP up" from "fully ready (GDO comms back)" so the recovery sequence is visible: `HTTP up after 11920ms but GDO-comms not yet (door=Unknown); continuing to poll` followed by `ratgdo fully ready (door=Open) after 28140ms (HTTP-up at 11920ms, GDO-comms +16220ms)`.

## [1.0.3] — 2026-04-30

### Fixed

- **The actual root cause of the close-doesn't-happen / ratgdo-reboots-mid-sequence issues:** every force-close ran a 3-POST sequence (`obstFromStatus=true` → `garageDoorState=0` → `obstFromStatus=false`), and the obstFromStatus POST writes config to flash on ratgdo. When the user's permanent `obstFromStatus` already matches `bypassValue` (e.g. both `true`), the toggle was a no-op functionally but **still triggered the flash write**, which on some installs crashes the ratgdo firmware mid-sequence. This release adds a pre-flight read of `/status.json` and **skips Step 1 if `obstFromStatus` already matches `bypassValue`** and **skips Step 3 if it already matches `normalValue`**. For users like the original reporter (permanent `obstFromStatus=true`), the entire sequence collapses to a single `garageDoorState=0` POST — identical to how the native HomeKit `target_door_state_set` handler closes the door (`homekit.cpp:256`), with no flash writes, no crash trigger.
- **HTTP timeout errors are now classified as transient and retried** (was bailing the active-poll loop on first probe timeout in v1.0.2). `httpRequest` timeout handler now sets `err.code = 'ETIMEDOUT'`, and `isTransientConnectionError` regex was extended to match `/timed.?out/i` for safety.
- **Pre-flight skip-if-Closed:** if `garageDoorState` is already `Closed` at the start of a tap, the plugin exits immediately without sending any POSTs.

### Added

- **Digest auth nonce caching.** After the first 401 challenge, the plugin caches `realm` / `nonce` / `qop` / `opaque` / `algorithm` and sends Authorization preemptively on subsequent requests with an incrementing `nc` counter. Halves the request count to ratgdo per force-close sequence (was 6 round-trips for 3 POSTs, now 4: 1 unauthed + 3 authed). Lower load on ratgdo's tiny HTTP server reduces the chance of the firmware crash. Cache is invalidated automatically if ratgdo rejects a cached nonce (returns 401 to a request that included our cached Authorization header).
- New helper `getStatusJson()` for the pre-flight read.

### Changed

- Pre-flight log line shows the read state, e.g. `Pre-flight: door=Open, obstFromStatus=true`. Each step explicitly logs SKIPPED when applicable so the log makes the optimization visible.

## [1.0.2] — 2026-04-30

### Fixed

- **`ECONNREFUSED` on Step 2 (close) when ratgdo's HTTP server takes longer than the inter-step delay to recover from the Step 1 flash write.** v1.0.1's fixed 500ms-then-retry mechanism was sometimes too short — if ratgdo briefly stops accepting connections (or restarts), both the initial POST and the single retry could fail. Replaced with **active polling**: after Step 1, the plugin probes GET `/status.json` every 250ms until ratgdo responds, then immediately fires Step 2. Fast happy path (<500ms on a healthy ratgdo), robust slow path (waits up to `interStepMaxWaitMs`).
- The retry-on-transient-error mechanism for the close POST and restore POST now also uses active polling instead of a fixed delay before retrying.

### Changed

- **Replaced `interStepDelayMs` config with `interStepMaxWaitMs`** (default `15000`, min `1000`, max `60000`). Different semantics — this is a maximum ceiling, not a fixed wait. Existing `interStepDelayMs` values in user configs are silently ignored (the new mechanism doesn't need them; the active poll proceeds as soon as ratgdo is ready regardless of any fixed delay).

## [1.0.1] — 2026-04-30

### Fixed

- **ECONNRESET on the close command (Step 2 of the force-close sequence).** Browser and Node both reproduced: when the close POST is sent too soon after the obstruction-bypass POST, ratgdo's HTTP server is still flushing the config write to flash and either rejects the new connection (`ECONNRESET`) or crashes outright. Fixed by:
  - **Default inter-step delay raised from 300ms to 500ms** (configurable via the new `interStepDelayMs` option). Combined with the auto-retry below, 500ms gives a snappy happy path while still recovering from occasional slow flash writes.
  - **Retry once on transient connection errors** (`ECONNRESET`, `ECONNREFUSED`, `ETIMEDOUT`, `EPIPE`) for both the close POST (Step 2) and the restore POST (Step 3 + the `finally` recovery), with another `interStepDelayMs` wait between retries.
  - **`Connection: close` HTTP header on every POST** to force a fresh TCP connection per request (small embedded HTTP servers don't always recover keep-alive sockets cleanly).

### Added

- **`interStepDelayMs` config option** (default `500`, min `200`, max `10000`) — surfaces the inter-step delay for users who want to tune it (lower for snappier response, higher if they see frequent retries in logs).
- **README troubleshooting entry** explaining that iOS Home app may briefly show "Open" after a successful Force Close — ratgdo updates HomeKit characteristics correctly but iOS caches state aggressively. Pull-to-refresh or kill-and-reopen the Home app to force a UI refresh. This is an iOS limitation, not a plugin or firmware bug.

## [1.0.0] — 2026-04-30

Initial public release on npm.

### Added

- **Momentary HomeKit switch** that runs a four-step force-close sequence against ratgdo's `POST /setgdo` endpoint:
  1. `obstFromStatus = bypassValue` (default `true`) — temporarily change ratgdo's obstruction source so the firmware ignores the false-tripped photo-eye pin.
  2. Short pause for the firmware to apply the new setting.
  3. `garageDoorState = 0` — send the close command.
  4. After `closeWaitMs` (default 18s), restore `obstFromStatus = normalValue` (default `false`). Restoration runs in a `finally` block so the setting is always restored even if step 2 or 3 throws.
- **HTTP Digest authentication** for ratgdo installations with "Require Password" enabled (RFC 7616 / 2617, qop=auth, MD5).
- **Configurable cooldown** (`cooldownMs`, default 20s) to prevent fat-finger re-triggers.
- **Schema-driven Homebridge UI form** with grouped fieldsets for Connection, Authentication, and Advanced settings.
- **HomeKit Shortcut alternative** documented in [`shortcut/README.md`](shortcut/README.md) for users who don't run Homebridge.
- **CI workflow** (`.github/workflows/ci.yml`) — runs `node --check` and JSON validation on every PR.
- **Tag-triggered npm publish workflow** (`.github/workflows/publish.yml`) using npm Trusted Publishing (OIDC) — no long-lived secrets.

[1.2.0]: https://github.com/Haglerd/homebridge-ratgdo-forceclose/releases/tag/v1.2.0
[1.1.0]: https://github.com/Haglerd/homebridge-ratgdo-forceclose/releases/tag/v1.1.0
[1.0.5]: https://github.com/Haglerd/homebridge-ratgdo-forceclose/releases/tag/v1.0.5
[1.0.4]: https://github.com/Haglerd/homebridge-ratgdo-forceclose/releases/tag/v1.0.4
[1.0.3]: https://github.com/Haglerd/homebridge-ratgdo-forceclose/releases/tag/v1.0.3
[1.0.2]: https://github.com/Haglerd/homebridge-ratgdo-forceclose/releases/tag/v1.0.2
[1.0.1]: https://github.com/Haglerd/homebridge-ratgdo-forceclose/releases/tag/v1.0.1
[1.0.0]: https://github.com/Haglerd/homebridge-ratgdo-forceclose/releases/tag/v1.0.0
