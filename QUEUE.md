# homebridge-ratgdo-forceclose work queue

Priority-ordered list of pending work items. Top = next to work.

## Format

```
### [P0|P1|P2|P3] <title>
**Status:** queued | in-progress | blocked | done <commit>
**Acceptance:** <testable done state>
**Notes:** <state-machine touched? schema-sync needed? deploy-to-Pi smoke?>
```

- **P0** — door operation broken / HomeKit unusable
- **P1** — bug confirmed in Home app
- **P2** — UX / config improvement
- **P3** — nice-to-have

---

## Active queue

_(none queued — add items below this line)_

---

## Recently completed

_(prune to last 10)_
