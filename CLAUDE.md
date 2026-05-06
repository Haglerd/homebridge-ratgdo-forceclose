# homebridge-ratgdo-forceclose

Homebridge plugin fork that adds a force-close switch to ratgdo accessories. Fork lives at `Haglerd/homebridge-ratgdo-forceclose`. **Not DaqsPickEm-related.**

## Stack

- **Plugin**: Node.js (TypeScript), runs inside Homebridge
- **Tests**: smoke tests under `tests/`
- **Pi deploy target**: Homebridge runs on Raspberry Pi at `dakot@100.121.96.114`, SSH via `~/.ssh/pi_key`

## Working rules

- PRs MUST target the fork: `gh pr create --repo Haglerd/homebridge-ratgdo-forceclose`. Never open against the upstream homebridge-ratgdo plugin.
- Bugs that also affect upstream stay in our fork only — no upstream contributions.
- Node version trap: user shell uses v22, Homebridge runs on v24. ABI-incompatible native modules will silently break — match the runtime version when testing locally.
