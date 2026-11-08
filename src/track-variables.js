// Typed access to the gear / flaps / light state changes of a track, and the rules for editing them.
//
// On disk these are opaque IntegerVariables / FloatVariables frames (see track-clip.js). This module reads them as
// one list of state changes per channel, offers pure edit operations that keep every channel free of no-op events
// (an event always differs from the state before it), and writes an edited channel set back into the frames.
//
// Writing back keeps the recording's own refresh ("heartbeat") frames: every existing frame that carries a known
// variable gets that variable's state at its time, and a new frame is added only where an event has no frame yet.
// JoinFS replays variables from the frames, and the converter writes periodic refresh frames so an object that
// spawns late still gets its state, so dropping them would change the replay.

import { parseVariableFrame, buildVariableFrame } from './track-clip.js';
import { VU, decodeKnownVariable } from './variables.js';

const INTEGER_VARIABLES = 11;
const FLOAT_VARIABLES = 12;
const SAME_TIME_S = 1e-6;
const FLAPS_TOLERANCE = 0.005;
/** Smallest distance between two events of one channel that moving is allowed to create. */
export const MIN_GAP_S = 0.1;

/** The editable signals. `bit` is the position in the `lightStates` mask for lights. */
export const CHANNELS = {
  gear: { id: 'gear', vuid: VU.gear, type: INTEGER_VARIABLES, kind: 'gear' },
  flaps: { id: 'flaps', vuid: VU.flaps, type: FLOAT_VARIABLES, kind: 'flaps' },
  nav: { id: 'nav', vuid: VU.nav, type: INTEGER_VARIABLES, kind: 'light', bit: 0 },
  beacon: { id: 'beacon', vuid: VU.beacon, type: INTEGER_VARIABLES, kind: 'light', bit: 1 },
  landing: { id: 'landing', vuid: VU.landing, type: INTEGER_VARIABLES, kind: 'light', bit: 2 },
  taxi: { id: 'taxi', vuid: VU.taxi, type: INTEGER_VARIABLES, kind: 'light', bit: 3 },
  strobe: { id: 'strobe', vuid: VU.strobe, type: INTEGER_VARIABLES, kind: 'light', bit: 4 },
};
export const CHANNEL_IDS = Object.keys(CHANNELS);
const LIGHTS = CHANNEL_IDS.filter((c) => CHANNELS[c].kind === 'light');

export function valuesEqual(channelId, a, b) {
  return channelId === 'flaps' ? Math.abs(a - b) < FLAPS_TOLERANCE : a === b;
}

// ---- reading -----------------------------------------------------------------------------------------------

/** Walks the variable frames in order and yields the value of every known channel after each frame. */
function walkStates(frames, visit) {
  const state = {};
  for (let i = 0; i < frames.times.length; i++) {
    const type = frames.types[i];
    if ((type !== INTEGER_VARIABLES && type !== FLOAT_VARIABLES) || !frames.opaquePayload[i]) continue;
    const entries = parseVariableFrame(type, frames.opaquePayload[i]);
    const touched = new Set();
    const mask = entries.find((e) => e.id === VU.lightStates);
    if (mask) for (const l of LIGHTS) { state[l] = (mask.value >> CHANNELS[l].bit) & 1; touched.add(l); }
    for (const e of entries) {
      const ch = CHANNEL_IDS.find((c) => CHANNELS[c].vuid === e.id);
      if (ch) { state[ch] = e.value; touched.add(ch); }
    }
    if (touched.size) visit(frames.times[i], state, touched);
  }
}

/** Returns `{ gear: [{timeS, value}], flaps: [...], nav: [...], ... }`; the first entry of a channel is its baseline. */
export function extractChannels(track) {
  const out = Object.fromEntries(CHANNEL_IDS.map((c) => [c, []]));
  walkStates(track.frames, (t, state, touched) => {
    for (const ch of touched) {
      const list = out[ch];
      if (!list.length || !valuesEqual(ch, list[list.length - 1].value, state[ch])) list.push({ timeS: t, value: state[ch] });
    }
  });
  return out;
}

/** The labelled `track.events` list, derived the same way the decoder does. */
export function deriveEvents(frames) {
  const events = [];
  const last = new Map();
  for (let i = 0; i < frames.times.length; i++) {
    const type = frames.types[i];
    if ((type !== INTEGER_VARIABLES && type !== FLOAT_VARIABLES) || !frames.opaquePayload[i]) continue;
    for (const e of parseVariableFrame(type, frames.opaquePayload[i])) {
      const changed = !last.has(e.id) || last.get(e.id) !== e.value;
      last.set(e.id, e.value);
      if (!changed) continue;
      const known = decodeKnownVariable(e.id, e.value);
      if (known) events.push({ timeS: frames.times[i], variable: known.variable, label: known.label });
    }
  }
  return events;
}

