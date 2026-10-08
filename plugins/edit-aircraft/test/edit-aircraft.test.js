import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadPlugin, makeTrack } from '../../../test/helpers/fake-host.js';
import { applyEdit } from '../index.js';
import { lookupElevation, firstFix, validate, diff, altitudeDeltaM, parseAltitude, firstAltitudeM, fixIndices, M_PER_FT } from '../logic.js';

/** Track whose frames 2..9 carry a position (frames 0 and 1 are event-like zeros) at 100 m + 1 m per frame. */
function flightTrack() {
  const t = makeTrack();
  t.icaoType = 'C172'; t.nickname = 'Joe';
  for (let i = 2; i < 10; i++) { t.frames.lat[i] = 50 + i / 100; t.frames.lon[i] = 8; t.frames.alt[i] = 100 + i; }
  return t;
}

/** The scoped context the plugin would get (the fake host does not expose it). */
const ctxOf = (h) => h.host._makeContext(h.host._plugins.get('edit-aircraft'));

test('edit-aircraft: loads cleanly and offers a translated, content-naming menu entry before activation', async () => {
  const en = await loadPlugin('edit-aircraft', { tracks: [flightTrack()] });
  assert.equal(en.status().state, 'ready');
  assert.deepEqual(en.warnings, []);
  assert.equal(en.host.trackActions()[0].text, 'Edit aircraft type, callsign, nickname, altitude');
  const de = await loadPlugin('edit-aircraft', { tracks: [flightTrack()], locale: 'de' });
  assert.equal(de.host.trackActions()[0].text, 'Flugzeugtyp, Rufzeichen, Pilotenname, Höhe bearbeiten');
});

test('edit-aircraft: de and en have the same keys and placeholders', () => {
  const read = (l) => JSON.parse(fs.readFileSync(new URL(`../locales/${l}.json`, import.meta.url), 'utf8'));
  const en = read('en'), de = read('de');
  assert.deepEqual(Object.keys(de).sort(), Object.keys(en).sort());
  const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
  for (const k of Object.keys(en)) assert.equal(ph(de[k]), ph(en[k]), k);
});

test('edit-aircraft: applying changes identity and shifts altitude of position frames only; undo and redo restore it', async () => {
  const track = flightTrack();
  const h = await loadPlugin('edit-aircraft', { tracks: [track] });
  const ctx = ctxOf(h);
  assert.equal(applyEdit(ctx, 't1', { icaoType: 'A320', callsign: 'D-AIZZ', altitudeDeltaM: 50 }), true);
  assert.equal(track.icaoType, 'A320');
  assert.equal(track.callsign, 'D-AIZZ');
  assert.equal(track.nickname, 'Joe');
  assert.equal(track.frames.alt[2], 152);
  assert.equal(track.frames.alt[9], 159);
  assert.equal(track.frames.alt[0], 0);                         // event-like frames are untouched

  h.history.undo();
  assert.equal(track.icaoType, 'C172');
  assert.equal(track.callsign, 'TEST');
  assert.equal(track.frames.alt[2], 102);
  h.history.redo();
  assert.equal(track.callsign, 'D-AIZZ');
  assert.equal(track.frames.alt[2], 152);
});

test('edit-aircraft: shifting the altitude drops the cached ground-height profile (undo brings it back); text-only edits keep it', async () => {
  const track = flightTrack();
  const profile = { profile: { times: [0], height: [1] }, shown: true };
  track.ext.groundHeight = profile;
  const h = await loadPlugin('edit-aircraft', { tracks: [track] });
  const ctx = ctxOf(h);
  applyEdit(ctx, 't1', { nickname: 'Ann' });
  assert.equal(track.ext.groundHeight, profile);
  applyEdit(ctx, 't1', { altitudeDeltaM: 10 });
  assert.equal(track.ext.groundHeight, undefined);
  h.history.undo();
  assert.equal(track.ext.groundHeight, profile);
});

