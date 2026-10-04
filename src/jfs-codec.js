// .jfs binary codec.
//
// Writer is a generalized (multi-aircraft) port of `writeJfs`/`stringBytes` from
// joinfs-gpx-to-jfs-webcomponent/src/joinfs-gpx-to-jfs.js (~line 442-499).
// Reader starts from that repo's test/helpers/jfs.js `decode()` and closes the gaps documented in
// PLAN.md Step 6 (ObjectPositionFrame, String8VariablesFrame, SimEventFrame passthrough) plus the
// build-variant tail-layout ambiguity (recording-protocol.md §7.1).
//
// Wire format notes (see JoinFS/docs/recording-protocol.md for the authoritative spec):
//  - little-endian, .NET BinaryWriter-style 7-bit length-prefixed UTF-8 strings, no magic number,
//    no checksum, no length-framing - a single misread desyncs the rest of the file.
//  - lat/lon/pitch/bank/heading are stored in RADIANS, altitude/elevation/staticCgToGround in METRES.
//    This module converts to/from degrees at the read/write boundary so the rest of the app only
//    ever deals in degrees (Leaflet-friendly) - see DEG2RAD/RAD2DEG usage below.
//  - TWO position-frame layouts exist under one version number (21008): the older JoinFS builds
//    (26.6-beta) append a 4-byte `staticCgToGround` to every AircraftPosition payload (91 bytes), the
//    current JoinFS (upstream #181, JfsFrames.cs) no longer writes/reads it (87 bytes). The version
//    cannot tell them apart, so the reader probes both and keeps the one that parses the whole file
//    cleanly; the writer emits the current layout. See docs/format-notes.md.
//  - all recorded objects in a file share one global recording clock (confirmed directly in
//    JoinFS/Recorder.cs); frame `time` is seconds since that shared clock started.

import { decodeKnownVariable } from './variables.js';

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

export const FRAME_TYPE = {
  OBJECT_POSITION: 0,
  AIRCRAFT_POSITION: 1,
  SIM_EVENT: 10,
  INTEGER_VARIABLES: 11,
  FLOAT_VARIABLES: 12,
  STRING8_VARIABLES: 13,
};

const MIN_SUPPORTED_VERSION = 10022;
export const TARGET_VERSION = 21008;

/** Position-frame layouts. `current` = what JoinFS writes/reads today; `legacy-staticcg` = 26.6-beta and our older exports. */
export const LAYOUT = { CURRENT: 'current', LEGACY_STATIC_CG: 'legacy-staticcg' };
// Files below this version never carry the static CG field, whatever build wrote them.
const STATIC_CG_VERSION = 21008;

const LAT_LIMIT_RAD = Math.PI / 2 + 1e-3;
const LON_LIMIT_RAD = Math.PI + 1e-3;

export class JfsError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'JfsError';
    this.code = code;
  }
}

// ---- strings -------------------------------------------------------------

function readNetString(u8, pos) {
  let len = 0, shift = 0, p = pos;
  for (;;) {
    if (p >= u8.length) throw new JfsError('Unexpected end of file while reading a string.', 'eof');
    const b = u8[p++];
    len |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
  }
  if (p + len > u8.length) throw new JfsError('Unexpected end of file while reading a string.', 'eof');
  const value = new TextDecoder('utf-8').decode(u8.subarray(p, p + len));
  return { value, next: p + len };
}

function netStringBytes(s) {
  const utf8 = new TextEncoder().encode(s || '');
  let n = utf8.length;
  const prefix = [];
  for (;;) {
    const byte = n & 0x7f;
    n >>>= 7;
    if (n) prefix.push(byte | 0x80); else { prefix.push(byte); break; }
  }
  const out = new Uint8Array(prefix.length + utf8.length);
  out.set(prefix, 0);
  out.set(utf8, prefix.length);
  return out;
}

