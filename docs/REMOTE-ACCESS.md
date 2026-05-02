# Remote Access — Force Close from Anywhere

How to fire the force-close action when you're **not on your home Wi-Fi**, without exposing ratgdo to the public internet.

This document covers two safe paths:

1. **Homebridge plugin + a HomeKit hub** — the simplest option if you already have a HomePod or Apple TV.
2. **Tailscale on a Pi (or cheaper equivalent)** — bring your own VPN home. Works for everything on your LAN, not just ratgdo.

It also explicitly rules out the *unsafe* path (port forwarding ratgdo to the public internet) and explains why.

---

## Safety reminder — applies to everything below

Force-close suppresses the obstruction sensor for ~18 seconds. Remote access magnifies the consequences if you fire it without eyes on the door. Two non-negotiable rules regardless of which option you pick:

- **Don't put force-close in an unattended automation** (scheduled, geofence, "close at 10pm", etc.). The Shortcut version has no cooldown; the plugin has one but it's there to stop fat-finger re-triggers, not to make unattended firing safe.
- **Don't expose ratgdo's HTTP port to the public internet.** Not via eero port forwarding, not via Cloudflare Tunnel without strong auth, not "just for a minute." ratgdo's web UI was not built to live on the open internet, and your garage is a physical-security boundary.

Remote access is for situations like *"I'm in the driveway and the photo eye is glitching"* — not for *"from work, why not."*

---

## Option 1 — Homebridge plugin + HomeKit hub

### When this is right
- You already have a **HomePod, HomePod mini, or Apple TV (4th gen+)** at home (your HomeKit hub).
- You have something to run Homebridge on (Pi, NAS, mini PC, old laptop).
- You want force-close to behave like a native HomeKit switch — controllable from the Home app, Siri, automations, family sharing.

### How it works
1. Install this plugin (`homebridge-ratgdo-forceclose`) on your Homebridge instance.
2. Configure ratgdo's IP/credentials in the plugin config.
3. The plugin exposes "Force Close Garage" as a HomeKit switch.
4. Your HomeKit hub relays Home app commands from anywhere via Apple's iCloud Home relay.

### iOS Shortcut wrapper (optional)
You can still pin a tile / Siri phrase / Control Center button — just have the Shortcut use the **"Control Home"** action targeting the plugin's switch instead of POSTing to ratgdo directly. That way the same UX as the LAN-only Shortcut, but it works remotely.

