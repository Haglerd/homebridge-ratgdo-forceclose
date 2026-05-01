'use strict';

// Smoke test — exercises the parts of the plugin that don't need a live
// ratgdo or a full HAP runtime. Goal: catch obvious regressions
// (missing exports, broken syntax, JSON schema invalid, schema↔code
// drift) on every PR without requiring Homebridge to be installed.
//
// Runs via `npm test`. Exits non-zero on any assertion failure.

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO_ROOT = path.join(__dirname, '..');

// ---------- 1. package.json sanity ----------

const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
assert.strictEqual(pkg.name, 'homebridge-ratgdo-forceclose', 'package name unchanged');
assert.match(pkg.version, /^\d+\.\d+\.\d+/, 'version is semver');
assert.ok(pkg.engines, 'engines field present');
assert.match(pkg.engines.homebridge, /\^2\.0/, 'engines.homebridge declares HB 2.0 compatibility');
assert.match(pkg.engines.node, /\^(18|20|22)/, 'engines.node declares supported LTS line');
assert.ok(pkg.main, 'main entry present');
assert.strictEqual(pkg.main, 'index.js', 'main entry is index.js');

// ---------- 2. config.schema.json sanity ----------

const schema = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config.schema.json'), 'utf8'));
assert.strictEqual(schema.pluginAlias, 'RatgdoForceClose', 'pluginAlias unchanged');
assert.strictEqual(schema.pluginType, 'accessory', 'pluginType is accessory');
assert.ok(schema.schema, 'schema.schema present');
assert.ok(Array.isArray(schema.schema.required), 'schema.required is an array (HB2 stricter validator)');
assert.deepStrictEqual(
  schema.schema.required.sort(),
  ['name', 'ratgdoHost'],
  'schema.required lists name + ratgdoHost'
);
// Verify properties listed as required actually exist.
for (const field of schema.schema.required) {
  assert.ok(schema.schema.properties[field], `required field ${field} has a property definition`);
}
// Properties must NOT use the deprecated 'required: true' boolean.
for (const [name, prop] of Object.entries(schema.schema.properties)) {
  assert.notStrictEqual(prop.required, true, `property ${name} does not use deprecated 'required: true' (use schema.required array instead)`);
}

// ---------- 3. index.js parses ----------

const indexPath = path.join(REPO_ROOT, 'index.js');
const indexSrc = fs.readFileSync(indexPath, 'utf8');
// Parse via Function constructor — catches syntax errors without actually
// executing the module (which would try to register an accessory).
assert.doesNotThrow(() => new Function(indexSrc), 'index.js parses as JS');

// ---------- 4. FirmwareRevision sourced from package.json ----------

assert.match(
  indexSrc,
  /FirmwareRevision[^)]*require\(['"]\.\/package\.json['"]\)\.version/,
  "FirmwareRevision sourced from require('./package.json').version (not hardcoded)"
);

// ---------- 5. Mock-API smoke check ----------
// Load index.js with a minimal mock api so we can assert it registers
// itself. Catches "module crashes on load" regressions.

const fakeChar = new Proxy({}, { get: () => fakeChar, apply: () => fakeChar });
const fakeService = function () { return new Proxy({ getCharacteristic: () => fakeChar, setCharacteristic: () => fakeService, updateCharacteristic: () => undefined, addOptionalCharacteristic: () => undefined }, { get: (t, k) => t[k] || (() => fakeService) }); };
fakeService.AccessoryInformation = fakeService;
fakeService.Switch = fakeService;
fakeService.GarageDoorOpener = fakeService;
fakeService.ContactSensor = fakeService;
fakeService.MotionSensor = fakeService;

const registered = [];
const fakeApi = {
  hap: {
    Service: fakeService,
    Characteristic: new Proxy({}, {
      get: () => new Proxy(function () { return new Proxy({}, { get: () => () => undefined }); }, { get: () => 0 })
    }),
  },
  registerAccessory: (name, alias, ctor) => {
    registered.push({ name, alias, ctor });
  },
};

const plugin = require(indexPath);
assert.strictEqual(typeof plugin, 'function', 'module exports a registration function');
plugin(fakeApi);
assert.strictEqual(registered.length, 1, 'plugin called registerAccessory exactly once');
assert.strictEqual(registered[0].name, 'homebridge-ratgdo-forceclose');
assert.strictEqual(registered[0].alias, 'RatgdoForceClose', 'plugin alias matches schema pluginAlias');
assert.strictEqual(typeof registered[0].ctor, 'function', 'registered ctor is a constructor');

console.log('OK — all smoke tests passed (', [
  'package.json',
  'config.schema.json',
  'index.js parse',
  'FirmwareRevision wiring',
  'mock-API registration',
].join(', '), ')');