// ---- position frames -------------------------------------------------------
// AircraftPositionFrame payload (after the 9-byte type+time header):
//   lat,lon,alt f64 x3 (24) | pitch,bank,heading f32 x3 (12) | velXYZ f32 x3 (12)
//   | angVelXYZ+accXYZ f32 x6, unused by this app (24) | rudder/elevator/aileron/brakeL/brakeR i16 x5,
//   unused by this app (10) | elevation f32 (4) | groundFlags u8 (1) | staticCgToGround f32 (4, legacy-staticcg only)
// = 87 bytes in the current layout (and at 10023<=v<21008), 91 bytes in the legacy-staticcg layout
// (82 at v<10023 - see PLAN.md Step 6).

function checkPlausible(latRad, lonRad, pos) {
  // A wrong layout lands in the middle of a frame; garbage doubles are almost never a valid lat/lon.
  if (!(Math.abs(latRad) <= LAT_LIMIT_RAD && Math.abs(lonRad) <= LON_LIMIT_RAD)) {
    throw new JfsError(`Implausible position at byte offset ${pos} - wrong frame layout or corrupt file.`, 'badFrame');
  }
}

function decodeAircraftPositionFrame(dv, pos, version, hasStaticCg) {
  const start = pos;
  const latRad = dv.getFloat64(pos, true), lonRad = dv.getFloat64(pos + 8, true);
  checkPlausible(latRad, lonRad, start);
  const lat = latRad * RAD2DEG; pos += 8;
  const lon = lonRad * RAD2DEG; pos += 8;
  const alt = dv.getFloat64(pos, true); pos += 8;
  const pitch = dv.getFloat32(pos, true) * RAD2DEG; pos += 4;
  const bank = dv.getFloat32(pos, true) * RAD2DEG; pos += 4;
  const heading = ((dv.getFloat32(pos, true) * RAD2DEG) % 360 + 360) % 360; pos += 4;
  const vX = dv.getFloat32(pos, true); pos += 4;
  const vY = dv.getFloat32(pos, true); pos += 4;
  const vZ = dv.getFloat32(pos, true); pos += 4;
  // angular velocity + acceleration (6 floats) and rudder/elevator/aileron/brakeL/brakeR (5 raw int16) are not
  // shown by the app but are kept, so a saved file replays exactly like the original: JoinFS integrates the
  // angular velocity to advance the attitude between its periodic updates.
  const kin = [];
  for (let i = 0; i < 6; i++) { kin.push(dv.getFloat32(pos, true)); pos += 4; }
  const ctl = [];
  for (let i = 0; i < 5; i++) { ctl.push(dv.getInt16(pos, true)); pos += 2; }
  let elevation = 0, groundFlags = 0, staticCgToGround = NaN;
  if (version >= 10023) {
    elevation = dv.getFloat32(pos, true); pos += 4;
    groundFlags = dv.getUint8(pos); pos += 1;
  }
  if (hasStaticCg) {
    staticCgToGround = dv.getFloat32(pos, true); pos += 4;
  }
  return { lat, lon, alt, pitch, bank, heading, vX, vY, vZ, kin, ctl, elevation, groundFlags, staticCgToGround, next: pos };
}

// ObjectPositionFrame payload: same lat/lon/alt/pitch/bank/heading/velocity, but no controls and no
// staticCgToGround (recording-protocol.md §4.1). Rare within an Aircraft's own frame list, but legal.
function decodeObjectPositionFrame(dv, pos, version) {
  const latRad = dv.getFloat64(pos, true), lonRad = dv.getFloat64(pos + 8, true);
  checkPlausible(latRad, lonRad, pos);
  const lat = latRad * RAD2DEG; pos += 8;
  const lon = lonRad * RAD2DEG; pos += 8;
  const alt = dv.getFloat64(pos, true); pos += 8;
  const pitch = dv.getFloat32(pos, true) * RAD2DEG; pos += 4;
  const bank = dv.getFloat32(pos, true) * RAD2DEG; pos += 4;
  const heading = ((dv.getFloat32(pos, true) * RAD2DEG) % 360 + 360) % 360; pos += 4;
  const vX = dv.getFloat32(pos, true); pos += 4;
  const vY = dv.getFloat32(pos, true); pos += 4;
  const vZ = dv.getFloat32(pos, true); pos += 4;
  const kin = [];
  for (let i = 0; i < 6; i++) { kin.push(dv.getFloat32(pos, true)); pos += 4; } // angular velocity + acceleration
  let elevation = 0, groundFlags = 0;
  if (version >= 10023) {
    elevation = dv.getFloat32(pos, true); pos += 4;
    groundFlags = dv.getUint8(pos); pos += 1;
  }
  return { lat, lon, alt, pitch, bank, heading, vX, vY, vZ, kin, ctl: null, elevation, groundFlags, staticCgToGround: NaN, next: pos };
}

