import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeJfsFile, decodeJfsFile, TARGET_VERSION, LAYOUT } from '../src/jfs-codec.js';
import { buildSyntheticTrack } from './helpers/jfs-samples.js';

function closeTo(a, b, eps, msg) {
  assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b} (eps ${eps})`);
}

test('round trip: single aircraft, buildVariant "other" - position/attitude/velocity survive, no livery field written', () => {
  const track = buildSyntheticTrack({ withLivery: true }); // livery set in memory, but 'other' must not write it
  const bytes = encodeJfsFile([track], { buildVariant: 'other' });
  const { version, tracks, warnings } = decodeJfsFile(bytes.buffer);

  assert.equal(version, TARGET_VERSION);
  assert.equal(warnings.length, 0);
  assert.equal(tracks.length, 1);
  const out = tracks[0];
  assert.equal(out.callsign, track.callsign);
  assert.equal(out.icaoType, track.icaoType);
  assert.equal(out.livery, '', 'other-builds tail has no livery field at all, so it must decode as empty even though the source track object had one set');
  assert.equal(out.detectedBuildVariant, 'other');

  for (let i = 0; i < track.frames.times.length; i++) {
    closeTo(out.frames.times[i], track.frames.times[i], 1e-9, `time[${i}]`);
    closeTo(out.frames.lat[i], track.frames.lat[i], 1e-6, `lat[${i}]`);
    closeTo(out.frames.lon[i], track.frames.lon[i], 1e-6, `lon[${i}]`);
    closeTo(out.frames.alt[i], track.frames.alt[i], 1e-2, `alt[${i}]`);
    closeTo(out.frames.heading[i], track.frames.heading[i], 0.01, `heading[${i}]`);
    closeTo(out.frames.vX[i], track.frames.vX[i], 0.01, `vX[${i}]`);
    closeTo(out.frames.vZ[i], track.frames.vZ[i], 0.01, `vZ[${i}]`);
    assert.equal(out.frames.groundFlags[i], track.frames.groundFlags[i]);
  }
});

test('round trip: buildVariant "fs2024" preserves livery', () => {
  const track = buildSyntheticTrack({ withLivery: true });
  const bytes = encodeJfsFile([track], { buildVariant: 'fs2024' });
  const { tracks } = decodeJfsFile(bytes.buffer);
  assert.equal(tracks[0].livery, 'White/Blue');
  assert.equal(tracks[0].detectedBuildVariant, 'fs2024');
});

test('round trip: multiple aircraft in one file', () => {
  const a = buildSyntheticTrack({ id: 'a', callsign: 'ALPHA', frameCount: 20 });
  const b = buildSyntheticTrack({ id: 'b', callsign: 'BRAVO', frameCount: 30, startTime: 5 });
  const bytes = encodeJfsFile([a, b], { buildVariant: 'other' });
  const { tracks } = decodeJfsFile(bytes.buffer);
  assert.equal(tracks.length, 2);
  assert.equal(tracks[0].callsign, 'ALPHA');
  assert.equal(tracks[1].callsign, 'BRAVO');
  assert.equal(tracks[0].frames.times.length, 20);
  assert.equal(tracks[1].frames.times.length, 30);
});

test('decodeJfsFile rejects files below the minimum supported version', () => {
  const buf = new ArrayBuffer(6);
  new DataView(buf).setInt16(0, 9999, true);
  assert.throws(() => decodeJfsFile(buf), /older than JoinFS/);
});

test('SimEvent/IntegerVariables/FloatVariables frames round-trip byte-for-byte via opaque passthrough', () => {
  // Hand-build one aircraft with one AircraftPositionFrame followed by a SimEvent frame and an
  // IntegerVariables frame carrying a known gear-id entry, to prove the reader-gap fixes: SimEvent
  // used to be silently discarded, and Integer/FloatVariables frames must still decode their known
  // ids into `events` while being preserved byte-for-byte on save.
  const track = buildSyntheticTrack({ frameCount: 1 });
  const opaqueSimEvent = new Uint8Array(8);
  new DataView(opaqueSimEvent.buffer).setUint32(0, 42, true); // eventId
  new DataView(opaqueSimEvent.buffer).setUint32(4, 7, true); // data

  const GEAR_ID = 2991743992;
  const opaqueIntVars = new Uint8Array(2 + 8);
  const dv = new DataView(opaqueIntVars.buffer);
  dv.setUint16(0, 1, true);
  dv.setUint32(2, GEAR_ID, true);
  dv.setInt32(6, 1, true); // gear down

  track.frames.times = new Float64Array([...track.frames.times, 0.1, 0.2]);
  track.frames.types = new Uint8Array([...track.frames.types, 10, 11]);
  track.frames.opaquePayload = [...track.frames.opaquePayload, opaqueSimEvent, opaqueIntVars];
  // pad the other columns to match the new frame count (values unused for non-position frame types)
  for (const key of ['lat', 'lon', 'alt', 'pitch', 'bank', 'heading', 'vX', 'vY', 'vZ', 'elevation', 'staticCgToGround', 'groundFlags']) {
    const arr = track.frames[key];
    const Ctor = arr.constructor;
    track.frames[key] = new Ctor([...arr, 0, 0]);
  }

  const bytes = encodeJfsFile([track], { buildVariant: 'other' });
  const { tracks } = decodeJfsFile(bytes.buffer);
  const out = tracks[0];
  assert.equal(out.frames.times.length, 3);
  assert.equal(out.frames.types[1], 10);
  assert.deepEqual(Array.from(out.frames.opaquePayload[1]), Array.from(opaqueSimEvent));
  assert.equal(out.frames.types[2], 11);
  assert.deepEqual(Array.from(out.frames.opaquePayload[2]), Array.from(opaqueIntVars));
  assert.equal(out.events.length, 1);
  assert.equal(out.events[0].label, 'Gear: Down');
});

test('events are only recorded on a value change, not on every repeated frame (dedup)', () => {
  // Reported bug: "the event shows continuous elements" - the recorder writes a variable's current
  // value periodically even when it hasn't changed, so without dedup a single gear-down produces one
  // event per frame it's repeated in (real files: thousands). Build 4 IntegerVariables frames -
  // gear=1, gear=1 (repeat), gear=0 (change), gear=0 (repeat) - and expect exactly 2 events.
  const GEAR_ID = 2991743992;
  const track = buildSyntheticTrack({ frameCount: 1 });
  const makeGearFrame = (down) => {
    const buf = new Uint8Array(2 + 8);
    const dv = new DataView(buf.buffer);
    dv.setUint16(0, 1, true);
    dv.setUint32(2, GEAR_ID, true);
    dv.setInt32(6, down ? 1 : 0, true);
    return buf;
  };
  const extraPayloads = [makeGearFrame(true), makeGearFrame(true), makeGearFrame(false), makeGearFrame(false)];
  const extraTimes = [0.1, 0.2, 0.3, 0.4];

  track.frames.times = new Float64Array([...track.frames.times, ...extraTimes]);
  track.frames.types = new Uint8Array([...track.frames.types, ...extraTimes.map(() => 11)]);
  track.frames.opaquePayload = [...track.frames.opaquePayload, ...extraPayloads];
  for (const key of ['lat', 'lon', 'alt', 'pitch', 'bank', 'heading', 'vX', 'vY', 'vZ', 'elevation', 'staticCgToGround', 'groundFlags']) {
    const arr = track.frames[key];
    const Ctor = arr.constructor;
    track.frames[key] = new Ctor([...arr, ...extraTimes.map(() => 0)]);
  }

  const bytes = encodeJfsFile([track], { buildVariant: 'other' });
  const { tracks } = decodeJfsFile(bytes.buffer);
  const events = tracks[0].events;
  assert.equal(events.length, 2, `expected exactly 2 transitions, got ${JSON.stringify(events)}`);
  assert.equal(events[0].label, 'Gear: Down');
  assert.equal(events[0].timeS, 0.1);
  assert.equal(events[1].label, 'Gear: Up');
  assert.equal(events[1].timeS, 0.3);
});

// ---- position-frame layouts (current JoinFS vs 26.6-beta; same version number 21008) -------------

test('writer emits the current layout: 96-byte position frames, no static CG field', () => {
  const track = buildSyntheticTrack({ frameCount: 10 });
  const current = encodeJfsFile([track], { buildVariant: 'other' });
  const legacy = encodeJfsFile([track], { buildVariant: 'other', layout: LAYOUT.LEGACY_STATIC_CG });
  assert.equal(legacy.length - current.length, 10 * 4, 'the legacy layout is exactly 4 bytes per position frame longer');
  // header(2+4) + plane(1) + 3 strings + typerole(1) + frameCount(4) precede the frames
  const dv = new DataView(current.buffer);
  assert.equal(dv.getInt16(0, true), 21008);
  let p = 6 + 1;
  for (let i = 0; i < 3; i++) p += 1 + current[p]; // 7-bit length prefix < 128 for these short strings
  p += 1 + 4;
  assert.equal(current[p], 1, 'first frame is an AircraftPosition frame');
  assert.equal(current[p + 96], 1, 'the second frame starts exactly 96 bytes later');
  // last byte of the first frame is the ground-flags byte (synthetic track starts on the ground)
  assert.equal(current[p + 95], 1);
});

test('reader auto-detects the layout and reports it', () => {
  const track = buildSyntheticTrack({ frameCount: 40 });
  for (const buildVariant of ['fs2024', 'other']) {
    const current = decodeJfsFile(encodeJfsFile([track], { buildVariant }).buffer);
    assert.equal(current.layout, LAYOUT.CURRENT);
    assert.equal(current.warnings.length, 0);
    assert.equal(current.tracks[0].sourceLayout, LAYOUT.CURRENT);
    assert.ok(Number.isNaN(current.tracks[0].frames.staticCgToGround[0]) || current.tracks[0].frames.staticCgToGround[0] === 0);

    const legacy = decodeJfsFile(encodeJfsFile([track], { buildVariant, layout: LAYOUT.LEGACY_STATIC_CG }).buffer);
    assert.equal(legacy.layout, LAYOUT.LEGACY_STATIC_CG);
    assert.equal(legacy.tracks[0].frames.times.length, 40);
    assert.equal(legacy.tracks[0].frames.staticCgToGround[0], 1.5, 'the legacy layout still carries the static CG height');
    assert.equal(legacy.tracks[0].callsign, track.callsign);
    assert.ok(legacy.warnings.some((w) => /older recording layout/.test(w)));
  }
});

test('layout detection works for multi-aircraft files in both layouts', () => {
  const a = buildSyntheticTrack({ id: 'a', callsign: 'ALPHA', frameCount: 20 });
  const b = buildSyntheticTrack({ id: 'b', callsign: 'BRAVO', frameCount: 33, startTime: 5 });
  for (const layout of [LAYOUT.CURRENT, LAYOUT.LEGACY_STATIC_CG]) {
    const out = decodeJfsFile(encodeJfsFile([a, b], { buildVariant: 'fs2024', layout }).buffer);
    assert.equal(out.layout, layout);
    assert.deepEqual(out.tracks.map((t) => [t.callsign, t.frames.times.length]), [['ALPHA', 20], ['BRAVO', 33]]);
  }
});

test('a file that fits no layout is rejected with a message that lists what was tried', () => {
  const bytes = encodeJfsFile([buildSyntheticTrack({ frameCount: 30 })], { buildVariant: 'other' });
  const damaged = bytes.slice(0, bytes.length - 40); // cut into the last frames and the tail
  assert.throws(() => decodeJfsFile(damaged.buffer), /could not be read as any known \.jfs layout.*current.*legacy-staticcg/s);
});

test('pre-21008 files never probe the static CG layout', () => {
  const bytes = encodeJfsFile([buildSyntheticTrack({ frameCount: 12 })], { buildVariant: 'other' });
  new DataView(bytes.buffer).setInt16(0, 21007, true);
  const out = decodeJfsFile(bytes.buffer);
  assert.equal(out.layout, LAYOUT.CURRENT);
  assert.equal(out.version, 21007);
});
