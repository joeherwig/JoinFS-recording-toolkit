import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPlugin, makeTrack } from '../../../test/helpers/fake-host.js';
import { clipTrack as trimTrack, parseVariableFrame, buildVariableFrame } from '../../../src/track-clip.js';
import { exportProject } from '../../../src/project-model.js';
import { decodeJfsFile } from '../../../src/jfs-codec.js';

const INT = 11, FLOAT = 12;

/** 10 position frames (t = 100..109) with a gear variable frame at 101 and 105, flaps at 102, an event at 107. */
function trackWithVariables() {
  const track = makeTrack({ frames: 14, t0: 100 });
  const f = track.frames;
  const vars = [[100.5, INT, [[1111, 0]]], [101.5, FLOAT, [[2222, 0.25]]], [104.5, INT, [[1111, 1]]], [106.5, INT, [[3333, 7]]]];
  const times = [], types = [], payloads = [];
  for (let i = 0; i < 10; i++) { times.push(100 + i); types.push(1); payloads.push(null); }
  for (const [t, type, entries] of vars) {
    times.push(t); types.push(type);
    payloads.push(buildVariableFrame(type, entries.map(([id, value]) => ({ id, value }))));
  }
  const order = times.map((t, i) => i).sort((a, b) => times[a] - times[b]);
  const n = 14;
  const pick = (arr) => order.map((i) => arr[i]);
  f.times = Float64Array.from(pick(times));
  f.types = Uint8Array.from(pick(types));
  f.opaquePayload = pick(payloads);
  return track;
}

test('variable frames parse and rebuild byte-identically', () => {
  const payload = buildVariableFrame(FLOAT, [{ id: 7, value: 0.5 }, { id: 9, value: 1 }]);
  assert.deepEqual(parseVariableFrame(FLOAT, payload), [{ id: 7, value: 0.5 }, { id: 9, value: 1 }]);
  assert.deepEqual(Array.from(buildVariableFrame(FLOAT, parseVariableFrame(FLOAT, payload))), Array.from(payload));
});

test('trimTrack keeps only the range and seeds the state the cut-off beginning had set', () => {
  const out = trimTrack(trackWithVariables(), 105, 108);
  const f = out.frames;
  const seeds = [];
  for (let i = 0; i < f.times.length; i++) if (f.types[i] === INT || f.types[i] === FLOAT) seeds.push({ i, t: f.times[i], type: f.types[i], e: parseVariableFrame(f.types[i], f.opaquePayload[i]) });
  // seeds first, at the new start: gear=1 (last value before 105) as integer, flaps=0.25 as float
  assert.equal(f.times[0], 105);
  assert.deepEqual(seeds.slice(0, 2).map((s) => [s.type, s.e]), [[INT, [{ id: 1111, value: 1 }]], [FLOAT, [{ id: 2222, value: 0.25 }]]]);
  // the variable change at 106.5 is inside the range and is kept as it was
  assert.ok(seeds.some((s) => s.t === 106.5 && s.e[0].id === 3333));
  const positions = Array.from(f.times).filter((_, i) => f.types[i] === 1);
  assert.deepEqual(positions, [105, 106, 107, 108]);
  assert.ok(Array.from(f.times).every((t) => t >= 105 && t <= 108));
  assert.equal(f.kin.length, f.times.length * 6);
  assert.equal(f.ctl.length, f.times.length * 5);
});

test('trimTrack does not modify its input and returns null when no position frame is left', () => {
  const track = trackWithVariables();
  const before = Array.from(track.frames.times);
  trimTrack(track, 103, 106);
  assert.deepEqual(Array.from(track.frames.times), before);
  assert.equal(trimTrack(track, 200, 300), null);
});

test('trim plugin: edit mode opens a bar, apply is undoable, cancel changes nothing', async () => {
  const track = makeTrack({ frames: 11, t0: 100 });
  const h = await loadPlugin('trim', { tracks: [track], locale: 'de' });
  assert.equal(h.host.trackActions()[0].text, 'Spur kürzen…');

  await h.host.runTrackAction('trim', 'edit', 't1');
  let bar = h.lastDialog();
  assert.deepEqual(bar.values, { start: 0, end: 10 });

  h.state.time = 103; // project time = frame time + offset
  bar.spec.onButton('startHere');
  h.state.time = 108;
  bar.spec.onButton('endHere');
  assert.deepEqual(bar.values, { start: 3, end: 8 });
  assert.equal(track.ext.trim, undefined, 'nothing is stored before Apply');

  bar.spec.onButton('apply');
  assert.deepEqual(track.ext.trim, { startS: 103, endS: 108 });
  assert.equal(bar.closed, true);
  h.history.undo();
  assert.equal(track.ext.trim, undefined);
  h.history.redo();
  assert.ok(track.ext.trim);

  await h.host.runTrackAction('trim', 'edit', 't1');
  bar = h.lastDialog();
  bar.spec.onChange({ start: 5, end: 6 });
  bar.spec.onButton('cancel');
  assert.deepEqual(track.ext.trim, { startS: 103, endS: 108 }, 'cancel keeps the applied trim');
});

