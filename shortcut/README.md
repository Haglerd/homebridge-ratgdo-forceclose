# HomeKit Shortcut Version

The no-Homebridge alternative. If you don't run Homebridge but want the same force-close behavior, you can build this in the iOS Shortcuts app in about two minutes. It fires a single POST to your ratgdo's `/setgdo` endpoint with `forceClose=1`, which triggers the firmware's wall-button hold-to-close override.

> **Requires the [Haglerd/homekit-ratgdo32](https://github.com/Haglerd/homekit-ratgdo32) firmware fork** (any release ≥ `v3.4.4-forceclose.1`). The stock upstream ratgdo32 firmware does not implement the `forceClose` key. Flash the fork first; one-tap OTA from the ratgdo dashboard.

## When to use the Shortcut vs. the plugin

| Feature | Homebridge Plugin | HomeKit Shortcut |
|---|---|---|
| Appears as a HomeKit switch in the Home app | Yes | No (lives in Shortcuts app, can be added to home screen / Siri / Control Center) |
| Works from outside your local network (cellular, etc.) | Yes (via HomeKit hub) | No (LAN only) |
| Shared with everyone in your Home automatically | Yes | No (each user builds their own) |
| Requires Homebridge running on a Pi/server | Yes | No |
| Setup time | ~10 min (install npm pkg, edit config) | ~2 min (build in Shortcuts app) |
| Supports ratgdo "Require Password" (digest auth) | Yes | No |
| Triggerable by Siri / HomePod | Indirectly (via Home app voice) | Directly ("Hey Siri, force close garage") |

## Limitations of the Shortcut

- **Local network only.** The Shortcut talks to your ratgdo's IP directly. There is no HomeKit hub in the path, so it does **not** work over cellular or away from home Wi-Fi. If you need remote-access force close, use the Homebridge plugin.
- **No digest auth.** The Shortcuts app's "Get Contents of URL" action can attach Basic auth headers but not the challenge/response flow ratgdo's web auth uses. **If you have enabled "Require Password" on ratgdo's settings page, the Shortcut will not work** — disable that, or use the plugin instead (the plugin handles digest auth).
- **Each device builds its own.** iCloud-synced shortcuts work on your devices, but other people in your household have to build it themselves on their own iPhones (or you can share via AirDrop / Messages once you've built it once).

## Safety warning

> **This Shortcut bypasses the obstruction sensor's effect on ratgdo.** Only run it when you can directly see the door and have confirmed nothing is in the path. The obstruction sensor exists for a reason — it stops a closing door from crushing pets, children, or property.
>
> **Do not put this Shortcut in an automation, scene, or trigger that runs without you watching.** Tap with intent, and only when you have eyes on the door.
>
> If your photo eye is being false-tripped frequently enough that you need this Shortcut, consider also installing a sun shroud or hood over the receiver eye — that's the actual fix.

## Build the Shortcut step-by-step

> Replace `YOUR-RATGDO-IP` below with your ratgdo's actual IP address (or hostname). Find it on your router's DHCP client list, or by visiting ratgdo's settings page from a known device.

### 1. Open Shortcuts → New Shortcut

1. Open the **Shortcuts** app on your iPhone or iPad.
2. Tap the **+** in the top right to create a new shortcut.
3. Tap the title bar (currently "New Shortcut") and rename it to **Force Close Garage**.

### 2. Add the single force-close POST

1. Tap **Add Action**.
2. Search for **Get Contents of URL**, tap to add.
3. Tap the small **▸** arrow on the action to expand its options.
4. Set the URL field to: `http://YOUR-RATGDO-IP/setgdo`
5. Set **Method** to **POST**.
6. Under **Headers**, tap **Add new header**:
   - Key: `Content-Type`
   - Value: `application/x-www-form-urlencoded`
7. Set **Request Body** to **Form**.
8. Under the form, tap **Add new field**:
   - Key: `forceClose`
   - Value: `1`

That's it for the action — one POST does the whole hold-to-close sequence on the firmware side.

### 3. (Optional) Add visible confirmation

If you want a notification when the request is acknowledged, append a **Show Notification** action with a message like "Force close sequence sent." The actual close takes ~12 seconds after the POST returns; the firmware drives the wall-button hold timing.

### 4. Save and place the Shortcut where you want it

Tap **Done** to save. From the Shortcut's detail view (long-press it on the All Shortcuts screen, or tap the **ⓘ**) you can:

- **Add to Home Screen** — places a tappable icon on your iOS home screen, which makes the Shortcut behave like an app icon.
- **Use with Siri** — set a custom phrase ("Force close garage") so you can fire it hands-free with "Hey Siri, force close garage."
- **Pin in Control Center** — Settings → Control Center → add **Shortcut** controls, then pin "Force Close Garage" so it's available on the Control Center swipe.
- **Share via AirDrop / Messages** — send a copy to family members so they don't have to build it themselves.

## How to test

1. Open the garage door normally (Home app, wall button, whatever you usually use).
2. Confirm visually that nothing is in the door's path.
3. In a separate browser tab, open `http://YOUR-RATGDO-IP/showlog` so you can watch the live log.
4. Run the Shortcut.
5. Watch the log: you should see `FORCE CLOSE: starting 2-attempt sequence (hold=3500ms, gap=1500ms)` followed by `attempt 1/2 — press for 3500ms`. Most doors close on attempt 1 and the firmware skips attempt 2 automatically.
6. The door should close and stay closed.

## Troubleshooting

- **Shortcut fails immediately on the first POST.** Confirm `YOUR-RATGDO-IP` is reachable from the device — open `http://YOUR-RATGDO-IP/` in Safari first. If that loads, the Shortcut should work. If it doesn't, you're either on the wrong Wi-Fi network or the IP has changed (DHCP renewal).
- **Shortcut runs but the door doesn't close, and the log shows `FORCE CLOSE: hold-to-close override only meaningful on Sec+1.0; falling back to normal close`.** Your opener is on Security+ 2.0 (or Dry Contact). Force-close is a Sec+1.0-only feature; the firmware just sends a normal close on those protocols. The plugin and Shortcut are still safe to run, but they don't bypass the photo-eye on those protocols.
- **`401 Unauthorized` errors.** You have ratgdo's "Require Password" enabled. The Shortcut version cannot handle digest auth. Either disable "Require Password" in ratgdo's settings, or switch to the Homebridge plugin (which does handle digest auth).
- **`403 Forbidden: cross-origin`.** Firmware ≥ `v3.4.4-forceclose.14` rejects cross-origin POSTs as a CSRF guard. Shortcuts requests don't send an Origin header so they should always be accepted, but if you see this, double-check you're not running the request through a proxy or service worker that's adding headers.
- **No `FORCE CLOSE` lines in the log at all, just an HTTP 200 reply.** You're on stock upstream firmware that doesn't implement `forceClose`. Flash [the fork](https://github.com/Haglerd/homekit-ratgdo32) first.

## Screenshots

Screenshots of the Shortcut build steps will be added to [`screenshots/`](screenshots/) in a future update.
