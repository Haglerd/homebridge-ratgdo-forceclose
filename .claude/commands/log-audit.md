# /log-audit

Pull Homebridge journalctl logs from the Pi, analyze for plugin errors, append findings to QUEUE.md.

## Steps

1. Invoke the `log-auditor` agent
2. Auditor reads `.claude/.log_audit_state` for last checkpoint
3. Auditor SSHes to Pi (`dakot@100.121.96.114`), runs `sudo journalctl -u homebridge --since "<checkpoint>"`
4. Filters to plugin-tagged lines (`[Force Close Garage]`, `homebridge-ratgdo-forceclose`, `Plugin error`, `Uncaught`)
5. Pattern-matches across:
   - **P0**: plugin errors, child-bridge restart loops, port binds, HAPStatus toasts in Home, module-not-found
   - **P1**: state-machine CRITICAL log lines, wrong-direction obstFromStatus restoration, HTTP timeout loops, 403 Forbidden (Origin/Referer regression), accessory name drift
   - **P2**: config schema warnings, poll-rate violations, intermittent EHOSTUNREACH, HomeKit "duplicate event"
   - (P3 informational events not queued)
6. Cross-references existing QUEUE.md for recurrences
7. Appends new items as `log-audit-YYYYMMDD-NNN` with log evidence
8. Updates `.claude/.log_audit_state` checkpoint

## Cadence options

- **Manual**: `/log-audit` whenever
- **In-session loop**: `/loop 6h /log-audit` for periodic checking
- **Truly unattended**: Windows Task Scheduler job that opens Claude Code with `/log-audit` (cloud-scheduled agents can't reach the Pi over Tailscale)

## After /log-audit

Run `/queue-next` to start consuming new findings through the pipeline.

## Don't

- Don't run /log-audit and /queue-next in the same turn — keep them separate
- Don't manually clear `.claude/.log_audit_state` unless you intentionally want to re-process old logs
