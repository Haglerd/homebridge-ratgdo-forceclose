---
name: homebridge-deploy
description: Deploy plugin changes to the Pi-hosted Homebridge and restart. Use after a verified-passing change to test in real Home app.
---

# Deploy to Pi Homebridge

Pi: `dakot@100.121.96.114`, key `~/.ssh/pi_key`. Homebridge runs as a service.

## Process

1. Build TypeScript locally
   ```bash
   npm run build
   ```
2. Pack tarball
   ```bash
   npm pack
   ```
3. Copy to Pi
   ```bash
   scp -i ~/.ssh/pi_key homebridge-ratgdo-forceclose-*.tgz dakot@100.121.96.114:~/
   ```
4. Install on Pi (Homebridge plugin install path)
   ```bash
   ssh -i ~/.ssh/pi_key dakot@100.121.96.114 'sudo npm install -g ~/homebridge-ratgdo-forceclose-*.tgz'
   ```
5. Restart Homebridge child bridge for this plugin only (don't take down the whole Homebridge)
   ```bash
   ssh -i ~/.ssh/pi_key dakot@100.121.96.114 'sudo systemctl restart homebridge'
   # Or use the Homebridge UI at http://100.121.96.114:8581 to restart just the child bridge
   ```
6. Tail logs to confirm load
   ```bash
   ssh -i ~/.ssh/pi_key dakot@100.121.96.114 'sudo journalctl -u homebridge -f'
   ```

## Node-version trap

Homebridge runs Node v24, user shell is v22. If you run `npm install` in your shell, native modules may compile against v22 ABI and silently fail under v24. Build artifacts on the Pi if there's any doubt.

## Verify in Home app

After restart:
- Force-close switch appears
- Tap → confirm via Pi journal that the plugin runs the obstFromStatus → wait → close → restore-false sequence
- No HAPStatus error toasts in the Home app
