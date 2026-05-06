# /quick-fix

Single-file fix shortcut.

## Use when

- Single TS file, single function
- Type fix, log fix, typo
- Not touching the force-close state machine, characteristic registration, or config schema

## Workflow

1. Read the file
2. Make minimal edit
3. `npx tsc --noEmit` to confirm no type errors
4. `npm test` smoke pass
5. Commit on feature branch, push, /pr

If the change touches state machine / characteristics / schema, STOP and invoke `planner`.
