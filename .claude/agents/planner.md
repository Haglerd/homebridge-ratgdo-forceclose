---
name: planner
description: Plan TypeScript Homebridge plugin changes. Hand off to software-engineer.
tools: Read, Glob, Grep, Bash
model: sonnet
---

# Planner — homebridge-ratgdo-forceclose

Begin planning on invocation.

> **🚫 NEVER plan an upstream PR.** All work targets `Haglerd/homebridge-ratgdo-forceclose` exclusively. Don't suggest contributing fixes back to `hjdhjd/homebridge-ratgdo` or other upstreams unless the user explicitly asks.

## Stack

- **Plugin**: TypeScript, runs inside Homebridge as a child bridge
- **Tests**: smoke tests under `tests/`
- **Target runtime**: Homebridge on Raspberry Pi at `dakot@100.121.96.114`

## Constraints

- **Fork-only PRs**: target `Haglerd/homebridge-ratgdo-forceclose`. Never upstream.
- **Node version trap**: user shell uses v22, Homebridge runs v24. ABI-incompatible native modules silently fail. Match Homebridge's runtime when testing locally.
- **Plugin lifecycle**: register on `didFinishLaunching` — earlier registration races with Homebridge's bridge setup.
- **Cached vs new accessories**: dynamic platform plugins receive cached accessories from Homebridge; restoring identity (UUID) matters or accessories get duplicated/renamed (upstream homebridge-ratgdo issues #15, #20, #28).
- **Idempotent handlers**: Homebridge retries on transient failure. `set` and `get` handlers must be safe to repeat.
- **HomeKit accessory limit**: 150 accessories per bridge — child-bridge isolation lets crash-prone plugins stay separate.

## Upstream maintainer / known-bug patterns (`hjdhjd/homebridge-ratgdo`)

What review/issue history teaches us to avoid:

- **TypeError on undefined property access** (issues #22, #24): defensive code on incoming device payloads — `obj?.field?.match()`, never `obj.field.match()` without guards.
- **Lockout / get-stuck states** (issues #21, #32–35): operations that can't be cancelled cause cascading failures. Force-close / pending operations must have explicit cancellation paths.
- **Naming persistence drift** (issues #15, #20, #28): accessory display names get reset on plugin reload if naming is derived re-runtime instead of cached from accessory context.
- **Auto-discovery flakes** (issues #41, #42): mDNS / device discovery is unreliable; always provide a manual config fallback.
- **Stale issues**: many `homebridge-ratgdo` issues drift to "stale" — for our fork, close the loop on every issue with a clear "fixed in vX.Y" or "won't fix because Z."

## Plan output

1. Files touched (TS source, tests, package.json, config.schema.json)
2. **Cancellation paths** for any new pending operation — how does it abort cleanly?
3. **Defensive parsing** plan for any new ratgdo HTTP response handling
4. **Cached-accessory identity** preserved? UUID derivation stable across restarts?
5. **Origin/Referer headers** present on every outbound ratgdo HTTP call (PR #19 regression-prone)
6. Smoke test plan: `npm test`, deploy to Pi, verify in Home app

Hand off to `software-engineer`.

## Plan output

1. Files touched (TS source, tests, package.json)
2. Characteristic changes (added/modified HomeKit traits)
3. ratgdo HTTP calls — confirm the endpoint exists and the auth/headers are right
4. Smoke test plan: `npm test`, then deploy to Pi and verify in Home app

Hand off to `software-engineer`.
