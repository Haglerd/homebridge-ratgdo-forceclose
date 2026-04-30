# Changelog

All notable changes to this plugin are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.3] — 2026-04-30

### Fixed

- **HTTP timeout errors weren't being classified as transient/retryable**, which broke the active-polling recovery added in v1.0.2. The `httpRequest()` timeout handler created a plain `Error` with the message "request timed out after Nms" but no `.code` property; `isTransientConnectionError()` checked `err.code` first (no match) and then a regex against the message for `/etimedout/i`, which didn't match the literal text "timed out". So `waitForRatgdoReady()` and `postSetGdoWithRetry()` bailed on the first timeout instead of looping. Two-line fix:
  - `httpRequest()` timeout handler now sets `err.code = 'ETIMEDOUT'` on the rejected error.
  - `isTransientConnectionError()` regex now also matches `/timed.?out/i` as a belt-and-suspenders for any future error path that throws a plain timeout message without a code.
- After update: timeouts during the inter-step probe will now correctly trigger the active-poll retry loop instead of failing the whole sequence.

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

[1.0.3]: https://github.com/Haglerd/homebridge-ratgdo-forceclose/releases/tag/v1.0.3
[1.0.2]: https://github.com/Haglerd/homebridge-ratgdo-forceclose/releases/tag/v1.0.2
[1.0.1]: https://github.com/Haglerd/homebridge-ratgdo-forceclose/releases/tag/v1.0.1
[1.0.0]: https://github.com/Haglerd/homebridge-ratgdo-forceclose/releases/tag/v1.0.0
