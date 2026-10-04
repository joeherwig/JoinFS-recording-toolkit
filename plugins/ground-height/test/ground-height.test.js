import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadPlugin, makeTrack } from '../../../test/helpers/fake-host.js';
import { options } from '../index.js';

// the vendored component, loaded the way the plugin does under node (it defines globalThis.JoinfsGroundHeight)
await import('../vendor/joinfs-ground-height.js');

/** A track flying east, 1 s apart, ~100 m per frame, at 1000 m; frame 0 is an event-like frame (0/0, alt 0). */
function flyingTrack(extra = {}) {
  const track = makeTrack({ id: 'g1', frames: 400, t0: 100 });
  const f = track.frames;
  for (let i = 1; i < 400; i++) { f.lat[i] = 47; f.lon[i] = 8 + (i * 100) / 75800; f.alt[i] = 1000 + i; }
  Object.assign(track, { timeOffsetS: 5, showAltitude: true }, extra);
  return track;
}

function useProvider(height = 500) {
  const calls = [];
  options.provider = async (batch) => { calls.push(batch.length); return batch.map(() => height); };
  return calls;
}

test('ground-height: loads cleanly; both menu entries are declared with an icon each', async () => {
  const h = await loadPlugin('ground-height', { tracks: [flyingTrack()], locale: 'de' });
  assert.equal(h.status().state, 'ready');
  const actions = h.host.trackActions().filter((a) => a.pluginId === 'ground-height');
  assert.deepEqual(actions.map((a) => a.id).sort(), ['profile', 'toggle']);
  assert.deepEqual(actions.map((a) => a.text).sort(), ['Bodenhöhe: anzeigen / ausblenden', 'Flughöhe und Geländeprofil…']);
  for (const a of actions) assert.match(a.iconSvg, /^<svg[^>]*currentColor/, `${a.id} has an SVG icon`);
  assert.deepEqual(h.warnings, []);
});

test('ground-height: toggle looks the profile up once, shows it, hides it, and undo keeps the cache', async () => {
  const calls = useProvider(500);
  const track = flyingTrack();
  const h = await loadPlugin('ground-height', { tracks: [track] });
  await h.host.runTrackAction('ground-height', 'toggle', 'g1');
  assert.ok(calls.length >= 1);
  assert.equal(h.status().state, 'active');
  assert.equal(track.ext.groundHeight.shown, true);
  assert.ok(track.ext.groundHeight.profile.height.every((v) => v === 500));
  assert.match(h.toasts[0], /open-meteo\.com/);
  assert.match(h.toasts.at(-1), /is shown in the altitude lane/);

  const lookups = calls.length;
  await h.host.runTrackAction('ground-height', 'toggle', 'g1');         // hide: no new lookup
  assert.equal(track.ext.groundHeight.shown, false);
  assert.match(h.toasts.at(-1), /hidden/);
  await h.host.runTrackAction('ground-height', 'toggle', 'g1');         // show again
  assert.equal(track.ext.groundHeight.shown, true);
  assert.equal(calls.length, lookups);

  h.history.undo(); h.history.undo(); h.history.undo();                 // back before the first lookup
  assert.equal(track.ext.groundHeight.shown, false);
  assert.ok(track.ext.groundHeight.profile, 'the cache survives undo');
  await h.host.runTrackAction('ground-height', 'toggle', 'g1');
  assert.equal(calls.length, lookups, 'still no second lookup');
});

test('ground-height: a hint is shown when the ALT lane is off', async () => {
  useProvider();
  const track = flyingTrack({ showAltitude: false });
  const h = await loadPlugin('ground-height', { tracks: [track] });
  await h.host.runTrackAction('ground-height', 'toggle', 'g1');
  assert.match(h.toasts.at(-1), /altitude lane \(ALT\) is switched off/);
});

