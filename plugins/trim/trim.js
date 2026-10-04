// Trim: the pure part. Cuts a track (times already in project time) to [startS, endS] and keeps the state that the
// cut-off beginning had established: JoinFS replays gear, flaps, lights and strings from variable frames that are
// only written when something changes, so a plain cut would start the replay with every system in its default
// state. The last value of every variable seen before the new start is therefore written again as one seed frame
// per kind at the new start. The few frame formats needed are parsed here on purpose: plugins do not import core
// modules (PLAN-v2.md §3).

const INTEGER_VARIABLES = 11;
const FLOAT_VARIABLES = 12;
const STRING8_VARIABLES = 13;
const POSITION = 1;

/** Reads a .NET length-prefixed string at `pos`; returns the end offset. */
function skipNetString(u8, pos) {
  let len = 0, shift = 0, p = pos;
  for (;;) {
    const b = u8[p++];
    len |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
  }
  return p + len;
}

/** Parses an integer/float/string8 variable frame payload into [{ id, value }] (string values are raw bytes). */
export function parseVariableFrame(type, payload) {
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const count = dv.getUint16(0, true);
  const entries = [];
  let p = 2;
  for (let i = 0; i < count; i++) {
    const id = dv.getUint32(p, true);
    if (type === STRING8_VARIABLES) {
      const end = skipNetString(payload, p + 4);
      entries.push({ id, value: payload.slice(p + 4, end) });
      p = end;
    } else {
      entries.push({ id, value: type === FLOAT_VARIABLES ? dv.getFloat32(p + 4, true) : dv.getInt32(p + 4, true) });
      p += 8;
    }
  }
  return entries;
}

/** Inverse of parseVariableFrame. */
export function buildVariableFrame(type, entries) {
  let size = 2;
  for (const e of entries) size += 4 + (type === STRING8_VARIABLES ? e.value.length : 4);
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, entries.length, true);
  let p = 2;
  for (const e of entries) {
    dv.setUint32(p, e.id, true);
    if (type === STRING8_VARIABLES) { out.set(e.value, p + 4); p += 4 + e.value.length; } else {
      if (type === FLOAT_VARIABLES) dv.setFloat32(p + 4, e.value, true); else dv.setInt32(p + 4, e.value, true);
      p += 8;
    }
  }
  return out;
}

/**
 * Returns a new track holding only the frames with startS <= time <= endS, preceded by the seed frames.
 * Returns null when no frame is left. The input track is not modified.
 */
export function trimTrack(track, startS, endS) {
  const f = track.frames;
  const n = f.times.length;
  const last = { [INTEGER_VARIABLES]: new Map(), [FLOAT_VARIABLES]: new Map(), [STRING8_VARIABLES]: new Map() };
  const keep = [];
  for (let i = 0; i < n; i++) {
    const t = f.times[i];
    if (t < startS) {
      const type = f.types[i];
      if (last[type] && f.opaquePayload[i]) {
        for (const e of parseVariableFrame(type, f.opaquePayload[i])) last[type].set(e.id, e.value);
      }
    } else if (t <= endS) {
      keep.push(i);
    }
  }
  if (!keep.some((i) => f.types[i] === POSITION || f.types[i] === 0)) return null;

  const seeds = [];
  for (const type of [INTEGER_VARIABLES, FLOAT_VARIABLES, STRING8_VARIABLES]) {
    const map = last[type];
    if (!map.size) continue;
    const entries = [...map].sort((a, b) => a[0] - b[0]).map(([id, value]) => ({ id, value }));
    seeds.push({ type, payload: buildVariableFrame(type, entries) });
  }

  const total = seeds.length + keep.length;
  const frames = {};
  for (const [key, col] of Object.entries(f)) {
    if (Array.isArray(col)) { frames[key] = new Array(total).fill(null); continue; }
    frames[key] = new col.constructor(total * (col.length / n));
  }
  seeds.forEach((seed, k) => {
    frames.times[k] = startS;
    frames.types[k] = seed.type;
    frames.opaquePayload[k] = seed.payload;
  });
  keep.forEach((src, j) => {
    const dst = seeds.length + j;
    for (const [key, col] of Object.entries(f)) {
      if (Array.isArray(col)) { frames[key][dst] = col[src]; continue; }
      const stride = col.length / n;
      for (let k = 0; k < stride; k++) frames[key][dst * stride + k] = col[src * stride + k];
    }
  });
  return { ...track, frames };
}
