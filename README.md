# homebridge-ratgdo-forceclose

A Homebridge plugin that adds a momentary "Force Close" switch for [ratgdo](https://paulwieland.github.io/ratgdo/)-controlled garage doors, for cases when sun glare on the photo eye blocks normal HomeKit close.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## What this is

A Homebridge accessory plugin that exposes a single momentary switch in HomeKit. On tap, it tells your ratgdo to ignore the obstruction sensor pin (briefly), sends the close command, waits for the door to finish closing, and then restores the original setting. The plugin uses ratgdo's existing `/setgdo` HTTP endpoint — no firmware modifications required.

It's not a replacement for HomeKit's normal garage-door integration. You should still use the regular ratgdo plugin (or HomeKit's native ratgdo support) for everyday open/close. This plugin only exists for the situation where the door **won't** close because the obstruction sensor is being false-tripped.

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

## License

MIT — see [LICENSE](LICENSE).

## Disclaimer

This plugin is not affiliated with ratgdo, Paul Wieland, Chamberlain, Liftmaster, Apple, or Homebridge. The author provides no warranty and assumes no liability for property damage, injury, or other consequences of using this software (see the LICENSE file for the full terms). Use at your own risk, and only with a clear line of sight to the door.
