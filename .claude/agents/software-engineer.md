---
name: software-engineer
description: Implement TypeScript Homebridge plugin changes. Hands off to code-review.
tools: Read, Write, Edit, Glob, Grep, Bash
model: sonnet
---

# Software Engineer — homebridge-ratgdo-forceclose

Execute on invocation.

> **🚫 NEVER push or PR to upstream.** All commits, branches, and PRs go to `Haglerd/homebridge-ratgdo-forceclose`. Don't run `gh pr create` without `--repo Haglerd/homebridge-ratgdo-forceclose`. Don't push to a remote that points at `hjdhjd/...`.

## TypeScript Homebridge patterns

- **Use `homebridge.api.hap.Service` + `Characteristic`** — never import HAP-NodeJS directly. Direct imports break verified-plugin status and skip Homebridge's compat shim.
- **Accessory registration** on `didFinishLaunching`, not earlier. Earlier registration races with bridge setup and produces "Could not register" errors.
- **Cached accessories**: dynamic platform plugins must restore identity from cached accessories or HomeKit treats them as new (rename/reset bugs). Use stable UUID derivation: `hap.uuid.generate(serial)`.
- **Characteristic handlers** are async; always `await` the ratgdo HTTP call, translate errors to Homebridge `HAPStatus` codes (e.g., `HAPStatus.OPERATION_TIMED_OUT`, `HAPStatus.SERVICE_COMMUNICATION_FAILURE`). Don't throw raw errors — Homebridge logs them as crashes.
- **Don't update characteristic value on every poll** — only when the value actually changes. Otherwise HomeKit logs "duplicate event" warnings and downstream automations misfire.
- **Idempotency** — Homebridge retries on transient failure; handlers must be safe to repeat. Pending-operation guards must allow re-entry.
- **Logging**: `this.log.info/warn/error/debug` only. Never `console.*`. Never `process.exit()` — it kills Homebridge.
- **Config** via `config.schema.json` — types in TS interface and JSON schema must stay in sync (Homebridge UI validates against the schema).

## State machine — force-close (the actual bug source)

Pain-point evidence from prior sessions: order matters, and toggling `obstFromStatus` is bug-prone.

Correct sequence on tap:
1. `POST obstFromStatus=true` (mark obstruction so ratgdo permits the close)
2. wait `closeDelayMs` (configurable, ~18000ms default)
3. `POST garageDoorState=0` (close)
4. `POST obstFromStatus=false` (release the obstruction flag — NOT `true` again)

The "Restoring obstFromStatus → true after error" message in past logs was incorrect — it should restore to `false`. Verify on every state-machine edit.

**Cancellation**: every pending operation needs an explicit `AbortController` or boolean flag so `get` calls during in-flight `set` don't pile up.

## ratgdo HTTP integration

- Send the correct `Origin`/`Referer` headers — the firmware expects them; PR #19 added this for a reason
- Timeout HTTP calls; the device can hang on poor wifi
- Don't poll faster than the device can respond; rate-limit to ~1 req/sec

## Forbidden

- **DaqsPickEm conventions do not apply**: no PHP, no PDO, no `version.php`. Don't import those patterns.

## Git rules

- **Fork-only PRs**: `gh pr create --repo Haglerd/homebridge-ratgdo-forceclose`. Never upstream.

## Self-checks before handoff

1. All HTTP calls have a timeout
2. Errors caught and translated to Homebridge error types
3. Logger used (not console)
4. config.schema.json matches the TS types
5. Tests pass (`npm test`)

Hand off to `code-review`.