// ---- edit rules (pure, on one channel's list) ---------------------------------------------------------------

/** The value in effect at `timeS`; before the first event that is the baseline. `undefined` for an empty channel. */
export function stateAt(list, timeS) {
  let v = list.length ? list[0].value : undefined;
  for (const e of list) { if (e.timeS <= timeS + SAME_TIME_S) v = e.value; else break; }
  return v;
}

/** Drops every event that equals the one before it. Returns the cleaned list and how many were dropped. */
function normalize(channelId, list) {
  const out = [];
  for (const e of list) {
    if (out.length && valuesEqual(channelId, out[out.length - 1].value, e.value)) continue;
    out.push(e);
  }
  return { list: out, removed: list.length - out.length };
}

/**
 * Adds `value` at `timeS`. Refused (`ok:false`) when the channel is already in that state at that time ('same') or
 * has an event at that very time ('occupied'). Later events that become redundant are dropped (`removed`).
 */
export function addEvent(channelId, list, timeS, value) {
  if (list.length && valuesEqual(channelId, stateAt(list, timeS), value)) return { ok: false, reason: 'same' };
  if (list.some((e) => Math.abs(e.timeS - timeS) < SAME_TIME_S)) return { ok: false, reason: 'occupied' };
  const merged = [...list, { timeS, value }].sort((a, b) => a.timeS - b.timeS);
  const n = normalize(channelId, merged);
  return { ok: true, list: n.list, removed: n.removed, index: n.list.findIndex((e) => e.timeS === timeS) };
}

/** Deletes event `index`; a follower that now equals the carried-on state is dropped too (`removed` counts it). */
export function deleteEvent(channelId, list, index) {
  const n = normalize(channelId, list.filter((_, i) => i !== index));
  return { ok: true, list: n.list, removed: n.removed };
}

/** The earliest / latest time event `index` may take: its same-channel neighbours (MIN_GAP_S away) or the track. */
export function moveLimits(list, index, trackStartS, trackEndS) {
  return {
    min: index > 0 ? list[index - 1].timeS + MIN_GAP_S : trackStartS,
    max: index < list.length - 1 ? list[index + 1].timeS - MIN_GAP_S : trackEndS,
  };
}

/** Moves event `index` to `timeS`, clamped between its neighbours and the track; never reorders or duplicates. */
export function moveEvent(channelId, list, index, timeS, trackStartS, trackEndS) {
  const { min, max } = moveLimits(list, index, trackStartS, trackEndS);
  const t = Math.min(Math.max(timeS, min), Math.max(min, max));
  return { ok: true, list: list.map((e, i) => (i === index ? { ...e, timeS: t } : e)), timeS: t };
}

/** Changes the value of event `index` (e.g. a flaps step). Refused when it would equal the state before it. */
export function setEventValue(channelId, list, index, value) {
  if (index > 0 && valuesEqual(channelId, list[index - 1].value, value)) return { ok: false, reason: 'same' };
  const n = normalize(channelId, list.map((e, i) => (i === index ? { ...e, value } : e)));
  return { ok: true, list: n.list, removed: n.removed };
}

/** Values still allowed at `timeS`: gear/lights only the opposite of the current state, flaps `null` = any other value. */
export function offeredValues(channelId, list, timeS) {
  const cur = stateAt(list, timeS);
  if (CHANNELS[channelId].kind === 'flaps') return null;
  if (cur === undefined) return [0, 1];
  return [cur ? 0 : 1];
}

// ---- writing -----------------------------------------------------------------------------------------------

function maskAt(channels, t) {
  let mask = 0;
  for (const l of LIGHTS) if (stateAt(channels[l], t)) mask |= 1 << CHANNELS[l].bit;
  return mask;
}

/** Rewrites the known entries of an existing variable frame to the edited state at its time. */
function rewriteFrame(type, payload, t, channels) {
  let changed = false;
  const entries = parseVariableFrame(type, payload).map((e) => {
    let value;
    if (e.id === VU.lightStates) {
      if (LIGHTS.every((l) => !channels[l].length)) return e;
      value = maskAt(channels, t);
    } else {
      const ch = CHANNEL_IDS.find((c) => CHANNELS[c].vuid === e.id);
      if (!ch || !channels[ch].length) return e;
      value = stateAt(channels[ch], t);
    }
    if (value !== e.value) changed = true;
    return { id: e.id, value };
  });
  return changed ? buildVariableFrame(type, entries) : payload;
}

