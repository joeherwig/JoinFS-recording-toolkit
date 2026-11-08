import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTrack } from './helpers/fake-host.js';
import { buildVariableFrame, parseVariableFrame } from '../src/track-clip.js';
import { VU } from '../src/variables.js';
import {
  extractChannels, deriveEvents, stateAt, addEvent, deleteEvent, moveEvent, setEventValue, offeredValues,
  applyChannels, restoreSnapshot,
} from '../src/track-variables.js';

const INT = 11, FLOAT = 12;

/** Positions at 100..109 plus converter-style variable frames: [time, gear, flaps, landing-light]. */
function trackWith(snapshots) {
  const track = makeTrack({ frames: 10, t0: 100 });
  const f = track.frames;
  const rows = [];
  for (let i = 0; i < 10; i++) rows.push({ t: 100 + i, type: 1, payload: null, pos: i });
  for (const [t, gear, flaps, landing] of snapshots) {
    rows.push({ t, type: INT, payload: buildVariableFrame(INT, [
      { id: VU.gear, value: gear }, { id: VU.lightStates, value: landing << 2 }, { id: VU.landing, value: landing }]) });
    rows.push({ t, type: FLOAT, payload: buildVariableFrame(FLOAT, [{ id: VU.flaps, value: flaps }]) });
  }
  rows.sort((a, b) => a.t - b.t);
  const n = rows.length;
  const next = {};
  for (const [key, col] of Object.entries(f)) next[key] = Array.isArray(col) ? new Array(n).fill(null) : new col.constructor(n * (col.length / 10));
  rows.forEach((r, i) => {
    next.times[i] = r.t; next.types[i] = r.type; next.opaquePayload[i] = r.payload;
    if (r.pos !== undefined) next.alt[i] = 1000 + r.pos;
  });
  track.frames = next;
  track.events = deriveEvents(next);
  return track;
}

const gearAt = (track) => {
  const out = [];
  const f = track.frames;
  for (let i = 0; i < f.times.length; i++) {
    if (f.types[i] === INT) {
      const e = parseVariableFrame(INT, f.opaquePayload[i]).find((x) => x.id === VU.gear);
      if (e) out.push([f.times[i], e.value]);
    }
  }
  return out;
};

test('extractChannels keeps only state changes, first value is the baseline', () => {
  const track = trackWith([[100.5, 1, 0, 0], [102.5, 1, 0, 0], [104.5, 0, 0.5, 1], [106.5, 0, 0.5, 1]]);
  const ch = extractChannels(track);
  assert.deepEqual(ch.gear, [{ timeS: 100.5, value: 1 }, { timeS: 104.5, value: 0 }]);
  assert.deepEqual(ch.flaps, [{ timeS: 100.5, value: 0 }, { timeS: 104.5, value: 0.5 }]);
  assert.deepEqual(ch.landing, [{ timeS: 100.5, value: 0 }, { timeS: 104.5, value: 1 }]);
  assert.deepEqual(ch.nav, [{ timeS: 100.5, value: 0 }], 'the mask gives every light a baseline');
  assert.deepEqual(track.events.map((e) => e.variable).sort(), ['Landing light', 'Landing light', 'flaps', 'flaps', 'gear', 'gear'].sort());
});

test('add: only a different state is accepted, redundant followers are dropped', () => {
  const gear = [{ timeS: 1, value: 1 }, { timeS: 5, value: 0 }, { timeS: 8, value: 1 }];
  assert.deepEqual(offeredValues('gear', gear, 3), [0]);
  assert.equal(addEvent('gear', gear, 3, 1).ok, false);
  assert.equal(addEvent('gear', gear, 3, 1).reason, 'same');
  assert.equal(addEvent('gear', gear, 5, 1).reason, 'occupied');
  const r = addEvent('gear', gear, 3, 0); // gear up at 3: the up at 5 becomes redundant
  assert.equal(r.ok, true);
  assert.equal(r.removed, 1);
  assert.deepEqual(r.list.map((e) => [e.timeS, e.value]), [[1, 1], [3, 0], [8, 1]]);
  assert.equal(addEvent('flaps', [], 2, 0.3).ok, true);
  assert.equal(addEvent('flaps', [{ timeS: 1, value: 0.3 }], 2, 0.301).reason, 'same');
});

