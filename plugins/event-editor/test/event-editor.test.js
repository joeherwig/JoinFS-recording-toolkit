import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadPlugin, makeTrack } from '../../../test/helpers/fake-host.js';
import { buildVariableFrame, parseVariableFrame } from '../../../src/track-clip.js';
import { deriveEvents } from '../../../src/track-variables.js';
import { VU } from '../../../src/variables.js';
import { createEditor, SHORTCUTS, LANES } from '../editor.js';
import { formatTime, parseTime } from '../panel.js';

const INT = 11, FLOAT = 12;

/** 10 positions at 100..109 (alt 1000+i, ground flag 2 on frames 0-4) plus converter-style variable frames. */
function track(snapshots = [[100.5, 1, 0, 0], [103.5, 1, 0, 0], [106.5, 0, 0.5, 1]]) {
  const t = makeTrack({ frames: 10, t0: 100 });
  const f = t.frames;
  const rows = [];
  for (let i = 0; i < 10; i++) rows.push({ t: 100 + i, type: 1, pos: i });
  for (const [time, gear, flaps, landing] of snapshots) {
    rows.push({ t: time, type: INT, payload: buildVariableFrame(INT, [
      { id: VU.gear, value: gear }, { id: VU.lightStates, value: landing << 2 }, { id: VU.landing, value: landing }]) });
    rows.push({ t: time, type: FLOAT, payload: buildVariableFrame(FLOAT, [{ id: VU.flaps, value: flaps }]) });
  }
  rows.sort((a, b) => a.t - b.t);
  const n = rows.length;
  const next = {};
  for (const [key, col] of Object.entries(f)) next[key] = Array.isArray(col) ? new Array(n).fill(null) : new col.constructor(n * (col.length / 10));
  rows.forEach((r, i) => {
    next.times[i] = r.t; next.types[i] = r.type; next.opaquePayload[i] = r.payload || null;
    if (r.pos !== undefined) { next.alt[i] = 1000 + r.pos; next.groundFlags[i] = r.pos < 5 ? 2 : 0; }
  });
  t.frames = next;
  t.events = deriveEvents(next);
  return t;
}

const ctxOf = (h) => h.host._makeContext(h.host._plugins.get('event-editor'));
async function setup(opts) {
  const tr = track(opts);
  const h = await loadPlugin('event-editor', { tracks: [tr] });
  const ctx = ctxOf(h);
  return { tr, h, ctx, ed: createEditor(ctx, 't1') };
}
const gearEvents = (tr) => tr.events.filter((e) => e.variable === 'gear').map((e) => [e.timeS, e.label]);
const flagsOfPositions = (tr) => Array.from(tr.frames.groundFlags).filter((_, i) => tr.frames.types[i] === 1);

test('event-editor: loads cleanly with translated menu entry; en and de have the same keys and placeholders', async () => {
  const en = await loadPlugin('event-editor', { tracks: [track()] });
  assert.equal(en.status().state, 'ready');
  assert.deepEqual(en.warnings, []);
  assert.equal(en.host.trackActions()[0].text, 'Edit gear, flaps and light events');
  const de = await loadPlugin('event-editor', { tracks: [track()], locale: 'de' });
  assert.equal(de.host.trackActions()[0].text, 'Fahrwerk-, Klappen- und Licht-Ereignisse bearbeiten');
  const read = (l) => JSON.parse(fs.readFileSync(new URL(`../locales/${l}.json`, import.meta.url), 'utf8'));
  const a = read('en'), b = read('de');
  assert.deepEqual(Object.keys(b).sort(), Object.keys(a).sort());
  const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
  for (const k of Object.keys(a)) assert.equal(ph(b[k]), ph(a[k]), k);
  for (const s of SHORTCUTS) assert.ok(a[s.help], s.help);       // every key of the help table is described
  for (const l of LANES) { assert.ok(a[`lane.${l}`]); assert.ok(a[`short.${l}`]); }
});