function encodeAircraftPositionFrame(dv, u8, pos, f, withStaticCg) {
  dv.setFloat64(pos, f.lat * DEG2RAD, true); pos += 8;
  dv.setFloat64(pos, f.lon * DEG2RAD, true); pos += 8;
  dv.setFloat64(pos, f.alt, true); pos += 8;
  dv.setFloat32(pos, f.pitch * DEG2RAD, true); pos += 4;
  dv.setFloat32(pos, f.bank * DEG2RAD, true); pos += 4;
  dv.setFloat32(pos, f.heading * DEG2RAD, true); pos += 4;
  dv.setFloat32(pos, f.vX, true); pos += 4;
  dv.setFloat32(pos, f.vY, true); pos += 4;
  dv.setFloat32(pos, f.vZ, true); pos += 4;
  for (let i = 0; i < 6; i++) { dv.setFloat32(pos, f.kin ? f.kin[i] : 0, true); pos += 4; } // angular velocity + acceleration
  for (let i = 0; i < 5; i++) { dv.setInt16(pos, f.ctl ? f.ctl[i] : 0, true); pos += 2; } // rudder, elevator, aileron, brakeL, brakeR
  dv.setFloat32(pos, f.elevation || 0, true); pos += 4;
  dv.setUint8(pos, f.groundFlags & 0xff); pos += 1; // bit 0 on ground, bit 1 sender had elevation correction
  // The current JoinFS layout has no staticCgToGround field; only the legacy-staticcg layout (kept for
  // tests and for talking to 26.6-beta builds) appends it. NaN if unknown, same convention as the network message.
  if (withStaticCg) { dv.setFloat32(pos, f.staticCgToGround, true); pos += 4; }
  return pos;
}

const POSITION_PAYLOAD_SIZE = { [LAYOUT.CURRENT]: 87, [LAYOUT.LEGACY_STATIC_CG]: 91 }; // after the 9-byte frame header

// ---- variable frames -------------------------------------------------------

function decodeVariablesFrameLength(pos, isFloat) {
  return { count: null, bytesFn: (count) => 2 + count * 8, headerLen: 2, entrySize: 8, isFloat };
}

function readIntFloatVariablesFrame(dv, u8, pos, isFloat) {
  const start = pos;
  const count = dv.getUint16(pos, true); pos += 2;
  const entries = [];
  for (let i = 0; i < count; i++) {
    const id = dv.getUint32(pos, true);
    const value = isFloat ? dv.getFloat32(pos + 4, true) : dv.getInt32(pos + 4, true);
    entries.push({ id, value });
    pos += 8;
  }
  return { entries, start, next: pos };
}

function readString8VariablesFrame(u8, pos) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.length);
  const start = pos;
  const count = dv.getUint16(pos, true); pos += 2;
  for (let i = 0; i < count; i++) {
    pos += 4; // variable id
    const r = readNetString(u8, pos);
    pos = r.next;
  }
  return { start, next: pos };
}

// ---- tail (per-aircraft trailing strings) ----------------------------------
// Shape depends on both file version AND the build variant (FS2024 vs everything else) that wrote
// the file - see recording-protocol.md §7.1. Nothing in the file states which variant wrote it, so
// we speculatively try each plausible layout and validate by peeking at what should follow.

function tailCandidateCounts(version) {
  if (version < 21004) return [0];
  if (version === 21004) return [1, 2]; // fs2024: livery only; other: icaoType+icaoAirline
  return [3, 2]; // v>=21005 - fs2024: livery+icaoType+icaoAirline; other: icaoType+icaoAirline (tried first: fs2024 is the common modern case)
}

