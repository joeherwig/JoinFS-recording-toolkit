import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PluginHost, validateManifest, API_VERSION } from '../src/plugins/host.js';
import { FormatRegistry } from '../src/formats/registry.js';
import { Shortcuts } from '../src/shortcuts.js';
import { KNOWN_PLUGINS } from '../src/plugins/known.js';

const BASE = 'https://example.test/plugins/';

/** Fake environment: `files` maps "<id>/manifest.json" or "<id>/index.js" to a manifest object / module object / Error. */
function setup(files, stored = {}) {
  const warnings = [];
  const toasts = [];
  const storage = { data: { ...stored }, get(k) { return this.data[k] ?? null; }, set(k, v) { this.data[k] = v; } };
  const env = {
    baseUrl: BASE,
    fetchJson: async (url) => {
      const f = files[url.slice(BASE.length)];
      if (f === undefined) throw new Error('404');
      if (f instanceof Error) throw f;
      return f;
    },
    importModule: async (url) => {
      const f = files[url.slice(BASE.length)];
      if (f === undefined) throw new Error('404');
      if (f instanceof Error) throw f;
      return f;
    },
    storage,
    warn: (m) => warnings.push(m),
  };
  const formats = new FormatRegistry();
  const shortcuts = new Shortcuts();
  const tracks = [{ id: 't1', callsign: 'A' }];
  const executed = [];
  const services = {
    formats, shortcuts,
    getTracks: () => tracks,
    exec: (c) => { executed.push(c); },
    toast: (m) => toasts.push(m),
    t: (k, p) => (p ? `${k}:${JSON.stringify(p)}` : k),
  };
  const host = new PluginHost(env, services);
  return { host, warnings, toasts, formats, shortcuts, storage, executed, tracks };
}

const manifest = (id, extra = {}) => ({ id, version: '1.0.0', apiVersion: API_VERSION, ...extra });

test('a missing, broken, incompatible and a healthy plugin: only the healthy one is used, the app keeps going', async () => {
  const healthy = { activate: (ctx) => { ctx.io.registerFormat({ id: 'demo', extensions: ['.demo'], decode: () => ({ tracks: [] }) }); } };
  const { host, warnings, formats } = setup({
    'good/manifest.json': manifest('good'), 'good/index.js': healthy,
    'broken/manifest.json': manifest('broken'), 'broken/index.js': { activate: () => { throw new Error('kaboom'); } },
    'newer/manifest.json': manifest('newer', { apiVersion: 99 }),
    'garbled/manifest.json': new SyntaxError('bad json'),
  });
  const status = Object.fromEntries((await host.loadAll(['good', 'missing', 'broken', 'newer', 'garbled'])).map((s) => [s.id, s]));
  assert.equal(status.good.state, 'active');
  assert.equal(status.missing.state, 'unavailable');
  assert.match(status.missing.reason, /404/);
  assert.equal(status.broken.state, 'unavailable');
  assert.match(status.broken.reason, /kaboom/);
  assert.match(status.newer.reason, /needs host API v99/);
  assert.match(status.garbled.reason, /bad json/);
  assert.equal(warnings.length, 4, 'every failure is reported, none thrown');
  assert.ok(formats.get('demo'), 'the healthy plugin still contributed its format');
});

test('a plugin that fails while starting has its partial contributions removed again', async () => {
  const { host, formats, shortcuts } = setup({
    'half/manifest.json': manifest('half'),
    'half/index.js': { activate: (ctx) => {
      ctx.io.registerFormat({ id: 'half-fmt', extensions: ['.h'], decode: () => ({ tracks: [] }) });
      ctx.shortcuts.register({ id: 'k', key: 'h', run: () => {} });
      throw new Error('late failure');
    } },
  });
  await host.loadAll(['half']);
  assert.equal(formats.get('half-fmt'), null);
  assert.equal(shortcuts._specs.length, 0);
  assert.equal(host.status()[0].state, 'unavailable');
});

test('activation modes: onAction plugins show their declared menu entry without loading code, and load on demand', async () => {
  let imports = 0;
  const mod = { activate: (ctx) => { ctx.ui.registerTrackAction({ id: 'go', label: 'live', run: () => 'ran' }); } };
  const { host } = setup({
    'lazy/manifest.json': manifest('lazy', { activation: 'onAction', contributes: { trackActions: [{ id: 'go', label: 'plugin.lazy.action' }] } }),
    get 'lazy/index.js'() { imports++; return mod; },
  });
  await host.loadAll(['lazy']);
  assert.equal(imports, 0, 'index.js has not been imported yet');
  assert.deepEqual(host.trackActions().map((a) => [a.id, a.declared]), [['go', true]]);
  assert.equal(await host.activate('lazy'), true);
  assert.equal(await host.activate('lazy'), true, 'activating twice is harmless');
  assert.equal(imports, 1);
  const live = host.trackActions();
  assert.equal(live.length, 1);
  assert.equal(live[0].declared, undefined, 'the live action replaced the placeholder');
  assert.equal(live[0].run(), 'ran');
});