test('edit-aircraft: an empty change does nothing and is not on the undo stack', async () => {
  const track = flightTrack();
  const h = await loadPlugin('edit-aircraft', { tracks: [track] });
  assert.equal(applyEdit(ctxOf(h), 't1', { altitudeDeltaM: null }), false);
  assert.equal(h.history.canUndo, false);
});

test('tracks.patch: only the whitelisted text fields, only strings, previous values of the changed keys are returned', async () => {
  const track = flightTrack();
  const h = await loadPlugin('edit-aircraft', { tracks: [track] });
  const ctx = ctxOf(h);
  assert.deepEqual(ctx.tracks.patch('t1', { callsign: 'TEST', nickname: 'Ann' }), { nickname: 'Joe' });
  assert.throws(() => ctx.tracks.patch('t1', { timeOffsetS: 5 }), /cannot be patched/);
  assert.throws(() => ctx.tracks.patch('t1', { callsign: 5 }), /must be a string/);
  assert.throws(() => ctx.tracks.patch('nope', {}), /No track/);
  assert.equal(track.timeOffsetS, 0);
});

test('logic: ICAO, length and number validation', () => {
  assert.deepEqual(validate({ icaoType: 'a320', callsign: 'x', nickname: 'y', altitude: 5 }), {});
  assert.deepEqual(validate({ icaoType: '' }), {});
  assert.equal(validate({ icaoType: 'A3200' }).icaoType, 'err.icao');
  assert.equal(validate({ icaoType: 'A' }).icaoType, 'err.icao');
  assert.equal(validate({ callsign: 'x'.repeat(17) }).callsign, 'err.length');
  assert.equal(validate({ nickname: 'x'.repeat(33) }).nickname, 'err.length');
  assert.equal(validate({ altitude: NaN }).altitude, 'err.altitude');
});

test('logic: diff normalises, altitude conversion and parsing', () => {
  assert.deepEqual(diff({ icaoType: 'C172', callsign: 'A', nickname: 'B' }, { icaoType: ' c172 ', callsign: 'A ', nickname: 'C' }), { nickname: 'C' });
  assert.ok(Math.abs(altitudeDeltaM(100, 1000, 'ft') - (1000 * M_PER_FT - 100)) < 1e-9);
  assert.equal(altitudeDeltaM(100, 150, 'm'), 50);
  assert.equal(parseAltitude('1,247'), 1.247);
  assert.equal(parseAltitude('1247.5'), 1247.5);
  assert.equal(parseAltitude('-20'), -20);
  assert.ok(Number.isNaN(parseAltitude('abc')));
  assert.ok(Number.isNaN(parseAltitude('')));
  const t = flightTrack();
  assert.equal(firstAltitudeM(t), 102);
  assert.deepEqual(fixIndices(t), [2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(firstAltitudeM(makeTrack()), null);
});

test('logic: ground altitude lookup asks open-meteo with the rounded position and fails to null', async () => {
  const urls = [];
  const ok = async (url) => { urls.push(url); return { ok: true, json: async () => ({ elevation: [321.5] }) }; };
  assert.equal(await lookupElevation(50.123456, 8.987654, { fetch: ok }), 321.5);
  assert.equal(urls[0], 'https://api.open-meteo.com/v1/elevation?latitude=50.1235&longitude=8.9877');
  assert.equal(await lookupElevation(1, 2, { fetch: async () => ({ ok: false }) }), null);
  assert.equal(await lookupElevation(1, 2, { fetch: async () => { throw new Error('offline'); } }), null);
  assert.equal(await lookupElevation(1, 2, { fetch: async () => ({ ok: true, json: async () => ({ elevation: ['x'] }) }) }), null);
  assert.deepEqual(firstFix(flightTrack()), { lat: 50.02, lon: 8, alt: 102 });
  assert.equal(firstFix(makeTrack()), null);
});
