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

    // How long the bypass setting stays in effect after the close command.
    // Two reasons this should be generous: (a) the door has to physically
    // finish closing (~12s for a typical residential door), and (b) the
    // restore POST writes to flash and can crash/reboot ratgdo a SECOND
    // time, so we want the door fully shut and the firmware settled before
    // we kick it again. 60s default = ~12s close + ~48s settle.
    this.closeWaitMs = clampInt(this.config.closeWaitMs, 1000, 180000, 60000);

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

    this.infoService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, 'DIY')
      .setCharacteristic(Characteristic.Model, 'Ratgdo Force Close')
      .setCharacteristic(Characteristic.SerialNumber, this.name.replace(/\s+/g, '-'))
      .setCharacteristic(Characteristic.FirmwareRevision, '1.0.4');

    this.switchService = new Service.Switch(this.name);
    this.switchService
      .getCharacteristic(Characteristic.On)
      .onGet(async () => false)
      .onSet(this.handleOnSet.bind(this));

    if (!this.ratgdoHost) {
      this.log.error('"ratgdoHost" is required (e.g. http://192.168.1.50)');
    }

    this.log.info(
      `[${this.name}] On tap: pre-flight read → POST ${this.settingKey}=${formatVal(this.bypassValue)} (if needed) → ` +
      `POST garageDoorState=0 → wait ${this.closeWaitMs}ms → ` +
      `POST ${this.settingKey}=<original pre-flight value> (if changed)`
    );
  }

  getServices() {
    return [this.infoService, this.switchService];
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

  async runForceClose() {
    // Pre-flight: read ratgdo's current state. We use this for two things:
    //  1. Skip the whole sequence if the door is already Closed.
    //  2. Capture the ORIGINAL value of obstFromStatus, so Step 3 can
    //     restore it to whatever it was before the user tapped the
    //     switch — instead of a hard-coded config value. If the user's
    //     normal state is false, we restore to false; if it's true, we
    //     restore to true (which would also have skipped Step 1).
    const status = await this.getStatusJson();
    if (status) {
      this.log.info(`Pre-flight: door=${status.garageDoorState}, ${this.settingKey}=${status[this.settingKey]}`);
      if (status.garageDoorState === 'Closed') {
        this.log.info('Door already closed. Nothing to do.');
        return;
      }
    }

    // Determine the value to restore to in Step 3. Default: whatever
    // obstFromStatus was in pre-flight. Fallback: the configured
    // normalValue (used only when pre-flight failed and we have no
    // idea what the original was). The configured normalValue still
    // exists for users who want to force a specific restore value.
    const originalValue = status ? status[this.settingKey] : null;
    const restoreValue = (originalValue !== null && originalValue !== undefined)
      ? originalValue
      : this.normalValue;

    // Skip Step 1 if obstFromStatus already matches bypassValue — and
    // therefore Step 3 too, since restoreValue == bypassValue means
    // there's nothing to change back. No flash writes at all.
    const skipBypass = originalValue === this.bypassValue;
    let bypassApplied = false;

    try {
      if (skipBypass) {
        this.log.info(`Step 1/3 SKIPPED: ${this.settingKey} already ${formatVal(this.bypassValue)}, no flash write needed`);
      } else {
        this.log.info(`Step 1/3: ${this.settingKey} → ${formatVal(this.bypassValue)} (flash write — ratgdo may briefly become unresponsive)`);
        await this.postSetGdo(this.settingKey, this.bypassValue);
        bypassApplied = true;

        // Active poll: wait for ratgdo to be FULLY ready (HTTP up AND
        // GDO-comms up — see waitForRatgdoReady for why both matter)
        // before sending the close. Without this, /setgdo POSTs land
        // during the GDO-comms-down window and get silently dropped.
        await this.waitForRatgdoReady();
      }

      this.log.info('Step 2/3: garageDoorState → 0 (close — no flash write)');
      await this.postSetGdoWithRetry('garageDoorState', 0);

      // Verify the close actually started. ratgdo's response of 200 OK only
      // confirms the HTTP request was received — the close itself happens
      // after a 5s TTC delay and the firmware can crash mid-sequence
      // without the door ever moving. Poll garageDoorState for the
      // Open → Closing/Closed transition (typically arrives ~5s after the
      // POST due to TTC). If we don't see it within 10s, something's wrong.
      const closeStarted = await this.verifyCloseStarted();
      if (!closeStarted) {
        this.log.error(`CRITICAL: door state never transitioned to Closing after POST 200. Close was lost (likely ratgdo firmware crash mid-close). Skipping Step 3 to avoid leaving in inconsistent state — restore ${this.settingKey} manually if needed.`);
        return;
      }

      // Step 3 only does work if we actually changed the setting in Step 1.
      // If skipBypass was true, restoreValue == bypassValue (current state
      // already matches what we want), and re-posting the same value would
      // trigger an unnecessary flash write. Skip it.
      if (bypassApplied && restoreValue !== this.bypassValue) {
        this.log.info(`Step 3/3: waiting ${this.closeWaitMs}ms then restoring ${this.settingKey} → ${formatVal(restoreValue)} (original pre-flight value)`);
        await sleep(this.closeWaitMs);
        await this.postSetGdoWithRetry(this.settingKey, restoreValue);
        bypassApplied = false;
      } else {
        this.log.info(`Step 3/3 SKIPPED: ${this.settingKey} did not change in this sequence, nothing to restore`);
        bypassApplied = false;
      }
    } finally {
      // If Step 1 succeeded but we threw before Step 3 finished, restore.
      // Uses the same pre-flight-original value as the happy path.
      if (bypassApplied) {
        this.log.warn(`Restoring ${this.settingKey} → ${formatVal(restoreValue)} after error`);
        try {
          await this.postSetGdoWithRetry(this.settingKey, restoreValue);
        } catch (err) {
          this.log.error(
            `CRITICAL: failed to restore ${this.settingKey} to ${formatVal(restoreValue)}: ${err.message}. ` +
            `Set it manually in the ratgdo web UI.`
          );
        }
      }
    }
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
    const url = `${this.ratgdoHost}/setgdo`;
    const body = `${encodeURIComponent(key)}=${encodeURIComponent(formatVal(value))}`;
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

  // postSetGdo with one retry on transient connection errors. Use for the
  // close command (Step 2) and the restore POST (Step 3 + finally) — if
  // ratgdo's HTTP server is still busy when we POST, we'll see
  // ECONNRESET / ECONNREFUSED. Wait for it to come back, then retry once.
  async postSetGdoWithRetry(key, value) {
    try {
      return await this.postSetGdo(key, value);
    } catch (err) {
      if (!isTransientConnectionError(err)) throw err;
      this.log.warn(`Transient connection error on ${key}=${formatVal(value)} (${err.code || err.message}); waiting for ratgdo to be ready then retrying once`);
      await this.waitForRatgdoReady();
      return this.postSetGdo(key, value);
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