/** The frames an edited channel set needs that no existing frame covers. */
function missingFrames(frames, channels) {
  const have = [];
  for (let i = 0; i < frames.times.length; i++) {
    const type = frames.types[i];
    if ((type !== INTEGER_VARIABLES && type !== FLOAT_VARIABLES) || !frames.opaquePayload[i]) continue;
    have.push({ t: frames.times[i], type, ids: new Set(parseVariableFrame(type, frames.opaquePayload[i]).map((e) => e.id)) });
  }
  const wanted = new Map(); // `${type}@${time}` -> { time, type, channels:Set }
  for (const ch of CHANNEL_IDS) {
    const def = CHANNELS[ch];
    for (const e of channels[ch]) {
      // a light is covered by its own mirror variable or by the mask frame that also carries its bit
      const covers = (h) => h.type === def.type && Math.abs(h.t - e.timeS) < SAME_TIME_S
        && (h.ids.has(def.vuid) || (def.kind === 'light' && h.ids.has(VU.lightStates)));
      if (have.some(covers)) continue;
      const key = `${def.type}@${e.timeS}`;
      if (!wanted.has(key)) wanted.set(key, { time: e.timeS, type: def.type, channels: new Set() });
      wanted.get(key).channels.add(ch);
    }
  }
  const out = [];
  for (const w of wanted.values()) {
    const entries = [];
    for (const ch of w.channels) {
      if (CHANNELS[ch].kind === 'light') continue;
      entries.push({ id: CHANNELS[ch].vuid, value: stateAt(channels[ch], w.time) });
    }
    const lights = [...w.channels].filter((c) => CHANNELS[c].kind === 'light');
    if (lights.length) {
      entries.push({ id: VU.lightStates, value: maskAt(channels, w.time) });
      for (const l of lights) entries.push({ id: CHANNELS[l].vuid, value: stateAt(channels[l], w.time) });
    }
    out.push({ time: w.time, type: w.type, payload: buildVariableFrame(w.type, entries) });
  }
  return out.sort((a, b) => a.time - b.time);
}

/** Builds the new frame columns (typed arrays keep their stride) from the old ones plus inserted frames. */
function rebuildColumns(f, payloads, inserts) {
  const n = f.times.length;
  const total = n + inserts.length;
  const cols = {};
  for (const [key, col] of Object.entries(f)) {
    cols[key] = Array.isArray(col) ? new Array(total).fill(null) : new col.constructor(total * (n ? col.length / n : 1));
  }
  let ins = 0, dst = 0;
  const putInsert = (k) => {
    cols.times[dst] = inserts[k].time; cols.types[dst] = inserts[k].type; cols.opaquePayload[dst] = inserts[k].payload; dst++;
  };
  for (let src = 0; src < n; src++) {
    while (ins < inserts.length && inserts[ins].time < f.times[src]) putInsert(ins++);
    for (const [key, col] of Object.entries(f)) {
      if (Array.isArray(col)) { cols[key][dst] = key === 'opaquePayload' ? payloads[src] : col[src]; continue; }
      const stride = col.length / n;
      for (let k = 0; k < stride; k++) cols[key][dst * stride + k] = col[src * stride + k];
    }
    dst++;
  }
  while (ins < inserts.length) putInsert(ins++);
  return cols;
}

/**
 * Writes an edited channel set into `track` (in place: the columns of `track.frames` are replaced, `track.events`
 * is regenerated). Returns a snapshot for `restoreSnapshot`, the undo of the edit.
 */
export function applyChannels(track, channels) {
  const f = track.frames;
  const snapshot = { frames: { ...f }, events: track.events };
  const payloads = f.opaquePayload.slice();
  for (let i = 0; i < f.times.length; i++) {
    const type = f.types[i];
    if ((type === INTEGER_VARIABLES || type === FLOAT_VARIABLES) && payloads[i]) {
      payloads[i] = rewriteFrame(type, payloads[i], f.times[i], channels);
    }
  }
  const cols = rebuildColumns(f, payloads, missingFrames(f, channels));
  Object.assign(track.frames, cols);
  track.events = deriveEvents(track.frames);
  return snapshot;
}

export function restoreSnapshot(track, snapshot) {
  Object.assign(track.frames, snapshot.frames);
  track.events = snapshot.events;
}