test('event-editor: the draft starts from the track, a gear event cannot be added twice in a row', async () => {
  const { ed, h } = await setup();
  assert.deepEqual(ed.channels.gear.map((e) => [e.timeS, e.value]), [[100.5, 1], [106.5, 0]]);
  h.state.time = 102;                                           // gear is down here
  assert.deepEqual(ed.offered('gear'), [0]);
  assert.equal(ed.add('gear', 1), false);
  assert.match(h.toasts.at(-1), /^plugin\.event-editor\.toast\.same|already is in that state/);
  assert.equal(ed.dirty, false);
  assert.equal(ed.add('gear', 0), true);                         // gear up at 102: the "up" at 106.5 becomes redundant
  assert.deepEqual(ed.channels.gear.map((e) => [e.timeS, e.value]), [[100.5, 1], [102, 0]]);
  assert.equal(ed.dirty, true);
  assert.deepEqual(ed.selectedEvent(), { timeS: 102, value: 0, channel: 'gear', index: 1 });
});

test('event-editor: move is clamped by same-channel neighbours; delete merges; undo and redo of the draft', async () => {
  const { ed } = await setup();
  ed.select('gear', 0);
  assert.equal(ed.moveTo(200), true);                            // clamped before the next gear event (106.5 - 0.1)
  assert.ok(Math.abs(ed.selectedEvent().timeS - 106.4) < 1e-9);
  assert.equal(ed.nudge(1), false, 'already at its limit');
  ed.undo();
  assert.equal(ed.selectedEvent().timeS, 100.5);
  ed.redo();
  assert.ok(Math.abs(ed.selectedEvent().timeS - 106.4) < 1e-9);
  ed.select('gear', 1);
  assert.equal(ed.remove(), true);                               // removing the last change: gear stays down
  assert.equal(ed.channels.gear.length, 1);
  assert.equal(ed.selected, null);
  assert.deepEqual(ed.events().map((e) => e.channel).slice(0, 2), ['flaps', 'nav']);  // the gear baseline now sits at 106.4
});

test('event-editor: Done applies everything as one undoable command; Cancel changes nothing', async () => {
  const { tr, h, ed } = await setup();
  const before = tr.frames.times.length, eventsBefore = tr.events;
  h.state.time = 108;
  assert.equal(ed.add('gear', 1), true);                         // gear down again at 108
  ed.done();
  assert.equal(ed.ended, true);
  assert.equal(h.layers.size, 0, 'lanes are gone');
  assert.equal(h.rowRequests.size, 0, 'the taller rows are released');
  assert.equal(h.pointers.size, 0);
  assert.deepEqual(gearEvents(tr).map((e) => e[0]), [100.5, 106.5, 108]);
  assert.equal(tr.frames.times.length, before + 1);
  assert.equal(tr.frames.kin.length, tr.frames.times.length * 6);
  h.history.undo();
  assert.equal(tr.frames.times.length, before);
  assert.equal(tr.events, eventsBefore);
  h.history.redo();
  assert.deepEqual(gearEvents(tr).map((e) => e[0]), [100.5, 106.5, 108]);
  assert.equal(h.history.canRedo, false);

  const second = createEditor(ctxOf(h), 't1');
  h.state.time = 104;
  second.add('flaps', 0.25);
  second.cancel();
  assert.equal(h.history.canUndo, true);                         // only the first edit is on the stack
  assert.equal(tr.events.some((e) => e.timeS === 104), false);
});

