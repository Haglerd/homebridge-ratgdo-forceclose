# /audit

Run the auditor agent against the plugin. Append new findings to `QUEUE.md`.

## Steps

1. Invoke the `auditor` agent
2. Auditor reads `QUEUE.md` to build dedup set
3. Auditor sweeps across the 8 categories (async safety, HAPStatus, defensive parsing, characteristic gating, schema sync, cached-accessory identity, ratgdo HTTP, state machine)
4. Auditor appends NEW findings to `QUEUE.md` sorted by severity
5. Auditor reports: "Added N findings (P0: x, P1: y, ...). Skipped M duplicates."

## After /audit

Run `/queue-next` to consume the queue.
