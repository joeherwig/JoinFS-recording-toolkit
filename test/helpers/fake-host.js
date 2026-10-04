// Runs a first-party plugin folder under node --test: a real PluginHost reading `plugins/<id>/` from disk, with
// the app services replaced by recorders (drag guards, timeline layers, mode bars, executed commands).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PluginHost } from '../../src/plugins/host.js';
import { FormatRegistry } from '../../src/formats/registry.js';
import { Shortcuts } from '../../src/shortcuts.js';
import { History } from '../../src/history.js';

const PLUGINS_DIR = new URL('../../plugins/', import.meta.url);

export async function loadPlugin(id, { tracks = [], locale = 'en', storage = {} } = {}) {
  const warnings = [];
  const toasts = [];
  const guards = new Set();
  const layers = new Set();
  const modeBars = [];
  const messages = {};
  const redraws = { count: 0 };
  const state = { time: 0, selected: tracks[0] ? tracks[0].id : null };
  const history = new History();
  const env = {
    baseUrl: PLUGINS_DIR.href,
    locale,
    fetchJson: async (url) => JSON.parse(fs.readFileSync(fileURLToPath(url), 'utf8')),
    importModule: (url) => import(url),
    storage: { get: (k) => storage[k] ?? null, set: (k, v) => { storage[k] = v; } },
    warn: (m) => warnings.push(m),
  };
  const services = {
    formats: new FormatRegistry(), shortcuts: new Shortcuts(),
    getTracks: () => tracks,
    exec: (c) => history.exec(c),
    toast: (m) => toasts.push(m),
    t: (k, p) => { let s = messages[k] ?? k; for (const [a, b] of Object.entries(p || {})) s = s.replaceAll(`{${a}}`, b); return s; },
    addMessages: (prefix, dict) => { for (const [k, v] of Object.entries(dict)) messages[prefix + k] = v; },
    addDragGuard: (fn) => { guards.add(fn); return () => guards.delete(fn); },
    addTimelineLayer: (layer) => { layers.add(layer); return () => layers.delete(layer); },
    requestRedraw: () => { redraws.count++; },
    openModeBar: (spec) => {
      const bar = { spec, closed: false, values: {}, setValues(v) { Object.assign(this.values, v); }, close() { this.closed = true; } };
      for (const f of spec.fields || []) bar.values[f.id] = f.value;
      modeBars.push(bar);
      return bar;
    },
    getTime: () => state.time,
    setTime: (s) => { state.time = s; },
    getSelectedId: () => state.selected,
  };
  const host = new PluginHost(env, services);
  await host.loadAll([id]);
  return {
    host, history, redraws, warnings, toasts, guards, layers, modeBars, state, messages, tracks,
    canDrag: (track) => [...guards].every((g) => g(track) !== false),
    lastModeBar: () => modeBars[modeBars.length - 1],
    status: () => host.status().find((p) => p.id === id),
  };
}

/** Minimal track with N position frames at 1 s spacing (times start at `t0`). */
export function makeTrack({ id = 't1', frames = 10, t0 = 100 } = {}) {
  const n = frames;
  const times = new Float64Array(n).map((_, i) => t0 + i);
  return {
    id, callsign: 'TEST', timeOffsetS: 0, ext: {},
    frames: {
      times, types: new Uint8Array(n).fill(1),
      lat: new Float64Array(n), lon: new Float64Array(n), alt: new Float64Array(n),
      pitch: new Float32Array(n), bank: new Float32Array(n), heading: new Float32Array(n),
      vX: new Float32Array(n), vY: new Float32Array(n), vZ: new Float32Array(n),
      elevation: new Float32Array(n), staticCgToGround: new Float32Array(n), groundFlags: new Uint8Array(n),
      kin: new Float32Array(n * 6), ctl: new Int16Array(n * 5), opaquePayload: new Array(n).fill(null),
    },
    events: [],
  };
}