test('event-editor: a drag on a marker moves it (after a small threshold), a tap only selects, empty space moves the playhead', async () => {
  const { h, ed, tr } = await setup();
  const pointer = [...h.pointers][0];
  // 10 px per second; the row-local x of time t is (t - 100) * 10
  const info = (x, y, type = 'touch') => ({ track: tr, x, y, rowHeight: 56, timeS: 100 + x / 10, secondsPerPixel: 0.1, pointerType: type });
  const laneY = (lane) => 2 + (LANES.indexOf(lane) + 0.5) * ((56 - 4) / LANES.length);

  const tap = pointer.pointerdown(info(6, laneY('gear')));       // gear event at 100.5 -> x = 5
  assert.deepEqual(ed.selected, { channel: 'gear', index: 0 });
  tap.move(info(7, laneY('gear')));                              // below the threshold
  tap.up(info(7, laneY('gear')));
  assert.equal(ed.dirty, false);

  const drag = pointer.pointerdown(info(5, laneY('gear')));
  drag.move(info(25, laneY('gear')));                            // +2 s
  assert.equal(ed.selectedEvent().timeS, 102.5);
  drag.move(info(70, laneY('gear')));                            // clamped by the next gear event
  assert.ok(Math.abs(ed.selectedEvent().timeS - 106.4) < 1e-9);
  drag.up(info(70, laneY('gear')));
  ed.undo();                                                     // one drag = one undo step
  assert.equal(ed.selectedEvent().timeS, 100.5);

  const empty = pointer.pointerdown(info(80, laneY('strobe'), 'mouse'));   // no marker there
  assert.equal(h.state.time, 108);
  empty.move(info(90, laneY('strobe'), 'mouse'));
  assert.equal(h.state.time, 109);
  assert.equal(pointer.pointerdown({ ...info(5, laneY('gear')), track: { ...tr, id: 'other' } }), null, 'other tracks keep the normal drag');
});

test('event-editor: the lanes replace the built-in event triangles of the edited track only', async () => {
  const { h, tr } = await setup();
  assert.deepEqual([...h.rowRequests], [104], 'the editor asks the timeline for taller rows while it runs');
  const layer = [...h.layers][0];
  assert.equal(layer.replacesEvents(tr), true);
  assert.equal(layer.replacesEvents({ id: 'other' }), false);
  const calls = [];
  const g = new Proxy({}, { get: (_, k) => (k === 'save' || k === 'restore' ? () => {} : (...a) => { calls.push(k); }), set: () => true });
  layer.draw(g, { track: tr, top: 0, height: 56, width: 500, toX: (s) => (s - 100) * 10 });
  assert.ok(calls.includes('arc'), 'markers are drawn');
});

test('event-editor: force on ground sets only the ground bit, remembers the imported flags and restores them, with events edited in the same step', async () => {
  const { tr, h, ed } = await setup();
  const imported = flagsOfPositions(tr);
  assert.deepEqual(imported, [2, 2, 2, 2, 2, 0, 0, 0, 0, 0]);
  h.state.time = 108;
  ed.add('gear', 1);                                             // inserts a frame: positions keep their order
  ed.setForceGround(true);
  ed.done();
  assert.deepEqual(flagsOfPositions(tr), [3, 3, 3, 3, 3, 1, 1, 1, 1, 1]);
  assert.ok(tr.ext.forceOnGround);
  assert.deepEqual(Array.from(tr.frames.alt).filter((_, i) => tr.frames.types[i] === 1), [1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009], 'altitude untouched');
  h.history.undo();
  assert.deepEqual(flagsOfPositions(tr), imported);
  assert.equal(tr.ext.forceOnGround, undefined);
  h.history.redo();
  assert.deepEqual(flagsOfPositions(tr), [3, 3, 3, 3, 3, 1, 1, 1, 1, 1]);

  const again = createEditor(ctxOf(h), 't1');
  assert.equal(again.forceGround, true, 'the checkbox starts checked');
  again.setForceGround(false);
  again.done();
  assert.deepEqual(flagsOfPositions(tr), imported);
  assert.equal(tr.ext.forceOnGround, undefined);
});

test('event-editor: nothing to apply ends the session without a history entry; disabling the plugin ends it too', async () => {
  const { h, ed } = await setup();
  ed.done();
  assert.equal(h.history.canUndo, false);
  assert.equal(ed.ended, true);
  const second = createEditor(ctxOf(h), 't1');
  second.cancel();
  second.cancel();                                               // harmless twice
  assert.equal(h.layers.size, 0);
});

test('panel: time text round trip', () => {
  assert.equal(formatTime(75.44), '1:15.4');
  assert.equal(formatTime(3725.4), '1:02:05.4');
  assert.equal(parseTime('1:15.4'), 75.4);
  assert.equal(parseTime('75,4'), 75.4);
  assert.ok(Number.isNaN(parseTime('abc')));
  assert.ok(Number.isNaN(parseTime('')));
});