function tailStringsToFields(strings, version) {
  // strings.length is 0, 1, 2, or 3, per tailCandidateCounts().
  if (strings.length === 3) return { livery: strings[0], icaoType: strings[1], icaoAirline: strings[2], detectedBuildVariant: 'fs2024' };
  if (strings.length === 1) return { livery: strings[0], icaoType: '', icaoAirline: '', detectedBuildVariant: 'fs2024' };
  if (strings.length === 2) return { livery: '', icaoType: strings[0], icaoAirline: strings[1], detectedBuildVariant: 'other' };
  return { livery: '', icaoType: '', icaoAirline: '', detectedBuildVariant: 'none' };
}

function tryReadTail(u8, pos, count) {
  const strings = [];
  let p = pos;
  for (let i = 0; i < count; i++) {
    const r = readNetString(u8, p);
    strings.push(r.value);
    p = r.next;
  }
  return { strings, next: p };
}

function validateTailEnd(u8, dv, pos, moreAircraftFollow) {
  if (moreAircraftFollow) {
    if (pos >= u8.length) return false;
    const b = u8[pos];
    return b === 0 || b === 1; // next aircraft's `plane` bool
  }
  if (pos + 4 > u8.length) return false;
  const objectCount = dv.getInt32(pos, true);
  if (objectCount < 0 || objectCount > 100000) return false;
  if (objectCount === 0 && pos + 4 !== u8.length) {
    // Not necessarily wrong (a future section could still follow), but less likely to be the
    // right candidate than an exact EOF match, so this is used only as a tie-breaker signal by
    // the caller trying candidates in preference order - no extra action needed here.
  }
  return true;
}

/** Speculative-parse-and-validate tail detection (recording-protocol.md §7.1, PLAN.md Step 6). */
function detectTail(u8, dv, pos, version, moreAircraftFollow) {
  const candidates = tailCandidateCounts(version);
  for (const count of candidates) {
    try {
      const { strings, next } = tryReadTail(u8, pos, count);
      if (validateTailEnd(u8, dv, next, moreAircraftFollow)) {
        return { ...tailStringsToFields(strings, version), next };
      }
    } catch {
      // candidate ran past the buffer or otherwise failed to parse - try the next one
    }
  }
  // Nothing validated: fall back to the first candidate anyway so the file doesn't hard-fail: the
  // post-load sanity summary (callsigns/frame counts surfaced in the UI) is the safety net for a
  // genuinely ambiguous/corrupt file - see PLAN.md Step 6 and "Documented limitations".
  const fallbackCount = candidates[0];
  const { strings, next } = tryReadTail(u8, pos, fallbackCount);
  return { ...tailStringsToFields(strings, version), next, ambiguous: true };
}

// ---- decode -----------------------------------------------------------------

/**
 * Decodes a `.jfs` ArrayBuffer into `{ version, layout, tracks, warnings }`.
 * Each element of `tracks` matches the Track shape in PLAN.md Step 2 (columnar typed-array frames,
 * plus a secondary `events` list decoded from recognized gear/flaps/light variable frames).
 * Non-aircraft `Obj[]` records are out of scope for v1 (see PLAN.md) - if present, a warning is
 * returned and they are not represented in `tracks` or preserved on a later save.
 *
 * The position-frame layout is probed, not read from the version (see the header comment): every
 * candidate layout is tried in order and the first that parses the whole file cleanly wins.
 */
export function decodeJfsFile(arrayBuffer, { sourceFileName = '', onProgress } = {}) {
  const u8 = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);
  if (u8.length < 6) throw new JfsError('File is too small to be a .jfs recording.', 'tooSmall');
  const version = dv.getInt16(0, true);
  if (version < MIN_SUPPORTED_VERSION) {
    throw new JfsError(`Recording version ${version} is older than JoinFS itself supports (minimum ${MIN_SUPPORTED_VERSION}).`, 'badVersion');
  }
  const candidates = version >= STATIC_CG_VERSION ? [LAYOUT.CURRENT, LAYOUT.LEGACY_STATIC_CG] : [LAYOUT.CURRENT];
  const failures = [];
  // pass 1: strict (tail and trailer must validate); pass 2: tolerate an ambiguous tail like v1 did
  for (const strict of [true, false]) {
    for (const layout of candidates) {
      try {
        const result = parseJfs(arrayBuffer, version, layout, { sourceFileName, onProgress, strict });
        if (layout === LAYOUT.LEGACY_STATIC_CG) {
          result.warnings.unshift('This file uses the older recording layout (with a static CG height per position frame). It is read correctly, but saving writes the current JoinFS layout, which does not store that height.');
        }
        return result;
      } catch (err) {
        if (!(err instanceof JfsError) && !(err instanceof RangeError)) throw err;
        failures.push(`${layout}${strict ? '' : ' (lenient)'}: ${err.message}`);
      }
    }
  }
  throw new JfsError(`This file could not be read as any known .jfs layout (${failures.join('; ')}). It may be corrupt or from a newer/incompatible JoinFS build.`, 'badFrame');
}

