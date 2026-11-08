// The event editor's session: a draft copy of the track's gear / flaps / light state changes that the timeline
// lanes, the pointer handling, the keys and the panel all work on. Nothing touches the track until Done, which
// applies the draft as ONE undoable command (events and the forced on-ground flag together); Cancel throws it away.
//
// The rules that keep a channel free of no-op events live in the host (ctx.variables.rules); this file only decides
// what to do with their answers (select the new event, tell the user what was merged, ...).

export const LANES = ['gear', 'flaps', 'nav', 'beacon', 'landing', 'taxi', 'strobe'];
/** Fixed neutral colours: readable on the light and the dark theme (theme tokens are not available to plugins yet). */
export const COLORS = {
  gear: '#3b82f6', flaps: '#10b981', nav: '#ef4444', beacon: '#f97316', landing: '#eab308', taxi: '#84cc16', strobe: '#a855f7',
};
const LANE_PAD = 2;
const ROW_HEIGHT_PX = 104; // 7 lanes of about 14 px
const DRAG_START_PX = 4;
const round3 = (x) => Math.round(x * 1000) / 1000;
const clone = (channels) => Object.fromEntries(Object.entries(channels).map(([k, v]) => [k, v.map((e) => ({ ...e }))]));

/** Keys of the session. The same list registers the handlers and fills the help dialog. */
export const SHORTCUTS = [
  { id: 'delete', key: 'Delete', label: 'Del', help: 'help.delete', run: (ed) => ed.remove() },
  { id: 'backspace', key: 'Backspace', label: '⌫', help: 'help.delete', run: (ed) => ed.remove() },
  { id: 'earlier', key: 'ArrowLeft', label: '←', help: 'help.earlier', run: (ed) => ed.nudge(-0.1) },
  { id: 'later', key: 'ArrowRight', label: '→', help: 'help.later', run: (ed) => ed.nudge(0.1) },
  { id: 'earlier1', key: 'ArrowLeft', shift: true, label: 'Shift+←', help: 'help.earlier1', run: (ed) => ed.nudge(-1) },
  { id: 'later1', key: 'ArrowRight', shift: true, label: 'Shift+→', help: 'help.later1', run: (ed) => ed.nudge(1) },
  { id: 'prev', key: 'ArrowUp', label: '↑', help: 'help.prev', run: (ed) => ed.selectRelative(-1) },
  { id: 'next', key: 'ArrowDown', label: '↓', help: 'help.next', run: (ed) => ed.selectRelative(1) },
  { id: 'add', key: 'Enter', label: 'Enter', help: 'help.add', run: (ed) => ed.emit('add-request') },
  { id: 'help', key: '?', label: '?', help: 'help.toggle', run: (ed) => ed.emit('help-request') },
  { id: 'cancel', key: 'Escape', label: 'Esc', help: 'help.cancel', run: (ed) => ed.cancel() },
];

