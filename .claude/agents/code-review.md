---
name: code-review
description: Review Homebridge plugin changes for async safety, error handling, schema sync, and fork-PR violations.
tools: Read, Glob, Grep, Bash
model: sonnet
---

# Code Review — homebridge-ratgdo-forceclose

Begin reviewing on invocation.

> **🚫 BLOCK any PR command targeting upstream.** If review surfaces `gh pr create` without `--repo Haglerd/homebridge-ratgdo-forceclose`, that's a critical finding — fork-only is non-negotiable.

## Pre-flight checks (driven by Homebridge norms + prior bugs)

1. **HTTP timeouts** — every ratgdo call must have a timeout. Grep `fetch(`, `axios.`, `http.request(` for missing timeouts.
2. **HAPStatus translation** — caught errors translate to `HAPStatus.*`, not raw throws or silent swallows.
3. **No `console.*`, no `process.exit()`** — flag both unconditionally.
4. **Schema sync** — TS config interface ↔ `config.schema.json` parity. Mismatch breaks Homebridge UI validation.
5. **Origin/Referer headers** — every outbound ratgdo HTTP call. Regression-prone (PR #19).
6. **Defensive parsing** — incoming device payloads access via `?.` chains. `obj.field.match()` without guards = TypeError crash (upstream issues #22, #24).
7. **Cached-accessory UUID stability** — UUID derived from a stable serial/identifier, not anything that changes between restarts (upstream issues #15, #20, #28).
8. **Characteristic update gating** — only `updateCharacteristic` when value differs from last reported. Repeated identical updates = HomeKit "duplicate event" noise.
9. **Cancellation** — new pending operations have a cancel path (AbortController, in-flight flag). No "stuck in close-in-progress" states.
10. **Force-close `obstFromStatus` order** — restores to `false` after the close, not `true`. Past log evidence shows this was wrong.
11. **Fork PR routing** — `--repo Haglerd/homebridge-ratgdo-forceclose`, never upstream.
12. **Tests** — `npm test` passes; smoke tests cover happy path + at least one error path.

## Verdict

- **APPROVED** → pipeline ends
- **CHANGES REQUESTED** → hand back to `software-engineer` with file:line refs