test('delete: the previous state carries on and equal followers are dropped', () => {
  const gear = [{ timeS: 1, value: 1 }, { timeS: 5, value: 0 }, { timeS: 8, value: 1 }];
  const r = deleteEvent('gear', gear, 1);
  assert.deepEqual(r.list.map((e) => e.timeS), [1]);
  assert.equal(r.removed, 1);
  assert.deepEqual(deleteEvent('gear', gear, 2).list.length, 2);
});

test('move: clamped between same-channel neighbours and the track, other channels are free', () => {
  const gear = [{ timeS: 1, value: 1 }, { timeS: 5, value: 0 }, { timeS: 8, value: 1 }];
  assert.equal(moveEvent('gear', gear, 1, 99, 0, 10).timeS, 7.9);
  assert.ok(Math.abs(moveEvent('gear', gear, 1, -5, 0, 10).timeS - 1.1) < 1e-9);
  assert.equal(moveEvent('gear', gear, 0, -5, 0, 10).timeS, 0);
  assert.equal(moveEvent('gear', gear, 2, 99, 0, 10).timeS, 10);
});

test('setEventValue refuses a value equal to the state before it', () => {
  const flaps = [{ timeS: 1, value: 0 }, { timeS: 5, value: 0.5 }];
  assert.equal(setEventValue('flaps', flaps, 1, 0).reason, 'same');
  assert.equal(setEventValue('flaps', flaps, 1, 0.25).ok, true);
});

test('applyChannels moves an event, keeps refresh frames, updates the mask and the derived events', () => {
  const track = trackWith([[100.5, 1, 0, 0], [102.5, 1, 0, 0], [104.5, 0, 0, 1], [106.5, 0, 0, 1]]);
  const before = track.frames.times.length;
  const ch = extractChannels(track);
  const moved = moveEvent('landing', ch.landing, 1, 106, 100, 109); // landing light on, 104.5 -> 106 (clamped by nothing)
  ch.landing = moved.list;
  const snap = applyChannels(track, ch);
  assert.equal(track.frames.times.length, before + 1, 'only the new light event at 106 gets a frame of its own');
  const maskAtFrame = (t) => {
    const i = [...track.frames.times].findIndex((x, k) => x === t && track.frames.types[k] === INT);
    return parseVariableFrame(INT, track.frames.opaquePayload[i]).find((e) => e.id === VU.lightStates).value;
  };
  assert.equal(maskAtFrame(104.5), 0, 'frame before the new position no longer lights the landing light');
  assert.equal(maskAtFrame(106.5), 4);
  assert.deepEqual(track.events.filter((e) => e.variable === 'Landing light').map((e) => e.timeS), [100.5, 106]);
  restoreSnapshot(track, snap);
  assert.equal(maskAtFrame(104.5), 4);
});

test('applyChannels adds a frame where an event has none, in time order, with positions untouched', () => {
  const track = trackWith([[100.5, 1, 0, 0], [106.5, 1, 0, 0]]);
  const ch = extractChannels(track);
  const add = addEvent('gear', ch.gear, 103.25, 0);
  assert.equal(add.ok, true);
  ch.gear = add.list;
  const posBefore = Array.from(track.frames.alt).filter((_, i) => track.frames.types[i] === 1);
  applyChannels(track, ch);
  assert.deepEqual(gearAt(track), [[100.5, 1], [103.25, 0], [106.5, 0]]);
  const f = track.frames;
  assert.ok([...f.times].every((t, i) => i === 0 || t >= f.times[i - 1]), 'times stay sorted');
  assert.deepEqual(Array.from(f.alt).filter((_, i) => f.types[i] === 1), posBefore);
  assert.equal(f.kin.length, f.times.length * 6);
  assert.equal(f.opaquePayload.length, f.times.length);
  assert.equal(stateAt(extractChannels(track).gear, 105), 0);
});