/** `onEnd()` is called once when the session is over (Done or Cancel). */
export function createEditor(ctx, trackId, { onEnd } = {}) {
  const rules = ctx.variables.rules;
  const live = () => ctx.tracks.get(trackId);
  const first = live();
  const { t0, t1 } = (() => {
    const times = first.frames.times;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < times.length; i++) { if (times[i] < lo) lo = times[i]; if (times[i] > hi) hi = times[i]; }
    return { t0: lo, t1: hi };
  })();

  let channels = ctx.variables.extract(trackId);
  const initialJson = JSON.stringify(channels);
  const initialGround = !!first.ext.forceOnGround;
  let forceGround = initialGround;
  let selected = null; // { channel, index }
  const undoStack = [];
  let redoStack = [];
  const listeners = new Map();
  const disposers = [];
  let ended = false;

  const ed = {
    trackId, t0, t1,
    get channels() { return channels; },
    get selected() { return selected; },
    get forceGround() { return forceGround; },
    get ended() { return ended; },
    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },
    get dirty() { return JSON.stringify(channels) !== initialJson || forceGround !== initialGround; },

    on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); return () => listeners.get(name).delete(fn); },
    emit(name, detail) { for (const fn of listeners.get(name) || []) fn(detail); },
    changed() { ctx.ui.requestRedraw(); ed.emit('change'); },

    /** Every event of every channel in time order: [{ channel, index, timeS, value }]. */
    events() {
      const out = [];
      for (const ch of LANES) channels[ch].forEach((e, index) => out.push({ channel: ch, index, timeS: e.timeS, value: e.value }));
      return out.sort((a, b) => a.timeS - b.timeS || LANES.indexOf(a.channel) - LANES.indexOf(b.channel));
    },
    selectedEvent() { return selected ? { ...channels[selected.channel][selected.index], channel: selected.channel, index: selected.index } : null; },
    /** The playhead in the track's own time (the playhead is project time). */
    playheadS() { return round3(ctx.time.get() - live().timeOffsetS); },
    /** The state of every channel at `timeS`: { gear: 1, flaps: 0.25, nav: 0, ... } (undefined when a channel has no events). */
    stateAt(timeS) { return Object.fromEntries(LANES.map((ch) => [ch, rules.stateAt(channels[ch], timeS)])); },
    /** What `Add` offers for a channel at the playhead: the values that would change something (null = any other flaps value). */
    offered(channel, timeS = ed.playheadS()) { return rules.offeredValues(channel, channels[channel], timeS); },

    select(channel, index) { selected = channel == null ? null : { channel, index }; ed.changed(); },
    selectRelative(step) {
      const all = ed.events();
      if (!all.length) return;
      const at = selected ? all.findIndex((e) => e.channel === selected.channel && e.index === selected.index) : -1;
      const next = all[Math.min(Math.max(at + step, 0), all.length - 1)];
      ed.select(next.channel, next.index);
      ctx.time.set(next.timeS + live().timeOffsetS);
    },

    _push() { undoStack.push({ channels: clone(channels), selected: selected && { ...selected }, forceGround }); redoStack = []; },
    _toast(key, params) { ctx.ui.toast(ctx.i18n.t(key, params)); },
    undo() {
      const s = undoStack.pop();
      if (!s) return;
      redoStack.push({ channels: clone(channels), selected: selected && { ...selected }, forceGround });
      ({ channels, selected, forceGround } = { channels: s.channels, selected: s.selected, forceGround: s.forceGround });
      ed.changed();
    },
    redo() {
      const s = redoStack.pop();
      if (!s) return;
      undoStack.push({ channels: clone(channels), selected: selected && { ...selected }, forceGround });
      ({ channels, selected, forceGround } = { channels: s.channels, selected: s.selected, forceGround: s.forceGround });
      ed.changed();
    },

    /** Adds `value` to `channel` at `timeS` (default: the playhead). Returns true when something was added. */
    add(channel, value, timeS = ed.playheadS()) {
      const t = round3(Math.min(Math.max(timeS, t0), t1));
      const r = rules.addEvent(channel, channels[channel], t, value);
      if (!r.ok) { ed._toast(r.reason === 'same' ? 'toast.same' : 'toast.occupied'); return false; }
      ed._push();
      channels[channel] = r.list;
      selected = { channel, index: r.index };
      if (r.removed) ed._toast('toast.redundant', { n: r.removed });
      ed.changed();
      return true;
    },
    remove() {
      if (!selected) return false;
      const { channel, index } = selected;
      ed._push();
      const r = rules.deleteEvent(channel, channels[channel], index);
      channels[channel] = r.list;
      selected = null;
      if (r.removed) ed._toast('toast.redundant', { n: r.removed });
      ed.changed();
      return true;
    },
    nudge(dt) {
      const e = ed.selectedEvent();
      if (!e) return false;
      return ed.moveTo(e.timeS + dt);
    },
    /** Moves the selected event to `timeS` (clamped by its neighbours and the track). `record:false` during a drag. */
    moveTo(timeS, { record = true } = {}) {
      const e = ed.selectedEvent();
      if (!e) return false;
      const r = rules.moveEvent(e.channel, channels[e.channel], e.index, round3(timeS), t0, t1);
      if (r.timeS === e.timeS) return false;
      if (record) ed._push();
      channels[e.channel] = r.list;
      ed.changed();
      return true;
    },
    /** Changes the value of the selected event (flaps). */
    setValue(value) {
      const e = ed.selectedEvent();
      if (!e) return false;
      const r = rules.setEventValue(e.channel, channels[e.channel], e.index, value);
      if (!r.ok) { ed._toast('toast.same'); return false; }
      ed._push();
      channels[e.channel] = r.list;
      if (r.removed) ed._toast('toast.redundant', { n: r.removed });
      ed.changed();
      return true;
    },
    setForceGround(on) {
      if (on === forceGround) return;
      ed._push();
      forceGround = !!on;
      ed.changed();
    },

    /** Applies the draft as one undoable command; nothing to apply just ends the session. */
    done() {
      if (ended) return;
      const name = first.callsign || first.model || first.id;
      if (!ed.dirty) { ed._toast('toast.nochange'); return ed._end(); }
      const eventsChanged = JSON.stringify(channels) !== initialJson;
      const groundChanged = forceGround !== initialGround;
      const next = clone(channels), ground = forceGround;
      let snapshot = null;
      ctx.exec({
        label: 'Edit events',
        do: () => {
          if (eventsChanged) snapshot = ctx.variables.apply(trackId, next);
          if (groundChanged) setGround(live(), ground);
        },
        undo: () => {
          if (groundChanged) setGround(live(), !ground);
          if (eventsChanged && snapshot) ctx.variables.restore(trackId, snapshot);
        },
      });
      ed._toast('toast.done', { name });
      ed._end();
    },
    cancel() { if (!ended) ed._end(); },
    _end() {
      ended = true;
      for (const off of disposers.splice(0)) { try { off(); } catch { /* already gone */ } }
      ctx.ui.requestRedraw();
      ed.emit('end');
      if (onEnd) onEnd();
    },
    _own(off) { disposers.push(off); return off; },
  };

  // the seven lanes need room: ask the timeline for taller rows while the session lasts
  ed._own(ctx.ui.requestRowHeight(ROW_HEIGHT_PX));

  // ---- timeline lanes ------------------------------------------------------------------------------------
  const laneHeight = (rowHeight) => (rowHeight - 2 * LANE_PAD) / LANES.length;
  ed.laneHeight = laneHeight;

  ed._own(ctx.ui.registerTimelineLayer({
    replacesEvents: (track) => track.id === trackId,
    draw(g, { track, top, height, width, toX }) {
      if (track.id !== trackId) return;
      const lh = laneHeight(height);
      const r = Math.min(9, Math.max(3, lh * 0.3));            // markers and letters grow with the rows (vertical zoom)
      g.save();
      g.lineWidth = 1;
      g.strokeStyle = '#f59e0b'; g.setLineDash([4, 3]);
      g.strokeRect(0.5, top + 0.5, Math.max(0, width - 1), height - 1);
      g.setLineDash([]);
      LANES.forEach((ch, i) => {
        const y = top + LANE_PAD + i * lh, cy = y + lh / 2;
        const list = channels[ch];
        g.fillStyle = COLORS[ch];
        g.globalAlpha = 0.07; g.fillRect(0, y, width, lh - 0.5);
        // state bands: gear down / light on shaded, flaps by their opening
        if (list.length) {
          for (let k = 0; k < list.length; k++) {
            const from = k === 0 ? -Infinity : toX(list[k].timeS), to = k === list.length - 1 ? Infinity : toX(list[k + 1].timeS);
            const a = ch === 'flaps' ? Math.min(1, list[k].value) : list[k].value ? 1 : 0;
            if (!a || to < 0 || from > width) continue;
            g.globalAlpha = 0.18 + 0.4 * a * (ch === 'flaps' ? 1 : 0.6);
            const x0 = Math.max(0, from), x1 = Math.min(width, to);
            g.fillRect(x0, y + 0.5, Math.max(0, x1 - x0), lh - 1.5);
          }
        }
        g.globalAlpha = 1;
        g.font = `600 ${Math.min(13, Math.max(7, lh * 0.5))}px system-ui, sans-serif`; g.textBaseline = 'middle';
        g.fillStyle = COLORS[ch];
        g.fillText(ctx.i18n.t(`short.${ch}`), 3, cy);
        list.forEach((e, k) => {
          const x = toX(e.timeS);
          if (x < -8 || x > width + 8) return;
          const sel = selected && selected.channel === ch && selected.index === k;
          g.beginPath(); g.arc(x, cy, sel ? r * 1.4 : r, 0, Math.PI * 2);
          g.fillStyle = COLORS[ch]; g.fill();
          g.lineWidth = sel ? 2 : 1; g.strokeStyle = sel ? '#ffffff' : 'rgba(0,0,0,.55)'; g.stroke();
          if (sel) { g.lineWidth = 1; g.strokeStyle = '#000'; g.beginPath(); g.arc(x, cy, r * 1.4 + 1, 0, Math.PI * 2); g.stroke(); }
        });
      });
      g.restore();
    },
  }));

  /** The event under a pointer: the nearest marker within reach (a finger reaches further than a mouse). */
  ed.hitTest = (info) => {
    const lh = laneHeight(info.rowHeight);
    const reach = info.pointerType === 'mouse' ? 9 : 22;
    let best = null;
    LANES.forEach((ch, i) => {
      const cy = LANE_PAD + i * lh + lh / 2;
      const dy = Math.abs(info.y - cy);
      channels[ch].forEach((e, index) => {
        const dx = Math.abs(e.timeS - info.timeS) / info.secondsPerPixel;
        if (dx > reach) return;
        const score = dx + dy * 1.5;
        if (!best || score < best.score) best = { channel: ch, index, score };
      });
    });
    return best;
  };

  ed._own(ctx.ui.registerTimelinePointer({
    pointerdown(info) {
      if (info.track.id !== trackId) return null;
      const offset = info.track.timeOffsetS;
      const hit = ed.hitTest(info);
      if (!hit) {
        // empty space: put the playhead there (the row must not drag the whole track while its events are edited)
        ctx.time.set(Math.max(0, info.timeS + offset));
        return { move: (i) => ctx.time.set(Math.max(0, i.timeS + offset)), up() {}, cancel() {} };
      }
      ed.select(hit.channel, hit.index);
      const grab = info.timeS - channels[hit.channel][hit.index].timeS; // keeps the marker under the finger where it was grabbed
      const startX = info.x;
      let started = false;
      return {
        move(i) {
          if (!started) {
            if (Math.abs(i.x - startX) < DRAG_START_PX) return;
            started = true;
            ed._push();
          }
          ed.moveTo(i.timeS - grab, { record: false });
        },
        up() {},
        cancel() {},
      };
    },
  }));

  // ---- keys ----------------------------------------------------------------------------------------------
  for (const s of SHORTCUTS) {
    ed._own(ctx.shortcuts.register({ id: `edit-${s.id}`, key: s.key, shift: s.shift, first: true, run: () => s.run(ed) }));
  }

  return ed;
}

/** Sets (on) or restores (off) bit 0 "on ground" of all position frames; the imported flags are kept in ext.forceOnGround. */
export function setGround(track, on) {
  const f = track.frames, ext = track.ext;
  const pos = [];
  for (let i = 0; i < f.types.length; i++) if (f.types[i] === 0 || f.types[i] === 1) pos.push(i);
  if (on) {
    if (!ext.forceOnGround) ext.forceOnGround = { original: Uint8Array.from(pos, (i) => f.groundFlags[i]) };
    for (const i of pos) f.groundFlags[i] |= 1;
  } else if (ext.forceOnGround) {
    const { original } = ext.forceOnGround;
    pos.forEach((i, k) => { f.groundFlags[i] = original[k]; });
    delete ext.forceOnGround;
  }
}