function parseJfs(arrayBuffer, version, layout, { sourceFileName, onProgress, strict }) {
  const u8 = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);
  const hasStaticCg = layout === LAYOUT.LEGACY_STATIC_CG;
  const warnings = [];
  let p = 2;
  const aircraftCount = dv.getInt32(p, true); p += 4;
  const tracks = [];

  for (let a = 0; a < aircraftCount; a++) {
    const plane = dv.getUint8(p) !== 0; p += 1;
    const rCallsign = readNetString(u8, p); const callsign = rCallsign.value; p = rCallsign.next;
    const rNickname = readNetString(u8, p); const nickname = rNickname.value; p = rNickname.next;
    const rModel = readNetString(u8, p); const model = rModel.value; p = rModel.next;
    const typeRole = dv.getUint8(p); p += 1;
    const frameCount = dv.getInt32(p, true); p += 4;

    const times = new Float64Array(frameCount);
    const types = new Uint8Array(frameCount);
    const lat = new Float64Array(frameCount);
    const lon = new Float64Array(frameCount);
    const alt = new Float64Array(frameCount);
    const pitch = new Float32Array(frameCount);
    const bank = new Float32Array(frameCount);
    const heading = new Float32Array(frameCount);
    const vX = new Float32Array(frameCount);
    const vY = new Float32Array(frameCount);
    const vZ = new Float32Array(frameCount);
    const elevation = new Float32Array(frameCount);
    const staticCgToGround = new Float32Array(frameCount);
    const groundFlags = new Uint8Array(frameCount);
    const kin = new Float32Array(frameCount * 6); // angVelXYZ, accXYZ per frame
    const ctl = new Int16Array(frameCount * 5);   // rudder, elevator, aileron, brakeL, brakeR (raw, value * 16384)
    const opaquePayload = new Array(frameCount).fill(null);
    const events = [];
    // The recorder writes a variable's current value periodically, not only when it changes (real
    // files can carry a "heartbeat" of unchanged values), so recording every matching entry as an
    // event produced thousands of duplicates for a single gear-down/flaps-out (reported bug:
    // "shows continuous elements"). Only the value transitions are meaningful - mirrors
    // joinfs-gpx-to-jfs-webcomponent's own test helper `series()`, which does the same "push only on
    // change" dedup when reading these same frames back out.
    const lastKnownValue = new Map();

    for (let i = 0; i < frameCount; i++) {
      if (onProgress && (i & 8191) === 0) onProgress(i / frameCount);
      const type = dv.getUint8(p);
      const t = dv.getFloat64(p + 1, true);
      p += 9;
      times[i] = t;
      types[i] = type;
      if (type === FRAME_TYPE.AIRCRAFT_POSITION || type === FRAME_TYPE.OBJECT_POSITION) {
        const f = type === FRAME_TYPE.AIRCRAFT_POSITION
          ? decodeAircraftPositionFrame(dv, p, version, hasStaticCg)
          : decodeObjectPositionFrame(dv, p, version);
        lat[i] = f.lat; lon[i] = f.lon; alt[i] = f.alt;
        pitch[i] = f.pitch; bank[i] = f.bank; heading[i] = f.heading;
        vX[i] = f.vX; vY[i] = f.vY; vZ[i] = f.vZ;
        elevation[i] = f.elevation; groundFlags[i] = f.groundFlags; staticCgToGround[i] = f.staticCgToGround;
        for (let k = 0; k < 6; k++) kin[i * 6 + k] = f.kin[k];
        if (f.ctl) for (let k = 0; k < 5; k++) ctl[i * 5 + k] = f.ctl[k];
        p = f.next;
      } else if (type === FRAME_TYPE.SIM_EVENT) {
        opaquePayload[i] = u8.slice(p, p + 8);
        p += 8;
      } else if (type === FRAME_TYPE.INTEGER_VARIABLES || type === FRAME_TYPE.FLOAT_VARIABLES) {
        const isFloat = type === FRAME_TYPE.FLOAT_VARIABLES;
        const r = readIntFloatVariablesFrame(dv, u8, p, isFloat);
        opaquePayload[i] = u8.slice(p, r.next);
        for (const entry of r.entries) {
          const changed = !lastKnownValue.has(entry.id) || lastKnownValue.get(entry.id) !== entry.value;
          lastKnownValue.set(entry.id, entry.value);
          if (!changed) continue;
          const known = decodeKnownVariable(entry.id, entry.value);
          if (known) events.push({ timeS: t, variable: known.variable, label: known.label });
        }
        p = r.next;
      } else if (type === FRAME_TYPE.STRING8_VARIABLES) {
        const r = readString8VariablesFrame(u8, p);
        opaquePayload[i] = u8.slice(p, r.next);
        p = r.next;
      } else {
        throw new JfsError(`Unrecognized frame type ${type} at byte offset ${p - 9} - the file may be corrupt or from a newer/incompatible JoinFS build.`, 'badFrame');
      }
    }

    const tail = detectTail(u8, dv, p, version, a < aircraftCount - 1);
    if (tail.ambiguous) {
      if (strict) throw new JfsError(`Aircraft #${a + 1}: tail strings do not validate for the ${layout} layout.`, 'badTail');
      warnings.push(`Aircraft "${callsign || model}" (#${a + 1}): could not confidently determine the build-variant tail layout; livery/ICAO fields may be misread.`);
    }
    p = tail.next;

    tracks.push({
      id: `t${a}_${Math.random().toString(36).slice(2, 10)}`,
      sourceFileName,
      plane, callsign, nickname, model, typeRole,
      icaoType: tail.icaoType, icaoAirline: tail.icaoAirline, livery: tail.livery,
      detectedBuildVariant: tail.detectedBuildVariant, sourceVersion: version, sourceLayout: layout,
      timeOffsetS: 0, visible: true, showAltitude: true, showSpeed: true, showEvents: true,
      frames: { times, types, lat, lon, alt, pitch, bank, heading, vX, vY, vZ, kin, ctl, elevation, staticCgToGround, groundFlags, opaquePayload },
      events,
    });
  }

  let objectCount = 0;
  if (strict && p !== u8.length && p + 4 > u8.length) {
    throw new JfsError(`Unexpected ${u8.length - p} trailing byte(s) after the aircraft records.`, 'badTrailer');
  }
  if (p + 4 <= u8.length) {
    objectCount = dv.getInt32(p, true);
    p += 4;
    if (strict && (objectCount < 0 || objectCount > 100000 || (objectCount === 0 && p !== u8.length))) {
      throw new JfsError('The section after the aircraft records is not a valid object count.', 'badTrailer');
    }
    if (objectCount > 0) {
      warnings.push(`${objectCount} non-aircraft object(s) present in this file and will not be preserved if you save from this project (see README/PLAN.md limitations).`);
    }
  }

  return { version, layout, tracks, warnings };
}

