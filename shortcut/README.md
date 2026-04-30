# HomeKit Shortcut Version

The no-Homebridge alternative. If you don't run Homebridge but want the same "force close" behavior, you can build this in the iOS Shortcuts app in about five minutes. It fires the same three-POST sequence the plugin uses — temporarily set ratgdo's `obstFromStatus` to `true`, send close, restore `obstFromStatus` to `false` — directly from your iPhone or iPad over the local network.

## When to use the Shortcut vs. the plugin

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

## Limitations of the Shortcut

- **Local network only.** The Shortcut talks to your ratgdo's IP directly. There is no HomeKit hub in the path, so it does **not** work over cellular or away from home Wi-Fi. If you need remote-access force close, use the Homebridge plugin.
- **No digest auth.** The Shortcuts app's "Get Contents of URL" action can attach Basic auth headers but not the challenge/response flow ratgdo's web auth uses. **If you have enabled "Require Password" on ratgdo's settings page, the Shortcut will not work** — disable that, or use the plugin instead (the plugin handles digest auth).
- **No cooldown.** Unlike the plugin, the Shortcut will fire the full three-POST sequence every time you tap it, with no guard against fat-finger re-triggers. Tap with intent.
- **Each device builds its own.** iCloud-synced shortcuts work on your devices, but other people in your household have to build it themselves on their own iPhones (or you can share via AirDrop / Messages once you've built it once).

## Safety warning

> **This Shortcut bypasses the obstruction sensor's effect on ratgdo.** Only run it when you can directly see the door and have confirmed nothing is in the path. The obstruction sensor exists for a reason — it stops a closing door from crushing pets, children, or property. Running this Shortcut is the equivalent of holding the wall-control button down: the safety check is suppressed for the duration of the close.
>
> **Do not put this Shortcut in an automation, scene, or trigger that runs without you watching.** There is no cooldown in the Shortcut version. Tap with intent, and only when you have eyes on the door.
>
> If your photo eye is being false-tripped frequently enough that you need this Shortcut, consider also installing a sun shroud or hood over the receiver eye — that's the actual fix.

## Build the Shortcut step-by-step

> Replace `YOUR-RATGDO-IP` everywhere below with your ratgdo's actual IP address (or hostname). Find it on your router's DHCP client list, or by visiting ratgdo's settings page from a known device.

### 1. Open Shortcuts → New Shortcut

1. Open the **Shortcuts** app on your iPhone or iPad.
2. Tap the **+** in the top right to create a new shortcut.
3. Tap the title bar (currently "New Shortcut") and rename it to **Force Close Garage**.

### 2. Add Action #1 — set obstFromStatus to `true`

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
   - Key: `obstFromStatus`
   - Value: `true`

### 3. Add a 1-second wait

1. Tap **Add Action** below action #1.
2. Search for **Wait**, tap to add.
3. Set the wait duration to **1 second**.

This gives the firmware a beat to apply the new setting before we send close.

### 4. Add Action #2 — send close (`garageDoorState=0`)

1. Tap **Add Action**.
2. Add another **Get Contents of URL**.
3. Same URL: `http://YOUR-RATGDO-IP/setgdo`
4. Method: **POST**
5. Same `Content-Type: application/x-www-form-urlencoded` header.
6. Form body field:
   - Key: `garageDoorState`
   - Value: `0`

### 5. Add an 18-second wait

1. Tap **Add Action**.
2. Add another **Wait**, set to **18 seconds**.

This is the full close-cycle window. If your door takes longer to fully close, increase this number (use the value from your ratgdo's status page if you want to be precise).

### 6. Add Action #3 — restore `obstFromStatus` to `false`

1. Tap **Add Action**.
2. Add the third and final **Get Contents of URL**.
3. Same URL: `http://YOUR-RATGDO-IP/setgdo`
4. Method: **POST**
5. Same `Content-Type` header.
6. Form body field:
   - Key: `obstFromStatus`
   - Value: `false`

### 7. (Optional) Add visible confirmation

If you want a notification when the sequence finishes, append a **Show Notification** action with a message like "Force close sequence complete." This is purely cosmetic — the door is already closed by then.

### 8. Save and place the Shortcut where you want it

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
5. Watch the log: you should see three `POST /setgdo` entries in quick succession — first `obstFromStatus=true`, then `garageDoorState=0`, then (after ~18 seconds) `obstFromStatus=false`.
6. The door should close and stay closed.
7. After the sequence completes, refresh ratgdo's settings page and confirm "Get obstruction from GDO status messages" is **unchecked** (the original state). If it's still checked, the third POST didn't land — uncheck it manually and check your network/Shortcuts app for clues.

## Troubleshooting

- **Shortcut fails immediately on the first POST.** Confirm `YOUR-RATGDO-IP` is reachable from the device — open `http://YOUR-RATGDO-IP/` in Safari first. If that loads, the Shortcut should work. If it doesn't, you're either on the wrong Wi-Fi network or the IP has changed (DHCP renewal).
- **Shortcut runs but the door doesn't close.** Same as the plugin: the obstruction is being seen at the opener level, not just propagated through ratgdo. Sun shroud over the photo eye is the real fix; alternatively, edit the Shortcut to use `pinBasedObst` with inverted booleans (`pinBasedObst=false` before close, `pinBasedObst=true` after — this tells ratgdo to stop reading the obstruction pin entirely instead of just changing the source).
- **`401 Unauthorized` errors.** You have ratgdo's "Require Password" enabled. The Shortcut version cannot handle digest auth. Either disable "Require Password" in ratgdo's settings, or switch to the Homebridge plugin (which does handle digest auth).
- **Door closes but obstFromStatus stays `true`.** The third POST didn't fire (timeout, network blip, etc.). Visit ratgdo's settings page and uncheck **"Get obstruction from GDO status messages"** manually. The Shortcut has no error-recovery `finally` block like the plugin does — if you find this happens often, switch to the plugin.

## Screenshots

Screenshots of the Shortcut build steps will be added to [`screenshots/`](screenshots/) in a future update.
