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
    // Should comfortably exceed the door's full close duration.
    this.closeWaitMs = clampInt(this.config.closeWaitMs, 1000, 60000, 18000);

    // Cooldown to prevent fat-finger re-trigger
    this.cooldownMs = clampInt(this.config.cooldownMs, 0, 120000, 20000);

    this.busy = false;
    this.lastFiredAt = 0;

    this.infoService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, 'DIY')
      .setCharacteristic(Characteristic.Model, 'Ratgdo Force Close')
      .setCharacteristic(Characteristic.SerialNumber, this.name.replace(/\s+/g, '-'))
      .setCharacteristic(Characteristic.FirmwareRevision, '1.0.0');

    this.switchService = new Service.Switch(this.name);
    this.switchService
      .getCharacteristic(Characteristic.On)
      .onGet(async () => false)
      .onSet(this.handleOnSet.bind(this));

    if (!this.ratgdoHost) {
      this.log.error('"ratgdoHost" is required (e.g. http://192.168.1.50)');
    }

    this.log.info(
      `[${this.name}] On tap: POST ${this.settingKey}=${formatVal(this.bypassValue)}, ` +
      `POST garageDoorState=0, wait ${this.closeWaitMs}ms, ` +
      `POST ${this.settingKey}=${formatVal(this.normalValue)}`
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
    let bypassApplied = false;
    try {
      this.log.info(`Step 1/3: ${this.settingKey} → ${formatVal(this.bypassValue)}`);
      await this.postSetGdo(this.settingKey, this.bypassValue);
      bypassApplied = true;

      // tiny pause so the firmware applies it before we send close
      await sleep(300);

      this.log.info('Step 2/3: garageDoorState → 0 (close)');
      await this.postSetGdo('garageDoorState', 0);

      this.log.info(`Step 3/3: waiting ${this.closeWaitMs}ms then restoring ${this.settingKey} → ${formatVal(this.normalValue)}`);
      await sleep(this.closeWaitMs);
      await this.postSetGdo(this.settingKey, this.normalValue);
      bypassApplied = false;
    } finally {
      // If we changed the setting and didn't restore it (error mid-sequence), try again.
      if (bypassApplied) {
        this.log.warn(`Restoring ${this.settingKey} → ${formatVal(this.normalValue)} after error`);
        try {
          await this.postSetGdo(this.settingKey, this.normalValue);
        } catch (err) {
          this.log.error(
            `CRITICAL: failed to restore ${this.settingKey} to ${formatVal(this.normalValue)}: ${err.message}. ` +
            `Set it manually in the ratgdo web UI.`
          );
        }
      }
    }
  }

  async postSetGdo(key, value) {
    const url = `${this.ratgdoHost}/setgdo`;
    const body = `${encodeURIComponent(key)}=${encodeURIComponent(formatVal(value))}`;
    return this.httpRequestWithAuth(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  }

  // Handles digest auth in case ratgdo's "Require Password" is enabled.
  // First request unauthed; if 401 with Digest challenge, retry with response.
  async httpRequestWithAuth(urlStr, opts) {
    try {
      return await httpRequest(urlStr, opts);
    } catch (err) {
      if (!err.is401 || !err.wwwAuthenticate || !this.username || !this.password) {
        throw err;
      }
      const auth = buildDigestAuthHeader(
        err.wwwAuthenticate,
        this.username,
        this.password,
        opts.method || 'GET',
        new URL(urlStr).pathname + new URL(urlStr).search
      );
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
    req.on('timeout', () => req.destroy(new Error(`request timed out after ${timeoutMs}ms`)));
    if (body != null) req.write(body);
    req.end();
  });
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
