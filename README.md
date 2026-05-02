<p align="center">
<img src="https://github.com/homebridge/branding/raw/latest/logos/homebridge-wordmark-logo-vertical.png" width="150">
</p>

<p align="center">

# homebridge-ratgdo-forceclose

</p>

A Homebridge plugin that adds a HomeKit garage-door tile (or momentary switch) for [ratgdo](https://paulwieland.github.io/ratgdo/)-controlled garage doors, for cases when the photo-eye safety sensor is blocking a normal close — sun glare on the receiver, debris, or anything else.

> [!IMPORTANT]
> **v1.2.x recommended setup requires custom firmware.** The single-POST hold-to-close override (the only software path that closes past a fully-blocked photo eye) requires the forked firmware [`Haglerd/homekit-ratgdo32`](https://github.com/Haglerd/homekit-ratgdo32) v3.4.4-forceclose.5 or later. Vanilla upstream `ratgdo/homekit-ratgdo32` firmware does not have the `forceClose` HTTP handler. See [**Required firmware**](#required-firmware) below.
>
> The plugin still works against vanilla upstream firmware in legacy mode (`useForceClose: false`, `presentAsGarageDoor: false`) — same v1.0.x obstFromStatus dance — but that path only handles flickering false trips, not a fully-blocked beam.

<p align="center">

[![npm version](https://img.shields.io/npm/v/homebridge-ratgdo-forceclose?color=blue)](https://www.npmjs.com/package/homebridge-ratgdo-forceclose)
[![npm downloads](https://img.shields.io/npm/dt/homebridge-ratgdo-forceclose?color=blue)](https://www.npmjs.com/package/homebridge-ratgdo-forceclose)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</p>

**Quick start:** [Install](#installation) → [Configure](#configuration) → [Get support](#support)

## What this is

A Homebridge accessory plugin that exposes one of two HomeKit accessories for your ratgdo:

- **GarageDoorOpener tile** (default in v1.2.x): proper garage-door icon with live Open/Closed status. Slider to **Closed** triggers the firmware's hold-to-close override; slider to **Open** runs a normal open. State is driven by status polling so the tile updates as the door physically moves.
- **Momentary Switch** (legacy v1.0.x style, set `presentAsGarageDoor: false`): single tap fires the close sequence, then the switch auto-resets.

The plugin runs entirely over local HTTP to ratgdo's web UI. No cloud, no MQTT, no extra dependencies.

## Two operating modes

Same plugin, two HTTP-level strategies to make the door close. Pick based on what firmware your ratgdo runs.

| | **forceClose mode** *(default, v1.2.x)* | **legacy obstFromStatus mode** *(v1.0.x compat)* |
|---|---|---|
| Plugin config | `useForceClose: true` *(default)* | `useForceClose: false` |
| Required firmware | `Haglerd/homekit-ratgdo32` ≥ v3.4.4-forceclose.5 | Any `homekit-ratgdo32` (vanilla upstream included) |
| What it sends | One POST `forceClose=3500` | POST `obstFromStatus=true` → POST `garageDoorState=0` → wait → POST `obstFromStatus=<original>` |
| Closes past fully-blocked photo eye | **YES** (firmware emulates wall-button hold-to-close override) | NO (only handles flickering false reads) |
| Triggers ratgdo flash write / reboot | NO | YES (obstFromStatus is a persistent setting) |
| Time per tap | ~25 seconds | ~30–60 seconds (TTC + recovery + close + restore) |
| Close confirmation reliability | High (firmware does 2-press internally) | Medium (depends on obstruction state) |

**Most users want forceClose mode.** It's simpler, faster, and actually solves the photo-eye-blocked case. It's the default in v1.2.x. The only reason to use legacy mode is if you're running vanilla upstream firmware and don't want to flash a fork.

## Optional accessories

The plugin's primary accessory is the garage-door tile (or legacy switch). It can also expose four additional services on the same accessory tile, all opt-in and all default OFF:

| Toggle | What it adds | Why |
|---|---|---|
| `enableRebootButton` | Momentary **Reboot** switch — POSTs `/reboot` to ratgdo | Fast recovery when ratgdo is in a weird state, without trekking to the device's web UI. |
| `enableReconnectHKButton` *(v1.3.0+)* | Momentary **Reconnect HomeKit** switch — POSTs `/reconnectHomeKit` to ratgdo | Recovers iOS "No Response" on the ratgdo accessory in ~5–10s by cycling WiFi (HomeSpan re-attaches automatically). Lighter than a reboot — ratgdo stays running. **Requires `Haglerd/homekit-ratgdo32` ≥ v3.4.4-forceclose.16** for the `/reconnectHomeKit` endpoint. |
| `enableObstructionSensor` | **Obstruction** ContactSensor mirroring `status.json.garageObstructed` | Get a phone notification (via iOS Home → Settings → Notifications) every time ratgdo flags an obstruction. |
| `enableMotionSensor` | **Motion** Sensor mirroring `status.json.garageMotion` | Trigger HomeKit automations on garage activity. |

Both sensors are driven by a status-poll loop (default 3s, tunable via `statusPollIntervalMs`). Polling pauses while a force-close, reboot, or reconnect is in flight so the plugin doesn't pile load on ratgdo when it's already busy.

There's also an opt-in `manageDeviceSettings` mode that pushes a small set of ratgdo's own settings (TTC, occupancy duration, LED idle behaviour, native HomeKit light/motion toggles) on plugin init — useful if you want to centralize a couple of ratgdo settings in Homebridge instead of editing them in the device's web UI.

## Required firmware

### For default (forceClose) mode — recommended

Flash [`Haglerd/homekit-ratgdo32`](https://github.com/Haglerd/homekit-ratgdo32) firmware v3.4.4-forceclose.5 or later to your ratgdo32. This is a fork of the upstream `ratgdo/homekit-ratgdo32` firmware with one feature added: a `forceClose` HTTP handler that simulates a real wall-button hold-to-close override at the Sec+1.0 protocol level — including the UL-mandated TTC warning sequence the GDO motor's override gate requires.

**One-time flash:** download `homekit-ratgdo32-vX.X.X-forceclose.N.firmware.bin` from [Releases](https://github.com/Haglerd/homekit-ratgdo32/releases) and drop it onto ratgdo's web UI **Firmware Update** page.

**After that, OTA just works:** the fork is configured with its own `gitUser` so ratgdo's "Check for update" button checks the fork's releases (not upstream's) and updates one-click. A daily auto-sync workflow keeps the fork rebased on top of upstream — when upstream ships a new version, the fork picks it up automatically and re-publishes with the `forceClose` patch applied. Maintenance is handled.

### For legacy mode

Any `homekit-ratgdo32` firmware works — vanilla upstream included. Set `useForceClose: false` and `presentAsGarageDoor: false` in plugin config to revert to v1.0.x behavior.

### Not supported

ESPHome ratgdo firmware. The plugin uses HTTP `/setgdo` POSTs which are a `homekit-ratgdo` family thing. ESPHome ratgdo uses a different protocol stack. For ESPHome firmware, use [`homebridge-ratgdo-esphome`](https://github.com/BMDan/homebridge-ratgdo-esphome) or [`homebridge-ratgdo`](https://github.com/hjdhjd/homebridge-ratgdo).

## What this plugin does NOT do

To set expectations clearly:

- **It does not auto-discover ratgdo devices.** You configure one accessory per door with the IP/host explicitly. (Most homes have one garage door; this is fine.)
- **It does not work over the cloud.** Plugin → ratgdo communication is local-network only. (HomeKit access from outside your network still works via your HomeKit hub — Apple TV / HomePod / iPad — like any other HomeKit accessory.)
- **It does not work with ESPHome ratgdo firmware.** This plugin requires the `homekit-ratgdo` / `homekit-ratgdo32` firmware which exposes the `POST /setgdo` HTTP endpoint. ESPHome ratgdo uses a different protocol stack — see [Required firmware](#required-firmware) above.
- **It does not bypass the GDO motor's own UL safety logic** unless the firmware fork's hold-to-close override engages it. Even with `forceClose` mode, if the motor's own internal photo-eye sensor (separate from ratgdo's pin) sees a fully-blocked beam, it will reverse the door mid-close. The fork's firmware emulates the wall-button hold-to-close pattern that the motor recognizes as "user is overriding safety" — same UL-approved override the wall button gives you. If your install doesn't honor wall-button hold-to-close either, no software can fix it.
- **It does not pair with HomeKit directly.** Goes through Homebridge. (For native HomeKit pairing, the firmware does that itself — separate accessory.)

## Two ways to use this

This repo offers two delivery mechanisms for the same underlying behavior:

- **Homebridge plugin** (the rest of this README) — full HomeKit integration with a tappable switch in the Home app, remote access via your HomeKit hub, configurable cooldown, optional digest auth.
- **HomeKit Shortcut** — no Homebridge required; build a one-off button in the iOS Shortcuts app that fires the same single `forceClose` POST over the local network. Build instructions: [`shortcut/README.md`](shortcut/README.md).

Both options do exactly the same thing on ratgdo's side. See the comparison table further down to pick which one fits your setup.

## The problem it solves

Liftmaster and Chamberlain garage doors have an infrared photo-eye safety sensor at the bottom of the rails. The receiving eye can be blinded by direct sunlight at low sun angles (typically morning or late afternoon depending on which way your garage faces). When that happens, the opener registers a false obstruction and refuses to close.

ratgdo respects that obstruction signal and will not send a close command while the obstruction flag is asserted. This is correct, safe default behavior — but it means HomeKit-initiated closes silently fail during sun-glare windows.

The traditional workaround is to walk to the garage and **hold** the wall control button until the door closes (which bypasses the photo eye on most opener models). This plugin gives you a HomeKit-tappable software equivalent: it temporarily changes ratgdo's obstruction-source setting from "the sensor pin" to "GDO status messages" — the GDO itself isn't false-tripped, only the wire from the photo eye is — sends the close, then restores the setting.

## Compatibility

**Firmware** — this plugin requires `homekit-ratgdo` family firmware:

- ✅ [homekit-ratgdo](https://paulwieland.github.io/ratgdo/) (Paul Wieland's HomeKit-aware ESP firmware)
- ✅ [homekit-ratgdo32](https://github.com/sonic1015/homekit-ratgdo32) (the ESP32 fork)
- ❌ [esphome-ratgdo](https://ratgdo.github.io/esphome-ratgdo/) — **not supported.** ESPHome firmware does not expose the `POST /setgdo` HTTP endpoint this plugin uses. For ESPHome firmware, use [`homebridge-ratgdo-esphome`](https://github.com/BMDan/homebridge-ratgdo-esphome) or [`homebridge-ratgdo`](https://github.com/hjdhjd/homebridge-ratgdo).

**Garage-door opener** — works with any ratgdo-compatible opener:
- Tested on Liftmaster Security+ 1.0 with `Haglerd/homekit-ratgdo32` v3.4.4-forceclose.21.
- Should work on Security+ 2.0 too but has not been verified.

**Runtime** — Homebridge 1.8+ (or 2.0 beta) and Node.js 18 / 20 / 22 / 24.

## Safety warning

> **This plugin bypasses the obstruction sensor's effect on ratgdo.** Only use it when you can directly see the door and have confirmed nothing is in the path. The obstruction sensor exists for a reason — it stops a closing door from crushing pets, children, or property. Tapping this switch is the equivalent of holding the wall-control button down: the safety check is suppressed for the duration of the close.
>
> **Do not put this switch in an automation, scene, or shortcut that runs without you watching.** The plugin enforces a configurable cooldown to prevent fat-finger re-triggers, but cooldown is not a substitute for paying attention.
>
> If your photo eye is being false-tripped frequently enough that you need this plugin, consider also installing a sun shroud or hood over the receiver eye — that's the actual fix.

## Plugin vs. Shortcut: which should I use?

| Feature | Homebridge Plugin | HomeKit Shortcut |
|---|---|---|
| Appears as a HomeKit switch in the Home app | Yes | No (lives in Shortcuts app, can be added to home screen / Siri / Control Center) |
| Works from outside your local network (cellular, etc.) | Yes (via HomeKit hub) | No (LAN only) |
| Shared with everyone in your Home automatically | Yes | No (each user builds their own) |
| Requires Homebridge running on a Pi/server | Yes | No |
| Setup time | ~10 min (install npm pkg, edit config) | ~5 min (build in Shortcuts app) |
| Supports ratgdo "Require Password" (digest auth) | Yes | No |
| Triggerable by Siri / HomePod | Indirectly (via Home app voice) | Directly ("Hey Siri, force close garage") |
| Triggerable by HomeKit automation | Yes (but don't — see safety) | No |

If you already run Homebridge, the plugin is the cleaner integration. If you don't, the Shortcut gets you the same close-the-door behavior with a five-minute build and no server. Build steps for the Shortcut: [`shortcut/README.md`](shortcut/README.md).

## Installation

> **Tip:** Run this plugin as a **child bridge** if your Homebridge UI supports it (most modern setups do). Right-click the plugin in the Plugins tab and choose **Bridge Settings → Run as a Child Bridge**. This isolates the plugin in its own process so a config error or crash can't take down everything else on your bridge. Recommended by the Homebridge maintainers for any plugin that talks to a network device.

### Method 1 — Homebridge UI (recommended)

1. Open the Homebridge UI in your browser.
2. Go to the **Plugins** tab.
3. Search for `homebridge-ratgdo-forceclose` (or use the search bar's three-dot menu → **Install Plugin** and paste the package name).
4. Once installed, click the plugin's **Settings** (cog) icon and fill in `ratgdoHost` (and `username` / `password` if your ratgdo requires auth).
5. (Recommended) right-click the plugin tile → **Bridge Settings** → toggle **Run as a Child Bridge**.
6. Save, then restart the child bridge (or Homebridge itself) using the prompt at the top of the UI.

After restart, the **Force Close Garage** switch appears in the Home app under the Homebridge bridge.

### Method 2 — Install via npm CLI

```bash
sudo npm install -g homebridge-ratgdo-forceclose
sudo hb-service restart
```

### Method 3 — Install from a local clone

```bash
git clone https://github.com/Haglerd/homebridge-ratgdo-forceclose.git
cd homebridge-ratgdo-forceclose
sudo npm install -g .
sudo hb-service restart
```

### Updating

- **Via Homebridge UI:** Plugins tab → click the plugin's **Update** button when one is available.
- **Via CLI:** `sudo npm update -g homebridge-ratgdo-forceclose && sudo hb-service restart`.

## Configuration

### Minimal config

```json
{
  "accessories": [
    {
      "accessory": "RatgdoForceClose",
      "name": "Force Close Garage",
      "ratgdoHost": "http://192.168.1.50"
    }
  ]
}
```

That's enough to get a working switch. Replace `192.168.1.50` with your ratgdo's actual IP or hostname.

### Common config (forceClose mode + optional Reboot + Reconnect HomeKit)

```json
{
  "accessories": [
    {
      "accessory": "RatgdoForceClose",
      "name": "Force Close Garage",
      "ratgdoHost": "http://192.168.1.50",
      "username": "admin",
      "password": "your-password-here",
      "useForceClose": true,
      "presentAsGarageDoor": true,
      "forceCloseHoldMs": 3500,
      "cooldownMs": 20000,
      "enableRebootButton": true,
      "enableReconnectHKButton": true
    }
  ]
}
```

### Configuration reference

#### Core

| Key | Type | Default | Description |
|---|---|---|---|
| `name` | string | `"Force Close Garage"` | The HomeKit name for the accessory tile. |
| `ratgdoHost` | string | *(required)* | Base URL of your ratgdo, e.g. `http://192.168.1.50`. The `http://` prefix is added if you omit it. |
| `username` | string | `null` | Only required if you've enabled "Require Password" in ratgdo's settings. |
| `password` | string | `null` | Paired with `username`. The plugin uses HTTP Digest auth (which is what ratgdo uses). |
| `cooldownMs` | integer | `20000` | Minimum milliseconds between consecutive force-close triggers. Min `0`, max `120000`. |

#### forceClose mode (default — recommended)

| Key | Type | Default | Description |
|---|---|---|---|
| `useForceClose` | boolean | `true` | When ON, sends a single POST `forceClose=<ms>` and lets the firmware run the full 2-press hold-to-close sequence internally. **Requires `Haglerd/homekit-ratgdo32` ≥ v3.4.4-forceclose.5.** |
| `forceCloseHoldMs` | integer | `3500` | How long ratgdo simulates the wall-button hold. 3.5s covers most GDOs; bump to 4000–5000 if the motor refuses the hold. Range `1000`–`10000`. |
| `presentAsGarageDoor` | boolean | `true` | When ON, the accessory is a HomeKit GarageDoorOpener tile (icon, Open/Closed status, slider). Slider→Closed runs force-close, slider→Open runs a normal open. State is driven by status polling so the tile reflects the door's actual position. Set OFF for the v1.0.x momentary-Switch UI. |

#### Optional accessories (all default OFF — opt in to add the corresponding HomeKit service)

| Key | Type | Default | Description |
|---|---|---|---|
| `enableRebootButton` | boolean | `false` | Adds a momentary **Reboot** switch that POSTs `/reboot` to ratgdo. |
| `rebootCooldownMs` | integer | `60000` | Minimum ms between reboot triggers. ratgdo takes ~30s to come back; default 60s prevents accidental double-reboots. Range `5000`–`600000`. |
| `enableReconnectHKButton` *(v1.3.0+)* | boolean | `false` | Adds a momentary **Reconnect HomeKit** switch that POSTs `/reconnectHomeKit` to ratgdo. Cycles WiFi so HomeSpan re-attaches — recovers iOS "No Response" without a full reboot. **Requires firmware ≥ v3.4.4-forceclose.16**, returns 404 on older firmware. |
| `reconnectHKCooldownMs` *(v1.3.0+)* | integer | `30000` | Minimum ms between reconnect triggers. WiFi cycles in ~5–10s; default 30s. Range `5000`–`600000`. |
| `enableObstructionSensor` | boolean | `false` | Adds a **ContactSensor** mirroring `status.json.garageObstructed`. Open = obstructed, Closed = clear. Enable phone notifications in iOS Home for obstruction alerts. |
| `enableMotionSensor` | boolean | `false` | Adds a **MotionSensor** mirroring `status.json.garageMotion`. Useful for HomeKit automations on garage activity. |
| `statusPollIntervalMs` | integer | `3000` | How often the plugin polls `/status.json` to drive the GarageDoorOpener tile + sensors. Polling pauses during force-close / reboot / reconnect. Range `1000`–`60000`. |

#### Managed device settings (optional — push ratgdo settings on plugin init)

| Key | Type | Default | Description |
|---|---|---|---|
| `manageDeviceSettings` | boolean | `false` | When ON, the plugin pushes the values from `deviceDefaults` to ratgdo's `/setgdo` endpoint on init (one bundled flash write). Lets you centralize a couple of ratgdo settings in Homebridge. |
| `deviceDefaults.TTCseconds` | integer | *(unset)* | Baseline TTC warning seconds (0–30) used by normal closes. Force-close still temporarily sets this to 0 via `bundleTtcZero`. |
| `deviceDefaults.occupancyDuration` | integer | *(unset)* | Occupancy hold time in seconds (30–3600). |
| `deviceDefaults.lightHomeKit` | boolean | *(unset)* | ratgdo's own toggle for whether the GDO light appears as a native HomeKit Lightbulb. |
| `deviceDefaults.motionHomeKit` | boolean | *(unset)* | ratgdo's own toggle for whether motion appears in HomeKit natively. |
| `deviceDefaults.LEDidle` | integer | *(unset)* | LED behaviour when idle: `0` off, `1` on, `2` disabled. |

Leave any `deviceDefaults.*` field unset to NOT push that setting; the plugin only sends keys that are actually defined.

#### Legacy obstFromStatus mode (only used when `useForceClose: false`)

| Key | Type | Default | Description |
|---|---|---|---|
| `settingKey` | string | `"obstFromStatus"` | Which ratgdo setting to toggle during the close. Switch to `pinBasedObst` and flip the bypass/normal booleans if the default doesn't work for your firmware. |
| `bypassValue` | boolean | `true` | Value POSTed to `settingKey` before the close command. |
| `normalValue` | boolean | `false` | FALLBACK ONLY — the plugin reads the current value pre-flight and restores it; this default is consulted only if the pre-flight read fails entirely. |
| `bundleTtcZero` | boolean | `true` | Bundle `TTCseconds=0` into the same flash POST as `obstFromStatus` to skip the warning-beep window. Costs zero extra reboots. |
| `closeWaitMs` | integer | `60000` | Max wait for the door to reach Closed between Step 2 and Step 3 (CEILING, not a fixed sleep — plugin polls every 500ms and proceeds the moment the door is Closed). Range `1000`–`180000`. |
| `postCloseSettleMs` | integer | `8000` | Settle time after Closed before firing the Step 3 restore POST. Range `0`–`60000`. |
| `interStepMaxWaitMs` | integer | `45000` | Max wait for ratgdo to be FULLY ready (HTTP responding AND `garageDoorState` non-Unknown) between Step 1 and Step 2. Range `1000`–`90000`. |

## How it works

### Default (forceClose) mode

When `useForceClose: true` (the default), every tap collapses the close into a single POST against ratgdo's `/setgdo` endpoint:

1. **Pre-flight `GET /status.json`** — read current door state. If the door is already `Closed`, exit early; nothing to do.
2. **`POST forceClose=<forceCloseHoldMs>`** (default `3500` ms) — the firmware fork takes over from here, simulating a real wall-button hold-to-close override at the Sec+1.0 protocol level. That override is the only software path that closes past a fully-blocked photo eye, because it's the same pattern the GDO's own UL-approved override gate is designed to recognize.
3. **Status polling** — the plugin watches `garageDoorState` transition through `Closing` → `Closed` so the HomeKit tile reflects reality. If the door doesn't enter `Closing` within ~5s, the plugin auto-retries up to 3 times (some Sec+ 1.0 motors treat the first hold as accidental). No extra POSTs are fired — each retry is a fresh `forceClose`.

No flash writes, no firmware reboots, no obstFromStatus toggling. The whole sequence completes in ~25 seconds.

### Legacy (obstFromStatus) mode

When `useForceClose: false`, the plugin falls back to the v1.0.x four-step sequence — useful if you're running vanilla upstream firmware that doesn't have the `forceClose` HTTP handler:

1. **`POST settingKey=bypassValue`** — temporarily change ratgdo's obstruction source. With the default `obstFromStatus=true`, this means "stop reading the sensor pin, only listen for obstruction in the GDO's own status messages." Bundled with `TTCseconds=0` (when `bundleTtcZero: true`) to skip the warning-beep window in the same flash write.
2. **Wait for ratgdo to come back** — flash writes briefly crash/restart ratgdo; the plugin polls `/status.json` until the device responds AND `garageDoorState` is a valid (non-Unknown) value before proceeding.
3. **`POST garageDoorState=0`** — the close command itself.
4. **Wait for `Closed`, then settle, then restore** — once the door reports Closed, the plugin waits `postCloseSettleMs` (default 8s) and POSTs the original `settingKey` value back along with the original `TTCseconds`. This step runs in a `finally` block, so the bypass setting is always restored even if the close itself fails. If the restore POST itself fails, the plugin logs a CRITICAL warning telling you to fix the setting manually in ratgdo's web UI.

The setting being toggled (`obstFromStatus`) corresponds to the **"Get obstruction from GDO status messages"** checkbox on ratgdo's settings page. If you want to see what state your ratgdo is in, that's the field to check.

## Troubleshooting

- **The switch flips on and immediately flips off but the door doesn't move.** Check Homebridge logs (`sudo hb-service logs`) for a non-200 response from `/setgdo` or a digest-auth failure. If you've enabled "Require Password" on ratgdo, make sure `username` and `password` are set in the plugin config. If the firmware version on the device is older than `v3.4.4-forceclose.5`, the `forceClose` POST returns an error — either flash the fork or set `useForceClose: false` to fall back to legacy mode.

- **forceClose mode: the firmware sequence runs but the motor refuses the hold.** Some Sec+ 1.0 GDOs treat the default 3.5s hold as too short. Bump `forceCloseHoldMs` to `4500` or `5000` in the plugin config and retry. Watch the ratgdo log (`http://YOUR-RATGDO-IP/showlog`) — you should see `Door state changing from Open to Closing` after the `forceClose` POST; if it never enters Closing, the hold isn't long enough.

- **Legacy mode: the switch fires the sequence but the door still doesn't close.** This means the obstruction is being seen by the opener itself, not just propagated through ratgdo. Try the inverse setting: change `settingKey` to `pinBasedObst` and flip the booleans — `bypassValue: false`, `normalValue: true`. That tells ratgdo "stop reading the obstruction pin entirely" instead of just changing the source. (forceClose mode bypasses this whole class of problem because it doesn't depend on ratgdo seeing the obstruction signal at all.)

- **Neither setting works (and forceClose mode also fails).** The photo eye is being blinded at the hardware level AND the GDO motor is refusing the hold-to-close override — ratgdo can't help here because the obstruction signal is locked in at the opener's logic board AND the motor isn't honoring the override pattern. The actual fix is a sun shroud or hood over the photo-eye receiver (search "garage door photo eye sun shield"). A piece of black PVC pipe works in a pinch.

- **iOS Home shows "No Response" for the ratgdo accessory.** This is a HomeKit hub-side cache issue, not a device problem — the device itself is reachable on its IP, you just can't talk to it through Home. Tap the optional **Reconnect HomeKit** switch (when `enableReconnectHKButton` is on) to cycle ratgdo's WiFi and force HomeSpan to re-attach. Ratgdo log will show `WiFi disconnected → WiFi connected → mDNS advertised`. iOS usually un-greys the accessory within ~10s. Requires firmware ≥ v3.4.4-forceclose.16.

- **Where to look at logs.** Homebridge: `sudo hb-service logs`. ratgdo's own log: `http://YOUR-RATGDO-IP/showlog`. The plugin logs each step of the close sequence with `[Force Close Garage]` prefixes (or whatever name you configured).

- **Cooldown active error.** You tapped the switch too soon after the previous tap. Wait for the configured `cooldownMs` to elapse. Default is 20 seconds.

- **HomeKit Home app still shows "Open" after a successful Force Close.** The door is actually closed — ratgdo updates its `target_door_state` HomeKit characteristic correctly when our plugin issues the close, but iOS Home app aggressively caches accessory state and doesn't always refresh the UI when changes come from outside HomeKit's command path (i.e., from the plugin's HTTP POST instead of a tap on the regular ratgdo tile). To force a refresh: pull down on the room view in the Home app, or kill and reopen the app. This is an iOS Home app limitation, not a plugin or ratgdo firmware bug. Verified by checking ratgdo's internal log — `Door state changing from Closing to Closed (target Closed)` confirms the notify path fired, the iOS UI just hadn't pulled the update.

## Releasing (maintainer notes)

Releases are published to npm automatically by [`.github/workflows/publish.yml`](.github/workflows/publish.yml) when a tag matching `v*` is pushed. To cut a release:

```bash
# 1. Bump "version" in package.json (e.g. 1.0.0 → 1.0.1) and commit
git commit -am "Release v1.0.1"

# 2. Tag the commit
git tag v1.0.1

# 3. Push both
git push && git push --tags
```

The workflow then runs `npm publish --access public --provenance` against the tagged commit. The `--provenance` flag attaches a build attestation that links the npm tarball back to the exact GitHub Actions run, visible as an "Attested" badge on the npm package page.

The workflow refuses to publish if the git tag version doesn't match `package.json` — that's a guard against tagging `v1.0.2` while forgetting to bump `package.json`, which would leave the registry and git history out of sync.

You can also trigger the workflow manually from the **Actions** tab via `workflow_dispatch` (publishes whatever's currently in `package.json`).

**Authentication:** the workflow uses [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers) — no `NPM_TOKEN` secret in GitHub. Instead, npm is configured to trust this specific repo + workflow combination via OIDC, and GitHub Actions issues a short-lived OIDC token at run time. There's no long-lived secret to leak or rotate.

**One-time setup** (after the workflow lands on `main`):

1. Go to https://www.npmjs.com/package/homebridge-ratgdo-forceclose/access
2. Scroll to **Trusted Publisher** → **Add trusted publisher**
3. Choose **GitHub Actions** and fill in:
   - Organization or user: `Haglerd`
   - Repository: `homebridge-ratgdo-forceclose`
   - Workflow filename: `publish.yml`
   - Environment name: *(leave blank unless you set up a deployment environment)*
4. Save.

That's it. Push a `v*` tag and the workflow publishes — no secrets configured anywhere.

## Plugin architecture (for Verified-plugin reviewers)

This is a **static accessory plugin** (`pluginType: accessory`) rather than a dynamic platform. The choice is deliberate:

- One ratgdo per garage; users have one IP / one accessory. No discovery is needed (or possible without rewriting the firmware) — config is explicit per accessory block.
- Existing pairings keep their HomeKit accessory identifiers across plugin upgrades because static accessories don't manipulate cached UUIDs.
- The accessory exposes a single primary service (GarageDoorOpener by default, Switch in legacy mode) plus optional secondary services (Reboot, Obstruction sensor, Motion sensor) that compose well as a single HomeKit accessory tile group.

If you operate multiple ratgdo doors, add multiple accessory entries in your Homebridge `config.json` — each with its own `name` and `ratgdoHost`. There is no platform-level state shared between them.

## Support

Issues, feature requests, and questions: **<https://github.com/Haglerd/homebridge-ratgdo-forceclose/issues>**

When opening an issue, please include:

- Plugin version (`homebridge-ratgdo-forceclose@x.y.z`)
- Homebridge version + Node version
- ratgdo firmware version (visible at the top of `http://<ratgdo-ip>/`)
- The relevant section of your Homebridge log around the failure
- Whether you're on the [Haglerd/homekit-ratgdo32 fork firmware](https://github.com/Haglerd/homekit-ratgdo32) (recommended) or vanilla upstream

For ratgdo *firmware* issues (not plugin issues): the firmware fork lives at <https://github.com/Haglerd/homekit-ratgdo32> and has its own issue tracker. The two repos are separate; use the one that matches your problem.

This is a personal-time project; expect best-effort response within a few days. PRs welcome.

## License

MIT — see [LICENSE](LICENSE).

## Disclaimer

This plugin is not affiliated with ratgdo, Paul Wieland, Chamberlain, Liftmaster, Apple, or Homebridge. The author provides no warranty and assumes no liability for property damage, injury, or other consequences of using this software (see the LICENSE file for the full terms). Use at your own risk, and only with a clear line of sight to the door.
