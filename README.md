# homebridge-ratgdo-forceclose

A Homebridge plugin that adds a momentary "Force Close" switch for [ratgdo](https://paulwieland.github.io/ratgdo/)-controlled garage doors, for cases when sun glare on the photo eye blocks normal HomeKit close.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## What this is

A Homebridge accessory plugin that exposes a single momentary switch in HomeKit. On tap, it tells your ratgdo to ignore the obstruction sensor pin (briefly), sends the close command, waits for the door to finish closing, and then restores the original setting. The plugin uses ratgdo's existing `/setgdo` HTTP endpoint — no firmware modifications required.

It's not a replacement for HomeKit's normal garage-door integration. You should still use the regular ratgdo plugin (or HomeKit's native ratgdo support) for everyday open/close. This plugin only exists for the situation where the door **won't** close because the obstruction sensor is being false-tripped.

## Two ways to use this

This repo offers two delivery mechanisms for the same underlying behavior:

- **Homebridge plugin** (the rest of this README) — full HomeKit integration with a tappable switch in the Home app, remote access via your HomeKit hub, configurable cooldown, optional digest auth.
- **HomeKit Shortcut** — no Homebridge required; build a one-off button in the iOS Shortcuts app that fires the same three-POST sequence over the local network. Build instructions: [`shortcut/README.md`](shortcut/README.md).

Both options do exactly the same thing on ratgdo's side. See the comparison table further down to pick which one fits your setup.

## The problem it solves

Liftmaster and Chamberlain garage doors have an infrared photo-eye safety sensor at the bottom of the rails. The receiving eye can be blinded by direct sunlight at low sun angles (typically morning or late afternoon depending on which way your garage faces). When that happens, the opener registers a false obstruction and refuses to close.

ratgdo respects that obstruction signal and will not send a close command while the obstruction flag is asserted. This is correct, safe default behavior — but it means HomeKit-initiated closes silently fail during sun-glare windows.

The traditional workaround is to walk to the garage and **hold** the wall control button until the door closes (which bypasses the photo eye on most opener models). This plugin gives you a HomeKit-tappable software equivalent: it temporarily changes ratgdo's obstruction-source setting from "the sensor pin" to "GDO status messages" — the GDO itself isn't false-tripped, only the wire from the photo eye is — sends the close, then restores the setting.

## Compatibility

- Works with any ratgdo running [homekit-ratgdo](https://paulwieland.github.io/ratgdo/) or [homekit-ratgdo32](https://github.com/sonic1015/homekit-ratgdo32) firmware that exposes the `/setgdo` HTTP endpoint and the `obstFromStatus` setting.
- Tested on Security+ 1.0 with homekit-ratgdo32 v3.4.4.
- Should work on Security+ 2.0 too but has not been verified.
- Requires Homebridge 1.6+ and Node.js 18+.

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

### Method 1 — Homebridge UI (recommended)

If you use the Homebridge Config UI X, you can install directly from GitHub without dropping to the shell:

1. Open the Homebridge UI in your browser.
2. Go to the **Plugins** tab.
3. Open the search bar's three-dot menu and choose **Install `[email protected]:Haglerd/homebridge-ratgdo-forceclose`** (or paste the GitHub URL in the search box if your UI version supports URL search).
4. Once installed, click the plugin's **Settings** (cog) icon and fill in `ratgdoHost` (and `username` / `password` if your ratgdo requires auth).
5. Save, then restart the child bridge (or Homebridge itself) using the prompt at the top of the UI.

After restart, the **Force Close Garage** switch appears in the Home app under the Homebridge bridge.

### Method 2 — Install directly from GitHub via CLI

```bash
sudo npm install -g github:Haglerd/homebridge-ratgdo-forceclose
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

- **Via Homebridge UI:** Plugins tab → click the plugin's **Update** button when one is available. The UI re-fetches the latest from GitHub.
- **Via CLI:** `sudo npm update -g homebridge-ratgdo-forceclose && sudo hb-service restart`. If you installed via Method 2, npm will pull the latest from the GitHub URL recorded in the install metadata.

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

### Full config

```json
{
  "accessories": [
    {
      "accessory": "RatgdoForceClose",
      "name": "Force Close Garage",
      "ratgdoHost": "http://192.168.1.50",
      "username": "admin",
      "password": "your-password-here",
      "settingKey": "obstFromStatus",
      "bypassValue": true,
      "normalValue": false,
      "closeWaitMs": 18000,
      "cooldownMs": 20000
    }
  ]
}
```

### Configuration reference

| Key | Type | Default | Description |
|---|---|---|---|
| `name` | string | `"Force Close Garage"` | The HomeKit name for the switch. |
| `ratgdoHost` | string | *(required)* | Base URL of your ratgdo, e.g. `http://192.168.1.50`. The `http://` prefix is added if you omit it. |
| `username` | string | `null` | Only required if you've enabled "Require Password" in ratgdo's settings. |
| `password` | string | `null` | Paired with `username`. The plugin uses HTTP Digest auth (which is what ratgdo uses). |
| `settingKey` | string | `"obstFromStatus"` | Which ratgdo setting to toggle. Defaults to `obstFromStatus`. Switch to `pinBasedObst` and flip the bypass/normal booleans if the default doesn't work for your firmware. |
| `bypassValue` | boolean | `true` | Value POSTed to `settingKey` before the close command. For `obstFromStatus`: `true` = use status messages, ignore the pin (the sun-flare false trip). |
| `normalValue` | boolean | `false` | Value POSTed to `settingKey` after the close command — your normal pre-tap setting. |
| `closeWaitMs` | integer | `18000` | Milliseconds to wait between sending close and restoring `settingKey`. Should comfortably exceed your door's full close duration. Min `1000`, max `60000`. |
| `cooldownMs` | integer | `20000` | Minimum milliseconds between consecutive force-close triggers. Min `0`, max `120000`. |

## How it works

On every tap of the switch, the plugin runs a four-step POST sequence against ratgdo's `/setgdo` endpoint:

1. **`POST settingKey=bypassValue`** — temporarily change ratgdo's obstruction source. With the default `obstFromStatus=true`, this means "stop reading the sensor pin, only listen for obstruction in the GDO's own status messages." A short 300ms pause follows so the firmware has time to apply the new setting.
2. **`POST garageDoorState=0`** — the close command itself. Because the obstruction source has been swapped, the false-tripped pin no longer blocks ratgdo from issuing close.
3. **Wait `closeWaitMs`** — give the door time to finish its travel cycle. Default 18s is safe for most residential doors.
4. **`POST settingKey=normalValue`** — restore the original setting (default `obstFromStatus=false`, i.e. read obstruction from the pin again). This step runs in a `finally` block, so even if step 2 or 3 throws, the bypass setting is restored before the function returns. If step 4 itself fails, the plugin logs a CRITICAL warning telling you to restore the setting manually in ratgdo's web UI.

The setting being toggled (`obstFromStatus`) corresponds to the **"Get obstruction from GDO status messages"** checkbox on ratgdo's settings page. If you want to see what state your ratgdo is in, that's the field to check.

## Troubleshooting

- **The switch flips on and immediately flips off but the door doesn't move.** Check Homebridge logs (`sudo hb-service logs`) for a non-200 response from `/setgdo` or a digest-auth failure. If you've enabled "Require Password" on ratgdo, make sure `username` and `password` are set in the plugin config.

- **The switch fires the sequence but the door still doesn't close.** This means the obstruction is being seen by the opener itself, not just propagated through ratgdo. Try the inverse setting: change `settingKey` to `pinBasedObst` and flip the booleans — `bypassValue: false`, `normalValue: true`. That tells ratgdo "stop reading the obstruction pin entirely" instead of just changing the source.

- **Neither setting works.** The photo eye is being blinded at the hardware level — ratgdo can't help here because the obstruction signal is already locked in at the opener's logic board. The actual fix is a sun shroud or hood over the photo-eye receiver (search "garage door photo eye sun shield"). A piece of black PVC pipe works in a pinch.

- **Where to look at logs.** Homebridge: `sudo hb-service logs`. ratgdo's own log: `http://YOUR-RATGDO-IP/showlog`. The plugin logs each step of the four-step sequence with `[Force Close Garage]` prefixes (or whatever name you configured).

- **Cooldown active error.** You tapped the switch too soon after the previous tap. Wait for the configured `cooldownMs` to elapse. Default is 20 seconds.

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

**Required GitHub repo secret:** `NPM_TOKEN` — a granular access token with publish rights on this package and "Bypass 2FA" enabled. Set it once at **Settings → Secrets and variables → Actions → New repository secret**.

## License

MIT — see [LICENSE](LICENSE).

## Disclaimer

This plugin is not affiliated with ratgdo, Paul Wieland, Chamberlain, Liftmaster, Apple, or Homebridge. The author provides no warranty and assumes no liability for property damage, injury, or other consequences of using this software (see the LICENSE file for the full terms). Use at your own risk, and only with a clear line of sight to the door.
