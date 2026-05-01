'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

const PLUGIN_NAME = 'homebridge-ratgdo-forceclose';
const ACCESSORY_NAME = 'RatgdoForceClose';

let Service, Characteristic;

module.exports = (api) => {
  Service = api.hap.Service;
  Characteristic = api.hap.Characteristic;
  api.registerAccessory(PLUGIN_NAME, ACCESSORY_NAME, RatgdoForceCloseAccessory);
};

class RatgdoForceCloseAccessory {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};

    this.name = this.config.name || 'Force Close Garage';

    // Required: ratgdo base URL
    this.ratgdoHost = normalizeHost(this.config.ratgdoHost);

    // Optional digest auth (only needed if you've enabled "Require Password" on ratgdo)
    this.username = this.config.username || null;
    this.password = this.config.password || null;

    // Which setting to toggle. Default is the one matching the
    // "Get obstruction from GDO status messages" checkbox.
    // Alternative: 'pinBasedObst' (inverted meaning).
    this.settingKey = this.config.settingKey || 'obstFromStatus';

    // Values: bypass = state during the close attempt, normal = state to restore.
    // For obstFromStatus default: bypass=true (use messages, ignore pin),
    //                             normal=false (default, use pin).
    this.bypassValue = this.config.bypassValue !== undefined ? this.config.bypassValue : true;
    this.normalValue = this.config.normalValue !== undefined ? this.config.normalValue : false;

    // Maximum time from Step 2 POST to Step 3 fire. v1.0.5 polls
    // garageDoorState until it reads `Closed`, then waits postCloseSettleMs
    // before Step 3 — so closeWaitMs is now an upper bound, not a fixed
    // sleep. The actual time is door-physical-close (~12s) + settle.
    this.closeWaitMs = clampInt(this.config.closeWaitMs, 1000, 180000, 60000);

    // Small fixed wait after the door is observed Closed but before the
    // Step 3 restore POST. Gives ratgdo a moment to settle before we hit
    // it with another flash-write that may crash/reboot it. 8s default
    // is conservative; lower means a snappier overall sequence.
    this.postCloseSettleMs = clampInt(this.config.postCloseSettleMs, 0, 60000, 8000);

    // Bundle TTCseconds=0 into the same flash POST as the obstFromStatus
    // toggle, then restore the original TTC during the bundled Step 3.
    // ratgdo's TTC is a "warning beep before close" delay (typically
    // 5–10s). When set to 0, the close fires instantly after Step 2,
    // saving the full TTC window per force-close. Bundled into the same
    // flash save so it costs zero extra reboots — one flash for setup,
    // one for restore, identical to the v1.0.4 sequence. Disable only
    // if you want the warning beep during force-close (e.g. for safety
    // when you can't see the door).
    this.bundleTtcZero = this.config.bundleTtcZero !== false;

    // Cooldown to prevent fat-finger re-trigger
    this.cooldownMs = clampInt(this.config.cooldownMs, 0, 120000, 20000);

    // Maximum time to wait for ratgdo to be fully ready after the Step 1
    // obstFromStatus POST. Polls GET /status.json every 250ms and considers
    // ratgdo ready only when (a) HTTP responds AND (b) garageDoorState is a
    // valid state (not "Unknown"). Real serial logs show the HTTP server
    // comes back ~12s after a flash-write reboot but the wall-panel /
    // GDO-comms layer can take ~30s to recover; close commands sent during
    // that window are silently dropped. 45s default covers worst case.
    this.interStepMaxWaitMs = clampInt(this.config.interStepMaxWaitMs, 1000, 90000, 45000);

    this.busy = false;
    this.lastFiredAt = 0;

    // Digest auth nonce cache. After the first 401 challenge, we keep
    // realm / nonce / qop / opaque / algorithm so subsequent requests
    // can send the Authorization header preemptively (with incrementing
    // nc) instead of doing the unauthed → 401 → authed dance every time.
    // Halves the request count to ratgdo on every force-close sequence,
    // which significantly reduces the load that crashes ratgdo's firmware.
    // Reset on plugin restart or when ratgdo invalidates the nonce (sends
    // 401 to a request that included our cached Authorization header).
    this.cachedAuth = null;

    // v1.1.0 — optional features (all default off, fully additive to v1.0.5).
    // Each toggle gates its own service/behavior; nothing here changes the
    // existing force-close sequence.
    this.enableRebootButton = !!this.config.enableRebootButton;
    this.rebootCooldownMs = clampInt(this.config.rebootCooldownMs, 5000, 600000, 60000);
    this.enableObstructionSensor = !!this.config.enableObstructionSensor;
    this.enableMotionSensor = !!this.config.enableMotionSensor;
    this.statusPollIntervalMs = clampInt(this.config.statusPollIntervalMs, 1000, 60000, 3000);
    this.manageDeviceSettings = !!this.config.manageDeviceSettings;
    this.deviceDefaults = (this.config.deviceDefaults && typeof this.config.deviceDefaults === 'object')
      ? this.config.deviceDefaults
      : {};

    // Reboot state (separate from force-close busy/cooldown).
    this.rebootBusy = false;
    this.lastRebootAt = 0;

    // Last-observed sensor states — used by the polling loop to diff before
    // calling updateCharacteristic, so HomeKit only sees real edges.
    this.lastObstructed = null;
    this.lastMotion = null;

    // Status polling timer handle.
    this.statusPollTimer = null;
    this._pollTickFn = null;

    this.infoService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, 'DIY')
      .setCharacteristic(Characteristic.Model, 'Ratgdo Force Close')
      .setCharacteristic(Characteristic.SerialNumber, this.name.replace(/\s+/g, '-'))
      .setCharacteristic(Characteristic.FirmwareRevision, '1.1.0');

    this.switchService = new Service.Switch(this.name);
    this.switchService
      .getCharacteristic(Characteristic.On)
      .onGet(async () => false)
      .onSet(this.handleOnSet.bind(this));

    // v1.1.0 — optional Reboot switch. POSTs /reboot to ratgdo. Stateless
    // momentary switch (auto-resets to Off after the request completes).
    // ratgdo's /reboot endpoint is auth-exempt by design but real installs
    // sometimes return 401 — httpRequestWithAuth handles both.
    if (this.enableRebootButton) {
      this.rebootService = new Service.Switch(`${this.name} Reboot`, 'reboot');
      this.rebootService
        .getCharacteristic(Characteristic.On)
        .onGet(async () => false)
        .onSet(this.handleRebootOnSet.bind(this));
    }

    // v1.1.0 — optional Obstruction ContactSensor. Mirrors status.json's
    // garageObstructed flag. ContactSensorState semantics: NOT_DETECTED
    // (contact open) when obstructed = alarm; DETECTED (contact closed)
    // when clear = normal. iOS Home pushes a phone notification on every
    // state change for ContactSensor when the user enables it in
    // Home → Settings → Notifications for that accessory.
    if (this.enableObstructionSensor) {
      this.obstructionService = new Service.ContactSensor(`${this.name} Obstruction`, 'obstruction');
      this.obstructionService
        .getCharacteristic(Characteristic.ContactSensorState)
        .onGet(async () => (this.lastObstructed
          ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
          : Characteristic.ContactSensorState.CONTACT_DETECTED));
    }

    // v1.1.0 — optional Motion sensor. Mirrors status.json's garageMotion.
    if (this.enableMotionSensor) {
      this.motionService = new Service.MotionSensor(`${this.name} Motion`, 'motion');
      this.motionService
        .getCharacteristic(Characteristic.MotionDetected)
        .onGet(async () => !!this.lastMotion);
    }

    if (!this.ratgdoHost) {
      this.log.error('"ratgdoHost" is required (e.g. http://192.168.1.50)');
    }

    this.log.info(
      `[${this.name}] On tap: pre-flight read → POST ${this.settingKey}=${formatVal(this.bypassValue)}` +
      `${this.bundleTtcZero ? '+TTCseconds=0' : ''} (if needed) → POST garageDoorState=0 → ` +
      `poll for Closed (max ${this.closeWaitMs}ms) → settle ${this.postCloseSettleMs}ms → ` +
      `POST ${this.settingKey}=<original>${this.bundleTtcZero ? '+TTCseconds=<original>' : ''} (if changed)`
    );

    // v1.1.0 — async init. Push opted-in device defaults, then start the
    // sensor polling loop if any sensor is enabled. Both are best-effort and
    // log warnings on failure rather than blocking accessory registration.
    if (this.manageDeviceSettings && this.ratgdoHost) {
      this.pushManagedSettings()
        .catch((err) => this.log.warn(`Push managed settings failed: ${err.message}`));
    }
    if ((this.enableObstructionSensor || this.enableMotionSensor) && this.ratgdoHost) {
      this.startStatusPolling();
    }
  }

  getServices() {
    const services = [this.infoService, this.switchService];
    if (this.rebootService) services.push(this.rebootService);
    if (this.obstructionService) services.push(this.obstructionService);
    if (this.motionService) services.push(this.motionService);
    return services;
  }

  async handleOnSet(value) {
    if (!value) return;

    const since = Date.now() - this.lastFiredAt;
    if (since < this.cooldownMs) {
      const remain = Math.ceil((this.cooldownMs - since) / 1000);
      this.log.warn(`Cooldown active, ${remain}s remaining. Ignoring.`);
      this.resetSwitch(800);
      return;
    }
    if (this.busy) {
      this.log.warn('Force close already in progress. Ignoring.');
      this.resetSwitch(800);
      return;
    }
    if (!this.ratgdoHost) {
      this.log.error('ratgdoHost not configured. Aborting.');
      this.resetSwitch(800);
      return;
    }

    this.busy = true;
    this.lastFiredAt = Date.now();

    this.runForceClose()
      .then(() => this.log.info('Force close sequence complete.'))
      .catch((err) => this.log.error('Force close error:', err.message))
      .finally(() => {
        this.busy = false;
        this.resetSwitch(500);
      });
  }

  resetSwitch(delayMs) {
    setTimeout(() => {
      try {
        this.switchService.updateCharacteristic(Characteristic.On, false);
      } catch (e) { /* ignore */ }
    }, delayMs);
  }

  // v1.1.0 — Reboot switch handler. Mirrors handleOnSet's structure: cooldown
  // gate, busy gate, host-configured gate, then async runReboot in the
  // background while the switch auto-resets.
  async handleRebootOnSet(value) {
    if (!value) return;

    const since = Date.now() - this.lastRebootAt;
    if (since < this.rebootCooldownMs) {
      const remain = Math.ceil((this.rebootCooldownMs - since) / 1000);
      this.log.warn(`Reboot cooldown active, ${remain}s remaining. Ignoring.`);
      this.resetRebootSwitch(800);
      return;
    }
    if (this.rebootBusy) {
      this.log.warn('Reboot already in progress. Ignoring.');
      this.resetRebootSwitch(800);
      return;
    }
    if (!this.ratgdoHost) {
      this.log.error('ratgdoHost not configured. Aborting reboot.');
      this.resetRebootSwitch(800);
      return;
    }

    this.rebootBusy = true;
    this.lastRebootAt = Date.now();
    this.runReboot()
      .then(() => this.log.info('Reboot command sent. ratgdo will be unavailable for ~30s.'))
      .catch((err) => this.log.error('Reboot error:', err.message))
      .finally(() => {
        this.rebootBusy = false;
        this.resetRebootSwitch(500);
      });
  }

  resetRebootSwitch(delayMs) {
    if (!this.rebootService) return;
    setTimeout(() => {
      try {
        this.rebootService.updateCharacteristic(Characteristic.On, false);
      } catch (e) { /* ignore */ }
    }, delayMs);
  }

  // POST /reboot. Per homekit-ratgdo docs the endpoint is auth-exempt, but
  // some installs return 401 anyway — the existing httpRequestWithAuth
  // handles the digest fallback. After a successful reboot, the cached
  // digest nonce is no longer valid (the device's nonce changes after
  // restart), so clear it; the next request will re-challenge cleanly.
  async runReboot() {
    this.log.info('Sending reboot command to ratgdo');
    const url = `${this.ratgdoHost}/reboot`;
    await this.httpRequestWithAuth(url, {
      method: 'POST',
      headers: { 'Connection': 'close', 'Content-Length': '0' },
      timeoutMs: 5000,
    });
    this.cachedAuth = null;
  }

  // v1.1.0 — periodic status polling for Obstruction + Motion sensors.
  // Skips while the force-close or reboot is busy (no point polling during
  // a flash-write recovery window). Backs off 2x on transient errors so we
  // don't pile load on ratgdo when it's already struggling.
  startStatusPolling() {
    this.log.info(`Starting status polling every ${this.statusPollIntervalMs}ms for sensors`);

    const tick = async () => {
      if (this.busy || this.rebootBusy) {
        this.scheduleNextPoll(this.statusPollIntervalMs);
        return;
      }
      try {
        const status = await this.getStatusJson();
        if (status) this.applyStatusToSensors(status);
        this.scheduleNextPoll(this.statusPollIntervalMs);
      } catch (err) {
        this.scheduleNextPoll(this.statusPollIntervalMs * 2);
      }
    };

    this._pollTickFn = tick;
    this.scheduleNextPoll(this.statusPollIntervalMs);
  }

  scheduleNextPoll(delayMs) {
    if (this.statusPollTimer) clearTimeout(this.statusPollTimer);
    this.statusPollTimer = setTimeout(this._pollTickFn, delayMs);
  }

  applyStatusToSensors(status) {
    if (this.obstructionService && typeof status.garageObstructed === 'boolean') {
      if (this.lastObstructed !== status.garageObstructed) {
        this.lastObstructed = status.garageObstructed;
        const value = status.garageObstructed
          ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
          : Characteristic.ContactSensorState.CONTACT_DETECTED;
        this.obstructionService.updateCharacteristic(Characteristic.ContactSensorState, value);
        this.log.info(`Obstruction ${status.garageObstructed ? 'DETECTED' : 'cleared'}`);
      }
    }
    if (this.motionService && typeof status.garageMotion === 'boolean') {
      if (this.lastMotion !== status.garageMotion) {
        this.lastMotion = status.garageMotion;
        this.motionService.updateCharacteristic(Characteristic.MotionDetected, status.garageMotion);
        this.log.info(`Motion ${status.garageMotion ? 'detected' : 'cleared'}`);
      }
    }
  }

  // v1.1.0 — push a small allowlisted set of device-side settings to ratgdo
  // on plugin init. Bundled into one /setgdo POST = one flash save (verified
  // in homekit-ratgdo32 web.cpp; same trick the per-tap bundleTtcZero uses).
  // Only keys with non-undefined values are sent, so users can opt in to
  // managing one setting without needing to set them all.
  async pushManagedSettings() {
    const allowed = ['TTCseconds', 'occupancyDuration', 'lightHomeKit', 'motionHomeKit', 'LEDidle'];
    const pairs = {};
    for (const k of allowed) {
      const v = this.deviceDefaults[k];
      if (v !== undefined && v !== null && v !== '') pairs[k] = v;
    }
    if (Object.keys(pairs).length === 0) {
      this.log.info('Manage device settings: enabled but no values set; skipping push.');
      return;
    }
    this.log.info(`Pushing managed device settings to ratgdo: ${describePairs(pairs)}`);
    await this.postSetGdoMulti(pairs);
  }

  async runForceClose() {
    // Pre-flight: read ratgdo's current state. We use it for:
    //  1. Skip the whole sequence if the door is already Closed.
    //  2. Capture original obstFromStatus so Step 3 restores to it.
    //  3. Capture original TTCseconds so Step 3 restores to it (when
    //     bundleTtcZero is enabled — see runtime config).
    const status = await this.getStatusJson();
    if (status) {
      const ttcLog = (typeof status.TTCseconds === 'number') ? `, TTCseconds=${status.TTCseconds}` : '';
      this.log.info(`Pre-flight: door=${status.garageDoorState}, ${this.settingKey}=${status[this.settingKey]}${ttcLog}`);
      if (status.garageDoorState === 'Closed') {
        this.log.info('Door already closed. Nothing to do.');
        return;
      }
    }

    const originalValue = status ? status[this.settingKey] : null;
    const restoreValue = (originalValue !== null && originalValue !== undefined)
      ? originalValue
      : this.normalValue;

    // Bundle TTCseconds=0 into the flash POST when (a) the user opted in
    // (default true) AND (b) we have a pre-flight TTC reading we can
    // restore later AND (c) it's not already 0 (no need to bundle a no-op).
    // /setgdo handles multiple keys in one POST and only flashes ONCE,
    // so adding TTCseconds=0 to the obstFromStatus POST costs zero extra
    // reboots — but skips the ~5–10s warning-beep window that delays
    // every close-confirmation in the v1.0.4 logs.
    const originalTtc = (status && typeof status.TTCseconds === 'number') ? status.TTCseconds : null;
    const willBundleTtc = this.bundleTtcZero && originalTtc !== null && originalTtc !== 0;

    // Skip Step 1 entirely if obstFromStatus already matches bypassValue.
    // No flash, no reboot, no TTC change either — the existing TTC
    // governs how fast the close confirms. Tell the user if the win
    // is being left on the table.
    const skipBypass = originalValue === this.bypassValue;
    let flashApplied = false;

    try {
      if (skipBypass) {
        this.log.info(`Step 1/3 SKIPPED: ${this.settingKey} already ${formatVal(this.bypassValue)}, no flash write needed`);
        if (this.bundleTtcZero && originalTtc !== null && originalTtc !== 0) {
          this.log.info(`  (TTC bundling skipped too — would cost a flash reboot just to disable the ${originalTtc}s warning beep. Set TTCseconds=0 permanently in ratgdo web UI to speed up skip-Step-1 taps.)`);
        }
      } else {
        const pairs = { [this.settingKey]: this.bypassValue };
        if (willBundleTtc) pairs.TTCseconds = 0;
        this.log.info(`Step 1/3: ${describePairs(pairs)} (flash write — ratgdo may briefly become unresponsive)`);
        await this.postSetGdoMulti(pairs);
        flashApplied = true;

        // Wait for ratgdo to be FULLY ready (HTTP up AND GDO-comms back —
        // garageDoorState != "Unknown") before sending the close.
        await this.waitForRatgdoReady();
      }

      this.log.info('Step 2/3: garageDoorState → 0 (close — no flash write)');
      await this.postSetGdoWithRetry('garageDoorState', 0);

      // Verify the close actually started — ratgdo's 200 OK only confirms
      // the HTTP request landed; the firmware can crash mid-sequence
      // without the door ever moving. With TTC bundled to 0 this should
      // confirm in <2s instead of ~8s.
      const closeStarted = await this.verifyCloseStarted();
      if (!closeStarted) {
        this.log.error(`CRITICAL: door state never transitioned to Closing after POST 200. Close was lost (likely ratgdo firmware crash mid-close). Skipping Step 3 to avoid leaving in inconsistent state — restore manually if needed.`);
        return;
      }

      // Active wait for door to actually finish closing, instead of a
      // fixed sleep. Polls garageDoorState until "Closed" is observed,
      // capped by closeWaitMs. Then a small postCloseSettleMs gives
      // ratgdo a moment before we hit it with the restore flash POST.
      const closedConfirmed = await this.waitForDoorClosed();
      if (closedConfirmed) {
        this.log.info(`  → settling ${this.postCloseSettleMs}ms before restore POST`);
        await sleep(this.postCloseSettleMs);
      } else {
        this.log.warn(`  → door did not confirm Closed within ${this.closeWaitMs}ms; proceeding with restore anyway`);
      }

      // Step 3: bundled restore (only if we actually flashed in Step 1).
      // restoreValue == bypassValue would be a no-op rewrite, so skip.
      if (flashApplied && restoreValue !== this.bypassValue) {
        const pairs = { [this.settingKey]: restoreValue };
        if (willBundleTtc) pairs.TTCseconds = originalTtc;
        this.log.info(`Step 3/3: ${describePairs(pairs)} (bundled flash write — restoring pre-flight values)`);
        await this.postSetGdoWithRetry(this.settingKey, restoreValue, willBundleTtc ? { TTCseconds: originalTtc } : null);
        flashApplied = false;
      } else {
        this.log.info(`Step 3/3 SKIPPED: nothing changed in this sequence, nothing to restore`);
        flashApplied = false;
      }
    } finally {
      // If Step 1's flash succeeded but we threw before Step 3 finished,
      // restore — using the same bundled pre-flight values.
      if (flashApplied) {
        const pairs = { [this.settingKey]: restoreValue };
        if (willBundleTtc) pairs.TTCseconds = originalTtc;
        this.log.warn(`Restoring ${describePairs(pairs)} after error`);
        try {
          await this.postSetGdoWithRetry(this.settingKey, restoreValue, willBundleTtc ? { TTCseconds: originalTtc } : null);
        } catch (err) {
          this.log.error(
            `CRITICAL: failed to restore ${describePairs(pairs)}: ${err.message}. ` +
            `Set them manually in the ratgdo web UI.`
          );
        }
      }
    }
  }

  // Active wait for door to reach `Closed` state, capped by closeWaitMs.
  // Replaces the v1.0.4 fixed-sleep approach — fires Step 3 as soon as
  // the door is actually shut, instead of after a worst-case sleep.
  async waitForDoorClosed() {
    const start = Date.now();
    const deadline = start + this.closeWaitMs;
    const probeIntervalMs = 500;
    let lastLoggedState = null;
    while (Date.now() < deadline) {
      try {
        const status = await this.getStatusJson();
        if (status && status.garageDoorState !== lastLoggedState) {
          lastLoggedState = status.garageDoorState;
          this.log.info(`  → ${Math.floor((Date.now() - start) / 1000)}s: door=${status.garageDoorState}`);
        }
        if (status && status.garageDoorState === 'Closed') {
          this.log.info(`  → ratgdo confirms door is Closed (after ${Date.now() - start}ms)`);
          return true;
        }
      } catch (err) { /* keep probing */ }
      await sleep(probeIntervalMs);
    }
    return false;
  }

  // After Step 2 (close POST), verify the door actually starts closing by
  // polling garageDoorState for the Open → Closing/Closed transition.
  // ratgdo's 200 OK only confirms the HTTP request was received; the actual
  // close happens later (5s TTC + close cycle), and the firmware can crash
  // between those two events without the door ever moving. Returns true if
  // we observed the transition, false if it never happened in the window.
  async verifyCloseStarted() {
    const start = Date.now();
    const maxWaitMs = 10000;
    const probeIntervalMs = 500;
    while (Date.now() - start < maxWaitMs) {
      try {
        const status = await this.getStatusJson();
        if (!status) {
          await sleep(probeIntervalMs);
          continue;
        }
        if (status.garageDoorState === 'Closing' || status.garageDoorState === 'Closed') {
          this.log.info(`  → ratgdo confirms door is ${status.garageDoorState} (after ${Date.now() - start}ms)`);
          return true;
        }
      } catch (err) { /* keep probing */ }
      await sleep(probeIntervalMs);
    }
    return false;
  }

  // Read ratgdo's /status.json. Used by the pre-flight check to decide
  // which steps of the force-close sequence to skip. Returns null on
  // failure — caller proceeds with the full sequence as a fallback.
  async getStatusJson() {
    try {
      const res = await this.httpRequestWithAuth(`${this.ratgdoHost}/status.json`, {
        method: 'GET',
        headers: { 'Connection': 'close' },
        timeoutMs: 3000,
      });
      return JSON.parse(res.body);
    } catch (err) {
      this.log.warn(`Pre-flight status read failed (${err.code || err.message}); proceeding with full sequence`);
      return null;
    }
  }

  async postSetGdo(key, value) {
    return this.postSetGdoMulti({ [key]: value });
  }

  // POST multiple key=value pairs to /setgdo in a single request. ratgdo's
  // setgdo handler iterates server.args() and only calls ESP8266_SAVE_CONFIG()
  // ONCE at the end of the loop (verified in homekit-ratgdo32 web.cpp), so
  // bundling obstFromStatus and TTCseconds in one POST = one flash save =
  // one reboot, instead of two flashes / two reboots.
  async postSetGdoMulti(pairs) {
    const url = `${this.ratgdoHost}/setgdo`;
    const body = Object.entries(pairs)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(formatVal(v))}`)
      .join('&');
    return this.httpRequestWithAuth(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // Force a fresh TCP connection per POST. ratgdo's tiny HTTP server
        // doesn't reliably survive keep-alive reuse across rapid requests.
        'Connection': 'close',
      },
      body,
    });
  }

  // postSetGdo with one retry on transient connection errors. Used for
  // Step 2 (close) and the bundled restore POST. Optional `extraPairs`
  // object lets the restore call also bundle TTCseconds in the same flash.
  async postSetGdoWithRetry(key, value, extraPairs) {
    const pairs = extraPairs ? { [key]: value, ...extraPairs } : { [key]: value };
    try {
      return await this.postSetGdoMulti(pairs);
    } catch (err) {
      if (!isTransientConnectionError(err)) throw err;
      this.log.warn(`Transient connection error on ${describePairs(pairs)} (${err.code || err.message}); waiting for ratgdo to be ready then retrying once`);
      await this.waitForRatgdoReady();
      return this.postSetGdoMulti(pairs);
    }
  }

  // Probe ratgdo with quick GET /status.json calls until it's FULLY ready
  // (HTTP up AND GDO comms up), or until interStepMaxWaitMs has elapsed.
  //
  // Why "fully ready" matters: the obstFromStatus flash write crashes/reboots
  // ratgdo on some installs. After the reboot, the HTTP server comes back at
  // ~12s but the wall-panel / GDO-comms layer (which actually relays the
  // close to the motor) doesn't recover until ~30s. During that gap,
  // /status.json returns 200 OK with garageDoorState="Unknown" and any
  // /setgdo POST is accepted (200 OK) but silently dropped because the
  // GDO-comms task isn't running yet. We have to wait for a valid door
  // state before sending Step 2 — otherwise Step 2 disappears into a void.
  //
  // Returns true once HTTP + GDO comms are both up, false on timeout.
  async waitForRatgdoReady() {
    const start = Date.now();
    const deadline = start + this.interStepMaxWaitMs;
    const pollIntervalMs = 250;
    const validStates = ['Open', 'Closed', 'Opening', 'Closing', 'Stopped'];
    let attempts = 0;
    let httpUpAt = null;
    let httpUpLogged = false;

    while (Date.now() < deadline) {
      attempts++;
      try {
        const res = await this.httpRequestWithAuth(`${this.ratgdoHost}/status.json`, {
          method: 'GET',
          headers: { 'Connection': 'close' },
          timeoutMs: 2000,
        });

        let status = null;
        try { status = JSON.parse(res.body); } catch (e) { /* ignore */ }

        const state = status && status.garageDoorState;

        if (state && validStates.includes(state)) {
          const total = Date.now() - start;
          const commsLag = httpUpAt !== null ? (Date.now() - httpUpAt) : 0;
          if (httpUpAt !== null) {
            this.log.info(`  → ratgdo fully ready (door=${state}) after ${total}ms (HTTP-up at ${httpUpAt - start}ms, GDO-comms +${commsLag}ms)`);
          } else if (attempts > 1) {
            this.log.info(`  → ratgdo ready (door=${state}) after ${attempts} probes (${total}ms)`);
          }
          return true;
        }

        if (httpUpAt === null) httpUpAt = Date.now();
        if (!httpUpLogged) {
          httpUpLogged = true;
          this.log.info(`  → HTTP up after ${Date.now() - start}ms but GDO-comms not yet (door=${state || 'no-status'}); continuing to poll`);
        }
      } catch (err) {
        if (!isTransientConnectionError(err)) throw err;
      }
      await sleep(pollIntervalMs);
    }

    this.log.warn(`ratgdo not fully ready after ${this.interStepMaxWaitMs}ms (${attempts} probes); proceeding anyway — close may be lost`);
    return false;
  }

  // Handles digest auth in case ratgdo's "Require Password" is enabled.
  // Uses a per-accessory nonce cache to avoid the unauthed→401→authed dance
  // on every request. First request gets a fresh challenge; subsequent
  // requests send Authorization preemptively with incrementing nc until
  // ratgdo invalidates the nonce.
  async httpRequestWithAuth(urlStr, opts) {
    const u = new URL(urlStr);
    const uri = u.pathname + u.search;
    const method = opts.method || 'GET';

    // Fast path: reuse cached nonce if we have one.
    if (this.cachedAuth && this.username && this.password) {
      this.cachedAuth.nc++;
      const auth = buildDigestAuthHeaderFromCached(this.cachedAuth, this.username, this.password, method, uri);
      const optsAuth = { ...opts, headers: { ...(opts.headers || {}), Authorization: auth } };
      try {
        return await httpRequest(urlStr, optsAuth);
      } catch (err) {
        // Cached nonce was rejected — fall through to fresh challenge.
        if (err.is401) {
          this.cachedAuth = null;
        } else {
          throw err;
        }
      }
    }

    // Slow path: send unauthed, parse the 401 challenge, retry with auth,
    // and cache the params for next time.
    try {
      return await httpRequest(urlStr, opts);
    } catch (err) {
      if (!err.is401 || !err.wwwAuthenticate || !this.username || !this.password) {
        throw err;
      }
      const params = parseAuthHeaderParams(err.wwwAuthenticate);
      this.cachedAuth = {
        realm: params.realm || '',
        nonce: params.nonce || '',
        qop: (params.qop || 'auth').split(',')[0].trim(),
        opaque: params.opaque,
        algorithm: (params.algorithm || 'MD5').toUpperCase(),
        nc: 1,
      };
      const auth = buildDigestAuthHeaderFromCached(this.cachedAuth, this.username, this.password, method, uri);
      const opts2 = { ...opts, headers: { ...(opts.headers || {}), Authorization: auth } };
      return httpRequest(urlStr, opts2);
    }
  }
}

// ---------- helpers ----------

function normalizeHost(host) {
  if (!host) return null;
  let h = String(host).trim();
  if (!/^https?:\/\//i.test(h)) h = 'http://' + h;
  return h.replace(/\/+$/, '');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function clampInt(v, min, max, fallback) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Errors that can be retried once — typically caused by ratgdo's HTTP
// server being briefly unavailable while it writes config to flash, or by
// a TCP connection that ratgdo's tiny stack closed mid-conversation.
function isTransientConnectionError(err) {
  if (!err) return false;
  const code = err.code || '';
  if (code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'EPIPE') return true;
  const msg = String(err.message || '');
  // Also catch our own httpRequest's "request timed out after Nms" message
  // for older error paths that throw without a .code.
  return /econnreset|econnrefused|etimedout|epipe|timed.?out/i.test(msg);
}

function formatVal(v) {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

function describePairs(pairs) {
  return Object.entries(pairs).map(([k, v]) => `${k}=${formatVal(v)}`).join(', ');
}

function truncate(s, n) {
  if (typeof s !== 'string') return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function httpRequest(urlStr, { method = 'GET', headers = {}, body = null, timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); }
    catch (e) { return reject(new Error(`Invalid URL: ${urlStr}`)); }

    const lib = u.protocol === 'https:' ? https : http;
    const opts = {
      method,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers: { ...headers },
      timeout: timeoutMs,
    };
    if (body != null) opts.headers['Content-Length'] = Buffer.byteLength(body);

    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode === 401) {
          const err = new Error(`HTTP 401 from ${urlStr}`);
          err.is401 = true;
          err.wwwAuthenticate = res.headers['www-authenticate'] || '';
          return reject(err);
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          return resolve({ status: res.statusCode, body: data });
        }
        reject(new Error(`HTTP ${res.statusCode} from ${urlStr}: ${truncate(data, 120)}`));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      // Tag with .code = 'ETIMEDOUT' so isTransientConnectionError classifies
      // it as retryable. Without this, plain Error message wasn't matched and
      // the active-poll loop bailed instead of retrying.
      const e = new Error(`request timed out after ${timeoutMs}ms`);
      e.code = 'ETIMEDOUT';
      req.destroy(e);
    });
    if (body != null) req.write(body);
    req.end();
  });
}

// Build a Digest Authorization header from a previously-cached challenge.
// Lets us skip the unauthed→401→authed dance after the first successful
// auth, halving the number of HTTP requests we send to ratgdo per
// force-close sequence. The caller is responsible for incrementing
// cached.nc before calling.
function buildDigestAuthHeaderFromCached(cached, username, password, method, uri) {
  const crypto = require('crypto');
  const realm = cached.realm || '';
  const nonce = cached.nonce || '';
  const qop = cached.qop || 'auth';
  const opaque = cached.opaque;
  const algorithm = cached.algorithm || 'MD5';

  const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const cnonce = crypto.randomBytes(8).toString('hex');
  const nc = (cached.nc || 1).toString(16).padStart(8, '0');
  const response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);

  const parts = [
    `username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `algorithm=${algorithm}`,
    `qop=${qop}`,
    `nc=${nc}`,
    `cnonce="${cnonce}"`,
    `response="${response}"`,
  ];
  if (opaque) parts.push(`opaque="${opaque}"`);
  return 'Digest ' + parts.join(', ');
}