test('plugins are on by default, defaultEnabled:false and the stored choice override that, and disabling unregisters', async () => {
  const mod = { activate: (ctx) => { ctx.io.registerFormat({ id: 'f', extensions: ['.f'], decode: () => ({ tracks: [] }) }); } };
  const files = { 'p/manifest.json': manifest('p'), 'p/index.js': mod, 'q/manifest.json': manifest('q', { defaultEnabled: false }), 'q/index.js': mod };
  const a = setup(files);
  await a.host.loadAll(['p', 'q']);
  assert.deepEqual(a.host.status().map((s) => [s.id, s.state]), [['p', 'active'], ['q', 'disabled']]);

  const b = setup(files, { 'plugin.p.enabled': 'false', 'plugin.q.enabled': 'true' });
  await b.host.loadAll(['p', 'q']);
  assert.deepEqual(b.host.status().map((s) => [s.id, s.state]), [['p', 'disabled'], ['q', 'active']]);

  assert.ok(a.formats.get('f'));
  a.host.setEnabled('p', false);
  assert.equal(a.formats.get('f'), null, 'disabling removes what the plugin registered');
  assert.equal(a.storage.get('plugin.p.enabled'), 'false');
});

test('export transforms run in order, a failing one is skipped, and activateForSave loads lazy transform plugins', async () => {
  const lazy = { activate: (ctx) => ctx.io.registerExportTransform({ id: 'mark', order: 10, apply: (t) => t.map((x) => ({ ...x, marked: true })) }) };
  const bad = { activate: (ctx) => ctx.io.registerExportTransform({ id: 'bad', order: 20, apply: () => { throw new Error('nope'); } }) };
  const { host, warnings } = setup({
    'mark/manifest.json': manifest('mark', { activation: 'onAction', contributes: { exportTransforms: ['mark'] } }), 'mark/index.js': lazy,
    'bad/manifest.json': manifest('bad', { activation: 'onAction', contributes: { exportTransforms: ['bad'] } }), 'bad/index.js': bad,
  });
  await host.loadAll(['mark', 'bad']);
  assert.equal(host.status().find((s) => s.id === 'mark').state, 'ready', 'not loaded yet');
  await host.activateForSave();
  const out = host.applyExportTransforms([{ id: 't1' }]);
  assert.equal(out[0].marked, true);
  assert.ok(warnings.some((w) => /bad.*failed and was skipped/.test(w)));
});

test('the plugin context is scoped: read-only tracks, namespaced i18n and shortcut ids, frozen API, guarded callbacks', async () => {
  let ctxSeen;
  const { host, warnings, shortcuts, executed, tracks } = setup({
    'scoped/manifest.json': manifest('scoped'),
    'scoped/index.js': { activate: (ctx) => {
      ctxSeen = ctx;
      ctx.shortcuts.register({ id: 'boom', key: 'b', run: () => { throw new Error('in callback'); } });
    } },
  });
  await host.loadAll(['scoped']);
  assert.ok(Object.isFrozen(ctxSeen) && Object.isFrozen(ctxSeen.tracks));
  assert.throws(() => { 'use strict'; ctxSeen.tracks.get('t1').callsign = 'X'; }, TypeError);
  assert.equal(tracks[0].callsign, 'A', 'the app data is untouched');
  assert.equal(ctxSeen.i18n.t('title'), 'plugin.scoped.title');
  ctxSeen.exec({ do() {}, undo() {} });
  assert.equal(executed.length, 1);
  assert.equal(shortcuts._specs[0].id, 'scoped:boom');
  const ev = { key: 'b', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, defaultPrevented: false,
    target: { nodeType: 1, tagName: 'DIV', getAttribute: () => null }, composedPath: () => [], preventDefault() {} };
  assert.doesNotThrow(() => shortcuts.handle(ev), 'a throwing plugin shortcut must not escape');
  assert.ok(warnings.some((w) => /in callback/.test(w)));
});

test('validateManifest: id must match its folder and apiVersion must be supported', () => {
  assert.deepEqual(validateManifest(manifest('a'), 'a'), []);
  assert.match(validateManifest(manifest('a'), 'b').join(), /does not match folder/);
  assert.match(validateManifest({ id: 'a' }, 'a').join(), /apiVersion is missing/);
  assert.match(validateManifest(manifest('a', { activation: 'sometime' }), 'a').join(), /unknown activation/);
  assert.match(validateManifest(null, 'a').join(), /not an object/);
});

test('every plugin folder under plugins/ is listed in the known-plugin list, and every listed one has a manifest', () => {
  const dir = new URL('../plugins/', import.meta.url);
  const folders = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
  assert.deepEqual([...folders].sort(), [...KNOWN_PLUGINS].sort(), 'plugins/ and src/plugins/known.js disagree');
  for (const id of KNOWN_PLUGINS) {
    const m = JSON.parse(fs.readFileSync(new URL(`${id}/manifest.json`, dir), 'utf8'));
    assert.deepEqual(validateManifest(m, id), []);
  }
});