test('trim plugin: an inverted range is refused, a full range clears the trim, the layer shades both sides', async () => {
  const track = makeTrack({ frames: 11, t0: 100 });
  const h = await loadPlugin('trim', { tracks: [track] });
  await h.host.runTrackAction('trim', 'edit', 't1');
  const bar = h.lastDialog();
  bar.spec.onChange({ start: 7, end: 4 });
  bar.spec.onButton('apply');
  assert.match(h.toasts.at(-1), /before the end/);
  assert.equal(bar.closed, false);

  bar.spec.onChange({ start: 2, end: 9 });
  const rects = [];
  const g = { fillRect: (...a) => rects.push(a), beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  [...h.layers][0].draw(g, { track, top: 0, height: 40, width: 500, toX: (t) => (t - 100) * 20 });
  assert.deepEqual(rects, [[0, 0, 40, 40], [180, 0, 320, 40]]);

  bar.spec.onButton('reset');
  bar.spec.onButton('apply');
  assert.equal(track.ext.trim, undefined, 'the full range is stored as no trim at all');
});

test('trim export: cut parts are gone, the file starts at 0 and decodes, other tracks are untouched', async () => {
  const a = trackWithVariables();
  Object.assign(a, { id: 'a', plane: true, callsign: 'A', nickname: '', model: 'X', typeRole: 1, icaoType: '', icaoAirline: '', livery: '' });
  const b = makeTrack({ id: 'b', frames: 5, t0: 100 });
  Object.assign(b, { plane: true, callsign: 'B', nickname: '', model: 'X', typeRole: 1, icaoType: '', icaoAirline: '', livery: '' });
  a.timeOffsetS = 20; // moved in the timeline: the trim range follows the track
  const h = await loadPlugin('trim', { tracks: [a, b] });
  await h.host.runTrackAction('trim', 'edit', 'a');
  const bar = h.lastDialog();
  bar.spec.onChange({ start: 5, end: 8 });
  bar.spec.onButton('apply');

  const bytes = exportProject({ tracks: [a, b] }, { buildVariant: 'other', transform: (tracks) => h.host.applyExportTransforms(tracks) });
  const out = decodeJfsFile(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const ta = out.tracks.find((t) => t.callsign === 'A');
  const tb = out.tracks.find((t) => t.callsign === 'B');
  assert.equal(tb.frames.times.length, 5);
  // earliest remaining frame (A's seed frames at 105 + 20 = 125) vs B at 100: B defines t = 0, A starts 25 s later
  assert.equal(Math.min(...tb.frames.times), 0);
  assert.equal(ta.frames.times[0], 25);
  assert.equal(a.frames.times.length, 14, 'the live project is untouched');
});

test('trim plugin: the views show the track as it will be saved (draft while editing, applied trim afterwards)', async () => {
  const track = makeTrack({ frames: 11, t0: 100 });
  const h = await loadPlugin('trim', { tracks: [track] });
  await h.host.runTrackAction('trim', 'edit', 't1');
  assert.deepEqual(h.rangeOf(track), { startS: 100, endS: 110 }, 'the draft starts as the full range');
  const dlg = h.lastDialog();
  dlg.spec.onChange({ start: 2, end: 6 });
  assert.deepEqual(h.rangeOf(track), { startS: 102, endS: 106 });
  dlg.spec.onButton('cancel');
  assert.equal(h.rangeOf(track), null, 'cancel: back to the whole track');

  await h.host.runTrackAction('trim', 'edit', 't1');
  const dlg2 = h.lastDialog();
  dlg2.spec.onChange({ start: 2, end: 6 });
  dlg2.spec.onButton('apply');
  assert.deepEqual(h.rangeOf(track), { startS: 102, endS: 106 });
  h.history.undo();
  assert.equal(h.rangeOf(track), null);
});