// Minimal RFC 2617 / 7616 Digest auth header builder (qop=auth, MD5).
// Sufficient for ratgdo's web auth.
function buildDigestAuthHeader(wwwAuth, username, password, method, uri) {
  const crypto = require('crypto');
  const params = parseAuthHeaderParams(wwwAuth);
  const realm = params.realm || '';
  const nonce = params.nonce || '';
  const qop = (params.qop || 'auth').split(',')[0].trim();
  const opaque = params.opaque;
  const algorithm = (params.algorithm || 'MD5').toUpperCase();

  const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const cnonce = crypto.randomBytes(8).toString('hex');
  const nc = '00000001';
  const response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);

  const parts = [
    `username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `algorithm=${algorithm}`,
    `qop=${qop}`,
    `nc=${nc}`,
    `cnonce="${cnonce}"`,
    `response="${response}"`,
  ];
  if (opaque) parts.push(`opaque="${opaque}"`);
  return 'Digest ' + parts.join(', ');
}

function parseAuthHeaderParams(header) {
  const out = {};
  const re = /(\w+)\s*=\s*(?:"([^"]*)"|([^,]*))/g;
  let m;
  // strip "Digest " prefix
  const s = header.replace(/^Digest\s+/i, '');
  while ((m = re.exec(s)) !== null) {
    out[m[1].toLowerCase()] = (m[2] !== undefined ? m[2] : m[3]).trim();
  }
  return out;
}