test('ground-height: lookup failures give a translated toast and change nothing; a second click while running is refused', async () => {
  const track = flyingTrack();
  const h = await loadPlugin('ground-height', { tracks: [track], locale: 'de' });
  options.provider = async () => { throw Object.assign(new Error('offline'), { code: 'network' }); };
  await h.host.runTrackAction('ground-height', 'toggle', 'g1');
  assert.equal(track.ext.groundHeight, undefined);
  assert.equal(h.toasts.at(-1), 'Der Bodenhöhen-Dienst ist nicht erreichbar. Prüfe die Internetverbindung.');
  assert.equal(h.history.canUndo ? h.history.canUndo() : false, false);

  let release;
  const gate = new Promise((resolve) => { release = resolve; });      // every batch waits for the same gate
  options.provider = async (batch) => { await gate; return batch.map(() => 1); };
  const first = h.host.runTrackAction('ground-height', 'toggle', 'g1');
  await new Promise((r) => setTimeout(r, 20));
  await h.host.runTrackAction('ground-height', 'toggle', 'g1');
  assert.match(h.toasts.at(-1), /wird gerade schon abgefragt/);
  release(); await first;
  assert.equal(track.ext.groundHeight.shown, true);
});

test('ground-height: the timeline layer draws only while shown and with an ALT lane scale', async () => {
  useProvider(300);
  const track = flyingTrack();
  const h = await loadPlugin('ground-height', { tracks: [track] });
  await h.host.runTrackAction('ground-height', 'toggle', 'g1');
  const [layer] = h.layers;
  const calls = [];
  const g = new Proxy({}, { get: (_, name) => (...a) => { calls.push(name); return a; }, set: () => true });
  const args = { track, top: 0, height: 60, width: 800, toX: (t) => (t - 100) * 2, altitudeY: (m) => 56 - m / 40 };
  layer.draw(g, args);
  assert.ok(calls.includes('stroke') && calls.includes('fill'));
  calls.length = 0;
  layer.draw(g, { ...args, altitudeY: null });
  assert.deepEqual(calls, []);
  await h.host.runTrackAction('ground-height', 'toggle', 'g1');         // hide
  layer.draw(g, args);
  assert.deepEqual(calls, []);
});

test('ground-height: the profile action opens the modal with project-time data and seeks the playhead', async () => {
  useProvider(200);
  const track = flyingTrack();
  const h = await loadPlugin('ground-height', { tracks: [track], locale: 'de' });
  const made = [];
  globalThis.document = { createElement: (tag) => { const el = { tag, attrs: {}, listeners: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, fn) { this.listeners[t] = fn; } }; made.push(el); return el; } };
  try {
    h.state.time = 42;
    await h.host.runTrackAction('ground-height', 'profile', 'g1');
    const modal = h.lastModal();
    assert.equal(modal.spec.title, 'Flughöhe und Bodenhöhe: TEST');
    const chart = modal.body.children[0];
    assert.equal(chart.tag, 'joinfs-ground-profile');
    assert.equal(chart.attrs.lang, 'de');
    assert.equal(chart.playhead, 42);
    assert.equal(chart.data.times.length, 399, 'the frame without a position is left out');
    assert.equal(chart.data.times[0], 101 + 5, 'project time = track time + offset');
    assert.equal(chart.data.alt[0], 1001);
    assert.equal(chart.data.ground.times[0], 101 + 5, 'the first valid fix, in project time');
    assert.equal(track.ext.groundHeight.shown, false, 'looked up and cached, but not switched on in the timeline');
    chart.listeners.seek({ detail: { time: 77 } });
    assert.equal(h.state.time, 77);
  } finally { delete globalThis.document; }
});

test('ground-height: English and German files have the same keys and placeholders', () => {
  const read = (l) => JSON.parse(fs.readFileSync(new URL(`../locales/${l}.json`, import.meta.url), 'utf8'));
  const en = read('en'), de = read('de');
  assert.deepEqual(Object.keys(de).sort(), Object.keys(en).sort());
  const ph = (s) => (s.match(/\{\w+\}/g) || []).sort();
  for (const k of Object.keys(en)) assert.deepEqual(ph(de[k]), ph(en[k]), k);
});

test('ground-height: the vendored component matches the standalone repo files (when it is checked out next to this one)', () => {
  const repo = new URL('../../../../joinfs-ground-height-webcomponent/src/', import.meta.url);
  if (!fs.existsSync(repo)) return;
  for (const f of fs.readdirSync(repo)) {
    assert.equal(fs.readFileSync(new URL(`../vendor/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n'),
      fs.readFileSync(new URL(f, repo), 'utf8').replace(/\r\n/g, '\n'), `vendor/${f} is out of date`);
  }
});
