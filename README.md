# homebridge-ratgdo-forceclose

A momentary HomeKit switch that does exactly this on tap:

1. POST `obstFromStatus=true` to `/setgdo` (tells ratgdo to ignore the sensor pin and use GDO status messages — sun glare on the receiver eye no longer false-trips)
2. POST `garageDoorState=0` to `/setgdo` (close)
3. Wait for the door to finish closing (default 18s)
4. POST `obstFromStatus=false` to `/setgdo` (restore normal pin-based obstruction detection)

If step 2 or 3 throws, step 4 still runs in a `finally` block so you don't end up with a stuck-bypassed setting.

## Why this works

ratgdo has a settings-page checkbox: **"Get obstruction from GDO status messages"** (JSON key `obstFromStatus`). When unchecked (default), ratgdo reads obstruction state from the sensor wire pin — and that pin gets false-tripped by direct sun on the photo eye receiver. When checked, ratgdo only listens for obstruction in the GDO's status messages, which won't see the sun-flare false alarm.

## Install

```bash
cd ~/.homebridge          # or wherever your Homebridge config lives
npm install /path/to/homebridge-ratgdo-forceclose
```

Restart Homebridge. The plugin will show up as "Ratgdo Force Close" in the Homebridge UI.

## Config

```json
{
  "accessories": [
    {
      "accessory": "RatgdoForceClose",
      "name": "Force Close Garage",
      "ratgdoHost": "http://192.168.1.50",
      "settingKey": "obstFromStatus",
      "bypassValue": true,
      "normalValue": false,
      "closeWaitMs": 18000,
      "cooldownMs": 20000
    }
  ]
}
```

If you've enabled "Require Password" on ratgdo's settings page, also include:

```json
"username": "admin",
"password": "your-password-here"
```

The plugin handles digest auth (which is what ratgdo uses).

## Reference

| Key | Default | Notes |
|---|---|---|
| `name` | `Force Close Garage` | HomeKit name |
| `ratgdoHost` | — | required, e.g. `http://192.168.1.50` |
| `username` / `password` | — | only if ratgdo requires auth |
| `settingKey` | `obstFromStatus` | swap to `pinBasedObst` and flip the bypass/normal booleans if you want the inverse setting instead |
| `bypassValue` | `true` | value POSTed before close |
| `normalValue` | `false` | value POSTed after close |
| `closeWaitMs` | `18000` | should exceed your `closeDuration` |
| `cooldownMs` | `20000` | min ms between consecutive force-closes |

## If `obstFromStatus=true` doesn't make the door close

Then the actual obstruction is still being seen by the opener itself, not just propagated through ratgdo. In that case set:

```json
"settingKey": "pinBasedObst",
"bypassValue": false,
"normalValue": true
```

If neither works, the photo eye is being blinded at the hardware level and only the held-wall-button trick (or a sun shroud over the eye) will get past it. At that point you'd need a smart relay wired across the wall button — different problem, different plugin.

## Safety

This bypasses an obstruction safety mechanism at the controller level. Only use it when you can see the door and confirm there's nothing in the way. Don't put this in an automation. The cooldown prevents rapid re-triggering but it's not a substitute for paying attention.
