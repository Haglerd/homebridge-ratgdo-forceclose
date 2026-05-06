---
name: config-schema-sync
description: Verify TypeScript config interface matches config.schema.json. Use after any config-related change.
---

# config.schema.json ↔ TS interface parity

Homebridge UI validates user input against `config.schema.json`. If the TS config interface and the JSON schema drift, users get accepted-but-broken configs (or rejected-but-valid configs).

## Process

1. Locate the TS config interface (typically `src/types.ts` or `src/config.ts`)
2. Open `config.schema.json` at repo root
3. For each property in the TS interface:
   - Confirm it exists in `config.schema.json` properties
   - Type matches (`string` ↔ `"type": "string"`, `boolean` ↔ `"type": "boolean"`, etc.)
   - Optional/required matches (`?` in TS ↔ NOT in `required[]`)
4. For each property in `config.schema.json`:
   - Confirm it exists in the TS interface (no schema-only orphans)
5. Validate examples: a sample config in `config.schema.json.examples` should pass `tsc` against the interface

## Red flags

- New TS field with no schema entry → Homebridge UI silently drops user input
- Schema entry with no TS field → user input accepted, plugin ignores
- Type mismatch (`number` in TS but `"type": "string"` in schema) → runtime cast errors