### What you get for free
- Cooldown guard (the plugin won't double-fire).
- Digest auth support — you can keep ratgdo's "Require Password" turned **on**.
- Error recovery — if the third "restore obstFromStatus" POST fails, the plugin retries.
- Family sharing via Home — household members can see/use the switch without building anything themselves.

### What it doesn't solve
You still need to be the one tapping it. **Don't** wire it into a HomeKit automation that fires unattended.

---

## Option 2 — Tailscale on a Pi (recommended for "bring your own VPN home")

### When this is right
- You don't have a HomeKit hub, OR
- You want secure remote access to **everything** on your LAN (eero admin page, NAS, smart cameras, Homebridge UI, Pi-hole, etc.) — not just ratgdo, OR
- You want defense-in-depth: VPN-only network reachability **plus** ratgdo's digest auth on top.

### Why Tailscale specifically
- WireGuard under the hood (modern, fast, audited).
- NAT-traversed — works behind eero with **no port forwarding**.
- Identity-based auth via Google/Apple/GitHub/Microsoft + your existing 2FA.
- Free for personal use up to 100 devices.
- The Pi acts as a **subnet router**, so you don't need to install Tailscale on every LAN device — your phone joins the tailnet, and the Pi gateways traffic to your home subnet.

### Hardware: the Pi at home

Use any Pi that's already always-on. If buying fresh, a Pi Zero 2 W (~$15 plus PSU/SD/case = ~$30 total) is enough — Tailscale subnet routing barely uses any CPU.

### Setup steps

#### 1. Install Tailscale on the Pi

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up \
  --advertise-routes=192.168.X.0/24 \
  --accept-routes \
  --ssh
```

Replace `192.168.X.0/24` with your actual home subnet (`ip route` will show it).

In the Tailscale admin console (https://login.tailscale.com/admin):
**Machines → your Pi → Edit route settings → approve the advertised route.** This is a manual step on purpose; routes are off by default for safety.

#### 2. Install Tailscale on your phone

Install the **Tailscale** app from the App Store, sign in with the same identity, toggle the VPN on. From now on:
- On home Wi-Fi: traffic flows directly over LAN.
- On cellular: traffic flows over Tailscale → Pi → ratgdo.

#### 3. Update the Shortcut (or don't — it just works)

The existing Shortcut from `shortcut/README.md` keeps working as-is once Tailscale is on. The URL `http://192.168.X.Y/setgdo` resolves over Tailscale when you're remote, over LAN when you're home. No edits needed.

(Optional: enable **MagicDNS** in the Tailscale admin and use a stable hostname instead of an IP.)

### Hardening checklist

This is the part that earns the "super safe" label. Skipping items here defeats the purpose.

#### Tailscale account (the front door)

- [ ] Sign up using an identity provider with **hardware-key 2FA**: Google or Apple ID with a passkey/YubiKey, or GitHub with 2FA. This is the single most important control — a compromised Tailscale account = a compromised tailnet.
- [ ] Enable **Tailnet Lock** (admin → Settings → Tailnet lock). Prevents any new device from joining your tailnet without your locally-stored signing key, **even if your Tailscale account is compromised.**
- [ ] Set device key expiry: **180 days for phones, disabled for the Pi**. Phones get a periodic re-auth as defense-in-depth; the Pi is unattended and shouldn't drop offline silently.
- [ ] Lock down ACLs in admin → Access controls. Minimum policy:

  ```json
  {
    "acls": [
      { "action": "accept", "src": ["YOUR_EMAIL@example.com"], "dst": ["192.168.X.0/24:*"] }
    ],
    "ssh": [
      { "action": "accept",
        "src": ["autogroup:member"],
        "dst": ["autogroup:self"],
        "users": ["autogroup:nonroot"] }
    ]
  }
  ```

  Only your account can hit your home subnet, and Tailscale SSH only allows you to your own machines as a non-root user.

#### Pi hardening

- [ ] **SSH: key-only auth, no passwords.** In `/etc/ssh/sshd_config`: `PasswordAuthentication no`, `PermitRootLogin no`. Restart sshd.
- [ ] **Better: bind sshd to the tailnet interface only.** `ListenAddress` set to the Pi's `tailscale0` IP. Now SSH literally cannot be reached from your LAN — only over Tailscale.
- [ ] **UFW firewall**, default-deny inbound, allow only what you need on the LAN side. Tailscale traffic is on its own interface and is unaffected.
- [ ] **Unattended security updates**:
  ```bash
  sudo apt install unattended-upgrades
  sudo dpkg-reconfigure --priority=low unattended-upgrades
  ```
- [ ] Use **Tailscale SSH** (the `--ssh` flag in step 1) instead of plain sshd if you can — identity-checked, audit-logged, tied to your Tailscale identity.
- [ ] **Never** open eero port forwarding to ratgdo. Tailscale removes the need.

#### ratgdo

- [ ] Turn on **"Require Password"** in ratgdo settings. The Homebridge plugin handles digest auth — let it. Belt-and-suspenders: VPN-only network reachability **plus** digest auth on the device itself = two independent locks.

#### Phone

- [ ] Lock screen passcode/biometric (you almost certainly have this).
- [ ] If you set up the "Hey Siri, force close garage" phrase: be aware anyone holding your unlocked phone can fire it. If that worries you, remove the Siri phrase and keep it as a tap-only Shortcut.

---

## Cheaper than a Pi (and great for a vacation home)

If you're setting up a **second site** — vacation home, parents' house, rental — a Pi isn't necessarily the best tool. Three credible options:

### 1. GL.iNet travel router — ~$25–35 *(recommended for second sites)*

- **GL-MT300N-V2 "Mango"** — ~$25
- **GL-AR300M16** — ~$30
- **GL-MT3000 "Beryl AX"** — ~$80 (Wi-Fi 6, more horsepower if you want it to also be the site's main router)

These are tiny OpenWrt routers with **Tailscale built into the web UI** — flip a toggle, sign in, advertise routes, done. No Linux setup, no SD card to corrupt.

Why they're often *better* than a Pi for a vacation home:
- **Fanless, ~1W idle.** Set-and-forget for years.
- **No SD-card filesystem** — survives flaky vacation-home power without corruption.
- **Plug into the existing router via Ethernet** and it bridges that whole LAN onto your tailnet. From anywhere, you can reach anything at the second site — garage, cameras, smart locks, thermostat — same model as home.
- **Same Tailscale account, same ACLs**, same security posture as your primary site. Your phone sees both LANs and routes to whichever has the device.

Setup mirrors the Pi steps: enable Tailscale in the GL.iNet admin UI, advertise the local subnet, approve the route in the Tailscale admin console.

### 2. Apple TV as a Tailscale subnet router — $0 if you have one

Tailscale released a **tvOS app** in late 2024 that can act as a subnet router. If a vacation home already has an Apple TV, it can pull double duty as both the HomeKit hub and the Tailscale gateway. Caveats:

- tvOS subnet routing is newer and less battle-tested than Linux.
- tvOS may background the app under memory pressure.

For low-stakes "I want to peek at the cameras from the road," fine. For *"I really need force-close to work when I'm 1,000 miles away,"* I'd still pick the GL.iNet — dedicated hardware, no OS scheduler fighting you.

### 3. Anything always-on you already own

Synology / QNAP NAS, smart-home hub running Linux, old Mac mini in a closet — install Tailscale, advertise the subnet, free. Two warnings:

- **Power draw matters.** A 30W mini PC running 24/7 costs more in electricity per year ($30–100 depending on local rates) than a $25 GL.iNet would cost upfront. "Free hardware" isn't always free.
- **Keep it patched.** If it's old enough that you forgot it existed, it's old enough that you forgot to update it. Add it to unattended-upgrades or equivalent.

### What to skip

- **Old phone as a Tailscale node.** Subnet routing isn't supported on iOS at all and is unreliable on Android. Works for a single endpoint, not for "reach my whole LAN."
- **eero running Tailscale.** eero firmware is locked down — no plugin system, no VPN server. Some routers do support this (Asus Merlin, Synology, OpenWrt) but not eero.
- **Cheap no-name SBCs** (Orange Pi, Le Potato, etc.). Same price as a Pi by the time you add SD/PSU/case, with worse documentation. No real win.
- **Cloud VPS.** Gives you remote access *to a server*, not to your LAN. Wrong tool for this problem.
- **Port forwarding ratgdo to the internet.** Already covered. Don't.

---

## Recommended setup matrix

| Sites | Hardware | Software |
|---|---|---|
| Single site, have HomePod/Apple TV | Pi (or any always-on) running Homebridge | This plugin + Home app + (optional) Shortcut wrapper using "Control Home" |
| Single site, no HomeKit hub | Pi running Tailscale subnet router | Tailscale on phone + LAN-IP Shortcut |
| Two sites (home + vacation) | Home: existing Pi. Vacation: GL.iNet Mango (~$25) | Tailscale on both, ACLs scoped to your identity, Tailnet Lock enabled |
| Two sites + want HomeKit-native | Home: Pi w/ Homebridge + HomePod. Vacation: GL.iNet + this plugin running on it (or skip plugin and use Tailscale-only LAN-IP Shortcut) | Plugin handles digest auth at both sites |

---

## Quick troubleshooting

- **Shortcut times out on cellular.** Tailscale isn't connected. Open the Tailscale app, confirm the toggle is on. iOS sometimes drops the VPN under battery pressure.
- **Tailscale connected but ratgdo unreachable.** Subnet route not approved in the admin console — that step is easy to forget. Go to Machines → your Pi → Edit route settings.
- **Works at home, fails remote.** Phone is using LAN DNS. Either use the IP directly (works), or enable MagicDNS so the hostname resolves over Tailscale.
- **`401 Unauthorized` over Tailscale.** ratgdo "Require Password" is on and you're hitting it from the Shortcut version (no digest auth). Use the Homebridge plugin instead, or temporarily disable the password.
- **GL.iNet won't connect.** Make sure the WAN port is plugged into the upstream router and the device has internet. Tailscale needs outbound 41641/UDP (and falls back to TCP/443 if blocked) — most home networks are fine.

---

## What this document does NOT cover

- Setting up Homebridge itself (see [Homebridge docs](https://homebridge.io/)).
- Tailscale exit-node mode (route *all* phone traffic through home — different use case).
- Self-hosting Headscale (the open-source Tailscale control plane). Overkill for two sites.
- Site-to-site mesh between home and vacation home for inter-site traffic. Tailscale supports it, but it's not needed for the force-close use case — your phone is the only client that needs to reach either site.