// ---- encode -----------------------------------------------------------------

/**
 * Encodes an array of Tracks (PLAN.md Step 2 shape, with frame `time` already final/rebased by
 * project-model.js) into a single `.jfs` file.
 * `buildVariant`: 'fs2024' writes the 3-string tail (livery+icaoType+icaoAirline); 'other' writes
 * the 2-string tail (icaoType+icaoAirline only - no livery field at all, matching non-FS2024
 * builds exactly). Always targets TARGET_VERSION (21008). `layout` defaults to the current JoinFS
 * position-frame layout (no staticCgToGround); 'legacy-staticcg' exists for tests and 26.6-beta.
 */
export function encodeJfsFile(tracks, { buildVariant = 'fs2024', layout = LAYOUT.CURRENT } = {}) {
  const fs2024 = buildVariant === 'fs2024';
  const withStaticCg = layout === LAYOUT.LEGACY_STATIC_CG;
  const positionPayload = POSITION_PAYLOAD_SIZE[layout];
  if (!positionPayload) throw new Error(`Unknown layout "${layout}".`);
  const version = TARGET_VERSION;

  // First pass: compute size.
  let size = 2 + 4; // version + aircraftCount
  const headBytesPerTrack = [];
  const tailBytesPerTrack = [];
  for (const track of tracks) {
    const head = [netStringBytes(track.callsign || ''), netStringBytes(track.nickname || ''), netStringBytes(track.model || '')];
    headBytesPerTrack.push(head);
    const tail = fs2024
      ? [netStringBytes(track.livery || ''), netStringBytes(track.icaoType || ''), netStringBytes(track.icaoAirline || '')]
      : [netStringBytes(track.icaoType || ''), netStringBytes(track.icaoAirline || '')];
    tailBytesPerTrack.push(tail);
    const headLen = head.reduce((s, b) => s + b.length, 0);
    const tailLen = tail.reduce((s, b) => s + b.length, 0);
    const frameCount = track.frames.times.length;
    let frameBytes = 0;
    for (let i = 0; i < frameCount; i++) {
      const type = track.frames.types[i];
      frameBytes += 9 + ((type === FRAME_TYPE.AIRCRAFT_POSITION || type === FRAME_TYPE.OBJECT_POSITION)
        ? positionPayload
        : track.frames.opaquePayload[i].length);
    }
    size += 1 + headLen + 1 + 4 + frameBytes + tailLen; // plane + head + typerole + frameCount + frames + tail
  }
  size += 4; // objectCount = 0

  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let p = 0;
  dv.setInt16(p, version, true); p += 2;
  dv.setInt32(p, tracks.length, true); p += 4;

  tracks.forEach((track, idx) => {
    dv.setUint8(p, track.plane === false ? 0 : 1); p += 1;
    for (const b of headBytesPerTrack[idx]) { u8.set(b, p); p += b.length; }
    dv.setUint8(p, track.typeRole || 0); p += 1;
    const frameCount = track.frames.times.length;
    dv.setInt32(p, frameCount, true); p += 4;
    for (let i = 0; i < frameCount; i++) {
      const type = track.frames.types[i];
      const t = track.frames.times[i];
      if (type === FRAME_TYPE.AIRCRAFT_POSITION || type === FRAME_TYPE.OBJECT_POSITION) {
        dv.setUint8(p, FRAME_TYPE.AIRCRAFT_POSITION); p += 1; // always upgraded to the canonical AircraftPositionFrame on write
        dv.setFloat64(p, t, true); p += 8;
        p = encodeAircraftPositionFrame(dv, u8, p, {
          lat: track.frames.lat[i], lon: track.frames.lon[i], alt: track.frames.alt[i],
          pitch: track.frames.pitch[i], bank: track.frames.bank[i], heading: track.frames.heading[i],
          vX: track.frames.vX[i], vY: track.frames.vY[i], vZ: track.frames.vZ[i],
          elevation: track.frames.elevation[i], groundFlags: track.frames.groundFlags[i],
          staticCgToGround: track.frames.staticCgToGround[i],
          kin: track.frames.kin ? track.frames.kin.subarray(i * 6, i * 6 + 6) : null,
          ctl: track.frames.ctl ? track.frames.ctl.subarray(i * 5, i * 5 + 5) : null,
        }, withStaticCg);
      } else {
        dv.setUint8(p, type); p += 1;
        dv.setFloat64(p, t, true); p += 8;
        const payload = track.frames.opaquePayload[i];
        u8.set(payload, p); p += payload.length;
      }
    }
    for (const b of tailBytesPerTrack[idx]) { u8.set(b, p); p += b.length; }
  });

  dv.setInt32(p, 0, true); p += 4; // no non-aircraft objects
  if (p !== size) throw new Error(`jfs-codec internal size mismatch: wrote ${p}, expected ${size}`);
  return u8;
}
