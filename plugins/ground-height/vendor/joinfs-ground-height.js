/*!
 * joinfs-ground-height - ground height along a flight track, and a chart that shows it next to the aircraft altitude.
 *
 * Two parts in one file, like the IGC and GPX converters:
 *   JoinfsGroundHeight                  pure functions (also usable in node):
 *     computeProfile(frames, opts)      looks the terrain height up for a thinned-out set of the track's positions
 *                                       -> Promise<{ times, height, source, points }>   (times: track time in s, height: metres)
 *     interpolate(profile, t)           ground height (m) at track time t
 *     aglSeries(frames, profile)        Float32Array: altitude minus ground height per frame (m), NaN where unknown
 *     statistics(times, alt, profile)   { minAgl, minAglTime, maxAlt, maxGround } over the given frames
 *     fetchElevations(coords, opts)     the terrain lookup itself (Open-Meteo by default, or your own provider)
 *   <joinfs-ground-profile>             custom element: zoomable, scrollable altitude / ground height diagram of ONE aircraft
 *
 * Units: altitude and ground height are METRES everywhere in the data; the chart shows feet or metres (its unit button).
 *
 * Privacy: computeProfile sends the sampled positions (rounded to 4 decimals, about 11 m) to the elevation service.
 * Nothing else leaves the browser. Pass `provider` to use a service of your own.
 *
 * <joinfs-ground-profile>
 *   Attributes  lang (observed; default navigator.languages, English fallback) · locale-base (folder of the locale files,
 *               default the folder of this script) · unit ("ft" default, or "m")
 *   Properties  data = { name, times (s, the x axis), alt (m), ground: { times, height } | null }   (set it, the chart redraws)
 *               playhead = seconds | null
 *   Methods     zoomIn() zoomOut() fit()
 *   Events      'seek' (detail { time }) when the user clicks the diagram
 *
 * License: CC BY-NC-SA 4.0 (see LICENSE)
 */
(function (root) {
  'use strict';

  const M2FT = 3.28084;

  // ==================================================================
  // Ground height lookup
  // ==================================================================
  class GroundHeightError extends Error {
    constructor(message, code) { super(message); this.name = 'GroundHeightError'; this.code = code; }
  }

  const isFix = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

  function distanceM(lat1, lon1, lat2, lon2) {
    const R = 6371008.8, rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /**
   * Which frames to look up: the first and last valid fix, then one every `spacingM` metres along the track, and at least one
   * every `maxGapS` seconds (so a parked aircraft keeps a flat ground height instead of a ramp towards the next point). The
   * spacing and the gap grow for long flights so that about `maxPoints` are looked up at most. Before a jump in time (a gap
   * in the recording) the last frame is sampled too. Returns frame indices, ascending.
   */
  function pickSamples(frames, { spacingM = 250, maxPoints = 600, maxGapS = 60 } = {}) {
    const { times, lat, lon } = frames;
    const valid = [];
    for (let i = 0; i < times.length; i++) if (isFix(lat[i], lon[i])) valid.push(i);
    if (valid.length === 0) return [];
    let total = 0;
    for (let k = 1; k < valid.length; k++) total += distanceM(lat[valid[k - 1]], lon[valid[k - 1]], lat[valid[k]], lon[valid[k]]);
    const budget = Math.max(2, maxPoints / 2 - 2);                  // half for the distance rule, half for the time rule
    const step = Math.max(spacingM, total / budget);
    const gap = Math.max(maxGapS, (times[valid[valid.length - 1]] - times[valid[0]]) / budget);
    const picks = [valid[0]];
    let sinceLast = 0, lastTime = times[valid[0]];
    for (let k = 1; k < valid.length; k++) {
      const i = valid[k], prev = valid[k - 1];
      sinceLast += distanceM(lat[prev], lon[prev], lat[i], lon[i]);
      const jump = times[i] - times[prev] > gap;
      if (sinceLast >= step || times[i] - lastTime >= gap || jump) {
        if (jump && prev !== picks[picks.length - 1]) picks.push(prev);
        picks.push(i);
        sinceLast = 0;
        lastTime = times[i];
      }
    }
    const last = valid[valid.length - 1];
    if (picks[picks.length - 1] !== last) picks.push(last);
    return picks;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * Terrain height in metres for each { lat, lon }. Default provider: Open-Meteo's elevation API (Copernicus 90 m model,
   * 100 positions per request, free for non-commercial use). opts: { provider(batch) -> Promise<number[]> (replaces Open-Meteo),
   * batchSize = 100, fetch, signal, onProgress(done, total), retries = 3 }. Identical rounded positions are asked once.
   * Throws GroundHeightError (codes: network, http, rateLimited, badResponse, aborted).
   */
  async function fetchElevations(coords, opts = {}) {
    const doFetch = opts.fetch || (root.fetch && root.fetch.bind(root));
    const batchSize = opts.batchSize || 100;
    const retries = opts.retries === undefined ? 3 : opts.retries;
    const key = (c) => `${c.lat.toFixed(4)},${c.lon.toFixed(4)}`;
    const unique = new Map();
    for (const c of coords) if (!unique.has(key(c))) unique.set(key(c), { lat: +c.lat.toFixed(4), lon: +c.lon.toFixed(4) });
    const list = [...unique.entries()];
    const result = new Map();

    const openMeteo = async (batch) => {
      if (!doFetch) throw new GroundHeightError('fetch is not available', 'network');
      const url = 'https://api.open-meteo.com/v1/elevation?latitude=' + batch.map((c) => c.lat).join(',') + '&longitude=' + batch.map((c) => c.lon).join(',');
      for (let attempt = 0; ; attempt++) {
        let res;
        try { res = await doFetch(url, { signal: opts.signal }); } catch (err) {
          if (err && err.name === 'AbortError') throw new GroundHeightError('aborted', 'aborted');
          throw new GroundHeightError(`network: ${err && err.message}`, 'network');
        }
        if (res.status === 429) {
          if (attempt >= retries) throw new GroundHeightError('rate limit of the elevation service reached', 'rateLimited');
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        if (!res.ok) throw new GroundHeightError(`HTTP ${res.status}`, 'http');
        const body = await res.json();
        if (!body || !Array.isArray(body.elevation) || body.elevation.length !== batch.length) throw new GroundHeightError('unexpected answer', 'badResponse');
        return body.elevation;
      }
    };
    const provider = opts.provider || openMeteo;

    for (let from = 0; from < list.length; from += batchSize) {
      if (opts.signal && opts.signal.aborted) throw new GroundHeightError('aborted', 'aborted');
      const part = list.slice(from, from + batchSize);
      const values = await provider(part.map(([, c]) => c));
      if (!Array.isArray(values) || values.length !== part.length) throw new GroundHeightError('unexpected answer', 'badResponse');
      part.forEach(([k], j) => result.set(k, Number.isFinite(values[j]) ? values[j] : 0));   // no data (open sea) = 0 m
      if (opts.onProgress) opts.onProgress(Math.min(from + batchSize, list.length), list.length);
    }
    return coords.map((c) => result.get(key(c)));
  }

  /**
   * Looks the ground height up for a track. `frames` needs { times, lat, lon } (degrees; times in seconds).
   * Resolves { times: Float64Array (track time), height: Float32Array (m), source, points } or throws GroundHeightError
   * (code 'noPositions' when the track has no usable position).
   */
  async function computeProfile(frames, opts = {}) {
    const picks = pickSamples(frames, opts);
    if (!picks.length) throw new GroundHeightError('the track has no usable positions', 'noPositions');
    const coords = picks.map((i) => ({ lat: frames.lat[i], lon: frames.lon[i] }));
    const heights = await fetchElevations(coords, opts);
    return {
      times: Float64Array.from(picks, (i) => frames.times[i]),
      height: Float32Array.from(heights),
      source: opts.provider ? 'custom' : 'open-meteo',
      points: picks.length,
    };
  }

  /** Ground height (m) at time `t`: linear between the looked-up points, held constant before the first and after the last. */
  function interpolate(profile, t) {
    const { times, height } = profile;
    const n = times.length;
    if (!n) return NaN;
    if (t <= times[0]) return height[0];
    if (t >= times[n - 1]) return height[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid; else hi = mid; }
    const span = times[hi] - times[lo];
    return span > 0 ? height[lo] + (height[hi] - height[lo]) * ((t - times[lo]) / span) : height[lo];
  }

  /** Altitude minus ground height for every frame (m); NaN for frames without a valid position or without ground data. */
  function aglSeries(frames, profile) {
    const n = frames.times.length;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = profile && isFix(frames.lat[i], frames.lon[i]) ? frames.alt[i] - interpolate(profile, frames.times[i]) : NaN;
    }
    return out;
  }

  /** Summary over frames: lowest height above ground (and when), highest altitude, highest ground. `profile` may be null. */
  function statistics(times, alt, profile) {
    const s = { minAgl: NaN, minAglTime: NaN, maxAlt: -Infinity, maxGround: NaN };
    for (let i = 0; i < times.length; i++) {
      if (alt[i] > s.maxAlt) s.maxAlt = alt[i];
      if (!profile) continue;
      const g = interpolate(profile, times[i]);
      if (!(s.maxGround >= g)) s.maxGround = g;
      const agl = alt[i] - g;
      if (!(s.minAgl <= agl)) { s.minAgl = agl; s.minAglTime = times[i]; }
    }
    if (s.maxAlt === -Infinity) s.maxAlt = NaN;
    return s;
  }

  // ---- chart helpers (pure, tested) ----
  /** Round tick values covering [min, max], about `count` of them. */
  function niceTicks(min, max, count = 6) {
    if (!(max > min)) return [min];
    const rough = (max - min) / Math.max(1, count);
    const pow = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) || 10 * pow;
    const ticks = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(Math.round(v / step) * step);
    return ticks;
  }

  const TIME_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400];
  function timeTickStep(spanS, count = 8) {
    const rough = spanS / count;
    return TIME_STEPS.find((s) => s >= rough) || TIME_STEPS[TIME_STEPS.length - 1];
  }

  function formatClock(t, withHours) {
    const sign = t < 0 ? '-' : '';
    const s = Math.floor(Math.abs(t));
    const p = (n) => String(n).padStart(2, '0');
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    return withHours || h ? `${sign}${h}:${p(m)}:${p(ss)}` : `${sign}${m}:${p(ss)}`;
  }

  /**
   * Thins a series to what a plot of `width` pixels can show: per pixel column the lowest and highest value are kept (in
   * the order they occurred), so peaks survive. Returns { x: number[], y: number[] } of data coordinates.
   */
  function decimate(times, values, from, to, width) {
    let lo = 0, hi = times.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] < from) lo = mid + 1; else hi = mid; }
    let start = Math.max(0, lo - 1);
    lo = start; hi = times.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] <= to) lo = mid + 1; else hi = mid; }
    const end = Math.min(times.length, lo + 1);
    const count = end - start;
    const x = [], y = [];
    if (count <= width * 2 || !(to > from)) {
      for (let i = start; i < end; i++) { if (Number.isFinite(values[i])) { x.push(times[i]); y.push(values[i]); } }
      return { x, y };
    }
    const per = (to - from) / width;
    let col = -1, iMin = -1, iMax = -1;
    const flush = () => {
      if (iMin < 0) return;
      const pair = iMin <= iMax ? [iMin, iMax] : [iMax, iMin];
      for (const i of iMin === iMax ? [iMin] : pair) { x.push(times[i]); y.push(values[i]); }
    };
    for (let i = start; i < end; i++) {
      if (!Number.isFinite(values[i])) continue;
      const c = Math.floor((times[i] - from) / per);
      if (c !== col) { flush(); col = c; iMin = iMax = i; continue; }
      if (values[i] < values[iMin]) iMin = i;
      if (values[i] > values[iMax]) iMax = i;
    }
    flush();
    return { x, y };
  }

  const api = { computeProfile, pickSamples, fetchElevations, interpolate, aglSeries, statistics, niceTicks, timeTickStep, formatClock, decimate, GroundHeightError, M2FT };
  root.JoinfsGroundHeight = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // ==================================================================
  // Localisation: English is built in; every other language is joinfs-ground-height-<locale>.json next to this script
  // ==================================================================
  const EN = {
    'legend.aircraft': 'Aircraft altitude',
    'legend.ground': 'Ground height',
    'legend.agl': 'Height above ground',
    'tip.time': 'Time',
    'tip.altitude': 'Altitude',
    'tip.ground': 'Ground',
    'tip.agl': 'Above ground',
    'btn.zoomIn': 'Zoom in',
    'btn.zoomOut': 'Zoom out',
    'btn.fit': 'Show everything',
    'btn.unit': 'Change the unit (now {unit})',
    'hint': 'Wheel: zoom · Ctrl+wheel or drag: scroll · Click: move the playhead · Double-click: show everything',
    'aria.chart': 'Altitude and ground height of {name}, from {from} to {to}',
    'noGround': 'No ground height available: only the aircraft altitude is shown.',
    'stat.minAgl': 'Lowest height above ground: {value}',
    'stat.maxAlt': 'Highest altitude: {value}',
    'stat.maxGround': 'Highest ground: {value}',
    'empty': 'No data to show.',
  };
  api.messages = { en: EN };
  if (typeof HTMLElement === 'undefined' || typeof customElements === 'undefined') return;     // node: functions and messages only
  const SUPPORTED = ['de', 'es', 'fr', 'it', 'ko', 'nl', 'pt', 'uk'];     // + en; the languages JoinFS ships, plus Ukrainian

  const SCRIPT_URL = (function () {
    try { const s = root.document && root.document.currentScript; if (s && s.src) return s.src.replace(/[?#].*$/, ''); } catch (_) { /* fall through */ }
    return '';
  })();
  const SCRIPT_BASE = SCRIPT_URL ? SCRIPT_URL.replace(/[^/]*$/, '') : '';
  const localeCache = new Map();                       // url -> Promise<dict>

  function loadLocale(base, lang) {
    const url = `${base}joinfs-ground-height-${lang}.json`;
    if (!localeCache.has(url)) {
      localeCache.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).catch((err) => {
        console.warn(`joinfs-ground-height: locale file ${url} not loaded (${err.message}); using English.`);
        return {};
      }));
    }
    return localeCache.get(url);
  }

  const primary = (tag) => String(tag || '').split('-')[0].toLowerCase();

  // ==================================================================
  // <joinfs-ground-profile>
  // ==================================================================
  const CSS = `
    :host { display: flex; flex-direction: column; min-height: 320px; color: inherit; font: 14px/1.4 system-ui, sans-serif; }
    * { box-sizing: border-box; }
    .bar { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem 1rem; padding-bottom: .5rem; }
    .legend { display: flex; flex-wrap: wrap; gap: .25rem 1rem; margin: 0; padding: 0; list-style: none; flex: 1 1 auto; }
    .legend li { display: flex; align-items: center; gap: .4rem; }
    .swatch { width: 18px; height: 10px; border-radius: 2px; flex: none; }
    .tools { display: flex; gap: .25rem; }
    button { min-width: 44px; min-height: 44px; padding: 0 .75rem; font: inherit; color: inherit; cursor: pointer;
      border: 1px solid rgba(127,127,127,.55); border-radius: 8px; background: transparent; }
    button:hover { background: rgba(127,127,127,.18); }
    button:focus-visible, canvas:focus-visible { outline: 2px solid #f59e0b; outline-offset: 2px; }
    .plot { position: relative; flex: 1 1 auto; min-height: 220px; }
    canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; cursor: crosshair; border-radius: 6px; }
    .read { min-height: 1.4em; margin: .5rem 0 0; font-variant-numeric: tabular-nums; }
    .stats { display: flex; flex-wrap: wrap; gap: .1rem 1.25rem; margin: .25rem 0 0; opacity: .85; font-size: .9em; }
    .note, .hint { margin: .25rem 0 0; opacity: .7; font-size: .85em; }
    [hidden] { display: none !important; }
  `;

  class JoinfsGroundProfile extends HTMLElement {
    static get observedAttributes() { return ['lang', 'unit']; }

    constructor() {
      super();
      this._ready = false;
      this._strings = EN;
      this._data = null;
      this._playhead = null;
      this._view = null;            // { t0, t1 } visible time window
      this._hover = null;           // time under the pointer
      this._pointers = new Map();
      this._raf = 0;
    }

    // ---- i18n ----
    t(key, params) {
      let s = (this._strings && this._strings[key]) || EN[key] || key;
      if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, v);
      return s;
    }

    get language() {
      const forced = primary(this.getAttribute('lang'));
      if (forced === 'en' || SUPPORTED.includes(forced)) return forced;
      for (const tag of (navigator.languages || [navigator.language || 'en'])) {
        const p = primary(tag);
        if (p === 'en') return 'en';
        if (SUPPORTED.includes(p)) return p;
      }
      return 'en';
    }

    async applyLanguage() {
      const lang = this.language;
      const base = this.getAttribute('locale-base') || SCRIPT_BASE;
      const dict = lang === 'en' || !base ? {} : await loadLocale(base, lang);
      if (lang !== this.language) return;
      this._strings = { ...EN, ...dict };
      this._lang = lang;
      this._renderTexts();
      this._schedule();
    }

    get unit() { return this.getAttribute('unit') === 'm' ? 'm' : 'ft'; }
    set unit(v) { this.setAttribute('unit', v === 'm' ? 'm' : 'ft'); }

    attributeChangedCallback(name) {
      if (!this._ready) return;
      if (name === 'lang') this.applyLanguage();
      else { this._renderTexts(); this._schedule(); }
    }

    // ---- data ----
    get data() { return this._data; }
    set data(d) {
      this._data = d && d.times && d.times.length ? d : null;
      this._hover = null;
      this._fit();
      if (this._ready) { this._renderTexts(); this._schedule(); }
    }
    get playhead() { return this._playhead; }
    set playhead(t) { this._playhead = Number.isFinite(t) ? t : null; this._schedule(); }

    _bounds() {
      const t = this._data.times;
      return { min: t[0], max: t[t.length - 1] };
    }
    _fit() {
      if (!this._data) { this._view = null; return; }
      const b = this._bounds();
      const pad = (b.max - b.min) * 0.02 || 1;
      this._view = { t0: b.min - pad, t1: b.max + pad };
    }

    // ---- view changes ----
    _setView(t0, t1) {
      const b = this._bounds();
      const full = (b.max - b.min) * 1.04 || 2;
      let span = Math.min(Math.max(t1 - t0, Math.min(2, full)), full);
      const mid = (t0 + t1) / 2;
      t0 = mid - span / 2; t1 = mid + span / 2;
      const lo = b.min - full * 0.02, hi = b.max + full * 0.02;
      if (t0 < lo) { t1 += lo - t0; t0 = lo; }
      if (t1 > hi) { t0 -= t1 - hi; t1 = hi; }
      this._view = { t0, t1 };
      this._schedule();
    }
    _zoom(factor, atTime) {
      if (!this._view) return;
      const { t0, t1 } = this._view;
      const at = atTime === undefined ? (t0 + t1) / 2 : atTime;
      this._setView(at - (at - t0) * factor, at + (t1 - at) * factor);
    }
    _pan(deltaS) { if (this._view) this._setView(this._view.t0 + deltaS, this._view.t1 + deltaS); }
    zoomIn() { this._zoom(0.5); }
    zoomOut() { this._zoom(2); }
    fit() { this._fit(); this._schedule(); }

    // ---- lifecycle ----
    connectedCallback() {
      if (this._ready) return;
      this._ready = true;
      const sr = this.attachShadow({ mode: 'open' });
      sr.innerHTML = `<style>${CSS}</style>
        <div class="bar">
          <ul class="legend" id="legend"></ul>
          <div class="tools">
            <button type="button" id="out">−</button><button type="button" id="in">+</button>
            <button type="button" id="fit"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/></svg></button><button type="button" id="unit"></button>
          </div>
        </div>
        <div class="plot"><canvas id="cv" tabindex="0" role="img"></canvas></div>
        <p class="read" id="read" aria-live="off"></p>
        <div class="stats" id="stats"></div>
        <p class="note" id="note" hidden></p>
        <p class="hint" id="hint"></p>`;
      const $ = (id) => sr.getElementById(id);
      this._cv = $('cv');
      this._g = this._cv.getContext('2d');
      $('in').addEventListener('click', () => this.zoomIn());
      $('out').addEventListener('click', () => this.zoomOut());
      $('fit').addEventListener('click', () => this.fit());
      $('unit').addEventListener('click', () => { this.unit = this.unit === 'ft' ? 'm' : 'ft'; });
      this._bindPointer();
      this._ro = new ResizeObserver(() => this._schedule());
      this._ro.observe(this._cv);
      this._mq = root.matchMedia ? root.matchMedia('(prefers-color-scheme: dark)') : null;
      if (this._mq) { this._onScheme = () => this._schedule(); this._mq.addEventListener('change', this._onScheme); }
      this._themeObserver = new MutationObserver(() => this._schedule());
      this._themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
      this._renderTexts();
      this.applyLanguage();
    }

    disconnectedCallback() {
      if (this._ro) this._ro.disconnect();
      if (this._themeObserver) this._themeObserver.disconnect();
      if (this._mq && this._onScheme) this._mq.removeEventListener('change', this._onScheme);
      cancelAnimationFrame(this._raf);
      this._ready = false;
      this._ro = null;
    }

    // ---- texts ----
    _fmtAlt(m) {
      if (!Number.isFinite(m)) return '–';
      const v = this.unit === 'ft' ? m * M2FT : m;
      return `${Math.round(v).toLocaleString(this._lang || 'en')} ${this.unit}`;
    }

    _renderTexts() {
      const sr = this.shadowRoot;
      if (!sr) return;
      const $ = (id) => sr.getElementById(id);
      const colors = this._colors();
      const hasGround = !!(this._data && this._data.ground && this._data.ground.times.length);
      const legend = [['legend.aircraft', colors.aircraft]];
      if (hasGround) legend.push(['legend.ground', colors.ground], ['legend.agl', colors.agl]);
      $('legend').innerHTML = legend.map(([k, c]) => `<li><span class="swatch" style="background:${c}"></span><span>${this.t(k)}</span></li>`).join('');
      for (const [id, key] of [['in', 'btn.zoomIn'], ['out', 'btn.zoomOut'], ['fit', 'btn.fit']]) {
        $(id).setAttribute('aria-label', this.t(key)); $(id).title = this.t(key);
      }
      $('unit').textContent = this.unit;
      $('unit').setAttribute('aria-label', this.t('btn.unit', { unit: this.unit }));
      $('unit').title = this.t('btn.unit', { unit: this.unit });
      $('hint').textContent = this.t('hint');
      const note = $('note');
      note.hidden = hasGround || !this._data;
      note.textContent = this.t('noGround');
      const stats = $('stats');
      if (this._data) {
        const s = statistics(this._data.times, this._data.alt, hasGround ? this._data.ground : null);
        const items = [];
        if (hasGround) items.push(this.t('stat.minAgl', { value: this._fmtAlt(s.minAgl) }));
        items.push(this.t('stat.maxAlt', { value: this._fmtAlt(s.maxAlt) }));
        if (hasGround) items.push(this.t('stat.maxGround', { value: this._fmtAlt(s.maxGround) }));
        stats.innerHTML = items.map((x) => `<span>${x.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</span>`).join('');
        const b = this._bounds();
        this._cv.setAttribute('aria-label', this.t('aria.chart', { name: this._data.name || '', from: formatClock(b.min), to: formatClock(b.max) }));
      } else {
        stats.textContent = '';
        this._cv.setAttribute('aria-label', this.t('empty'));
      }
    }

    // ---- colours: follow the page (light / dark) ----
    _colors() {
      const ink = getComputedStyle(this).color || 'rgb(226,232,240)';
      const m = /rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(ink);
      const lum = m ? (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255 : 1;
      const dark = lum > 0.5;                       // light text = dark theme
      return {
        ink,
        grid: 'rgba(127,127,127,.28)',
        aircraft: dark ? '#38bdf8' : '#0369a1',
        ground: dark ? '#c9a06a' : '#8a5a1c',
        groundFill: dark ? 'rgba(201,160,106,.35)' : 'rgba(138,90,28,.30)',
        agl: dark ? 'rgba(56,189,248,.18)' : 'rgba(3,105,161,.14)',
        playhead: '#f59e0b',
      };
    }

    // ---- drawing ----
    _schedule() {
      if (!this._ready || this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = 0; this._draw(); });
    }

    _layout() {
      const dpr = root.devicePixelRatio || 1;
      const w = this._cv.clientWidth, h = this._cv.clientHeight;
      if (this._cv.width !== Math.round(w * dpr) || this._cv.height !== Math.round(h * dpr)) {
        this._cv.width = Math.round(w * dpr); this._cv.height = Math.round(h * dpr);
      }
      this._g.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { w, h, left: 62, right: 12, top: 10, bottom: 26 };
    }

    _yRange(from, to) {
      const d = this._data;
      let lo = Infinity, hi = -Infinity;
      const take = (times, values) => {
        for (let i = 0; i < times.length; i++) {
          if (times[i] < from || times[i] > to || !Number.isFinite(values[i])) continue;
          if (values[i] < lo) lo = values[i]; if (values[i] > hi) hi = values[i];
        }
      };
      take(d.times, d.alt);
      if (d.ground) take(d.ground.times, d.ground.height);
      if (lo === Infinity) { from = -Infinity; to = Infinity; take(d.times, d.alt); }   // nothing inside the window: use everything
      if (lo === Infinity) { lo = 0; hi = 1; }
      const f = this.unit === 'ft' ? M2FT : 1;
      lo *= f; hi *= f;
      const pad = Math.max((hi - lo) * 0.08, 5);
      return { lo: lo - pad, hi: hi + pad, f };
    }

    _draw() {
      if (!this._g) return;
      const g = this._g, L = this._layout(), c = this._colors();
      g.clearRect(0, 0, L.w, L.h);
      if (!this._data || !this._view) {
        g.fillStyle = c.ink; g.globalAlpha = 0.7; g.font = '14px system-ui, sans-serif'; g.textAlign = 'center';
        g.fillText(this.t('empty'), L.w / 2, L.h / 2); g.globalAlpha = 1;
        return;
      }
      const d = this._data, { t0, t1 } = this._view;
      const pw = Math.max(10, L.w - L.left - L.right), ph = Math.max(10, L.h - L.top - L.bottom);
      const { lo, hi, f } = this._yRange(t0, t1);
      const X = (t) => L.left + ((t - t0) / (t1 - t0)) * pw;
      const Y = (v) => L.top + ph * (1 - (v * f - lo) / (hi - lo));
      this._geom = { L, pw, ph, X, t0, t1 };

      g.save();
      g.font = '12px system-ui, sans-serif';
      g.lineWidth = 1;
      // y grid + labels
      g.textAlign = 'right'; g.textBaseline = 'middle';
      for (const v of niceTicks(lo, hi, Math.max(2, Math.round(ph / 48)))) {
        const y = Math.round(L.top + ph * (1 - (v - lo) / (hi - lo))) + 0.5;
        g.strokeStyle = c.grid; g.beginPath(); g.moveTo(L.left, y); g.lineTo(L.left + pw, y); g.stroke();
        g.fillStyle = c.ink; g.globalAlpha = 0.8;
        g.fillText(Math.round(v).toLocaleString(this._lang || 'en'), L.left - 6, y);
        g.globalAlpha = 1;
      }
      // x grid + labels
      const step = timeTickStep(t1 - t0, Math.max(2, Math.round(pw / 90)));
      const withHours = Math.max(Math.abs(t0), Math.abs(t1)) >= 3600;
      g.textAlign = 'center'; g.textBaseline = 'top';
      for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
        const x = Math.round(X(t)) + 0.5;
        g.strokeStyle = c.grid; g.beginPath(); g.moveTo(x, L.top); g.lineTo(x, L.top + ph); g.stroke();
        g.fillStyle = c.ink; g.globalAlpha = 0.8;
        g.fillText(formatClock(t, withHours), x, L.top + ph + 6);
        g.globalAlpha = 1;
      }

      // plot area clip
      g.beginPath(); g.rect(L.left, L.top, pw, ph); g.clip();
      const alt = decimate(d.times, d.alt, t0, t1, pw);
      const ground = d.ground && d.ground.times.length ? decimate(d.ground.times, d.ground.height, t0, t1, pw) : null;

      if (ground && ground.x.length) {
        // height above ground: between the terrain and the aircraft line (on the ground track's own time grid)
        g.beginPath();
        alt.x.forEach((t, i) => { const px = X(t), py = Y(alt.y[i]); if (i) g.lineTo(px, py); else g.moveTo(px, py); });
        for (let i = alt.x.length - 1; i >= 0; i--) g.lineTo(X(alt.x[i]), Y(interpolate(d.ground, alt.x[i])));
        g.closePath(); g.fillStyle = c.agl; g.fill();
        // terrain
        g.beginPath();
        ground.x.forEach((t, i) => { const px = X(t), py = Y(ground.y[i]); if (i) g.lineTo(px, py); else g.moveTo(px, py); });
        const gl = X(ground.x[ground.x.length - 1]), gf = X(ground.x[0]);
        g.strokeStyle = c.ground; g.lineWidth = 1.5; g.stroke();
        g.lineTo(gl, L.top + ph + 2); g.lineTo(gf, L.top + ph + 2); g.closePath();
        g.fillStyle = c.groundFill; g.fill();
      }
      // aircraft
      g.beginPath();
      alt.x.forEach((t, i) => { const px = X(t), py = Y(alt.y[i]); if (i) g.lineTo(px, py); else g.moveTo(px, py); });
      g.strokeStyle = c.aircraft; g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();

      // playhead and hover
      const vline = (t, color, dash) => {
        const x = Math.round(X(t)) + 0.5;
        if (x < L.left || x > L.left + pw) return;
        g.strokeStyle = color; g.lineWidth = 1.5; g.setLineDash(dash || []);
        g.beginPath(); g.moveTo(x, L.top); g.lineTo(x, L.top + ph); g.stroke(); g.setLineDash([]);
      };
      if (this._playhead !== null) vline(this._playhead, c.playhead);
      if (this._hover !== null) vline(this._hover, c.ink, [4, 4]);
      g.restore();
      this._renderReadout();
    }

    _valueAt(t) {
      const d = this._data;
      const times = d.times;
      let lo = 0, hi = times.length - 1;
      if (t <= times[0]) lo = hi = 0; else if (t >= times[hi]) lo = hi;
      else { while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid; else hi = mid; } }
      const span = times[hi] - times[lo];
      const k = span > 0 ? Math.min(1, Math.max(0, (t - times[lo]) / span)) : 0;
      const alt = d.alt[lo] + (d.alt[hi] - d.alt[lo]) * k;
      const ground = d.ground && d.ground.times.length ? interpolate(d.ground, t) : NaN;
      return { alt, ground, agl: alt - ground };
    }

    _renderReadout() {
      const el = this.shadowRoot.getElementById('read');
      const t = this._hover !== null ? this._hover : this._playhead;
      if (!this._data || t === null) { el.textContent = ''; return; }
      const v = this._valueAt(t);
      const parts = [`${this.t('tip.time')} ${formatClock(t)}`, `${this.t('tip.altitude')} ${this._fmtAlt(v.alt)}`];
      if (Number.isFinite(v.ground)) parts.push(`${this.t('tip.ground')} ${this._fmtAlt(v.ground)}`, `${this.t('tip.agl')} ${this._fmtAlt(v.agl)}`);
      el.textContent = parts.join(' · ');
    }

    // ---- pointer, wheel, keys ----
    _timeAtEvent(e) {
      const r = this._cv.getBoundingClientRect(), geom = this._geom;
      if (!geom) return null;
      return geom.t0 + ((e.clientX - r.left - geom.L.left) / geom.pw) * (geom.t1 - geom.t0);
    }

    _bindPointer() {
      const cv = this._cv;
      let drag = null;
      cv.addEventListener('pointerdown', (e) => {
        if (!this._data) return;
        cv.setPointerCapture(e.pointerId);
        this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        drag = { x: e.clientX, moved: false, t0: this._view.t0, t1: this._view.t1 };
        if (this._pointers.size === 2) { const [a, b] = [...this._pointers.values()]; drag.pinch = Math.hypot(a.x - b.x, a.y - b.y); drag.moved = true; }
      });
      cv.addEventListener('pointermove', (e) => {
        if (!this._data || !this._geom) return;
        if (this._pointers.has(e.pointerId)) this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (drag && this._pointers.size === 2 && drag.pinch) {
          const [a, b] = [...this._pointers.values()];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (dist > 0) {
            const r = cv.getBoundingClientRect();
            const mid = this._geom.t0 + (((a.x + b.x) / 2 - r.left - this._geom.L.left) / this._geom.pw) * (this._geom.t1 - this._geom.t0);
            this._zoom(drag.pinch / dist, mid);
            drag.pinch = dist;
          }
          return;
        }
        if (drag && this._pointers.size === 1 && (drag.moved || Math.abs(e.clientX - drag.x) > 4)) {
          drag.moved = true;
          const perPx = (drag.t1 - drag.t0) / this._geom.pw;
          this._setView(drag.t0 - (e.clientX - drag.x) * perPx, drag.t1 - (e.clientX - drag.x) * perPx);
          return;
        }
        this._hover = this._timeAtEvent(e);
        this._schedule();
      });
      const end = (e) => {
        const was = this._pointers.has(e.pointerId);
        this._pointers.delete(e.pointerId);
        if (was && drag && !drag.moved && this._pointers.size === 0 && e.type === 'pointerup') {
          const t = this._timeAtEvent(e);
          if (t !== null) this.dispatchEvent(new CustomEvent('seek', { detail: { time: t }, bubbles: true, composed: true }));
        }
        if (this._pointers.size === 0) drag = null; else drag = { x: e.clientX, moved: true, t0: this._view.t0, t1: this._view.t1 };
      };
      cv.addEventListener('pointerup', end);
      cv.addEventListener('pointercancel', end);
      cv.addEventListener('pointerleave', () => { if (!drag) { this._hover = null; this._schedule(); } });
      cv.addEventListener('dblclick', () => this.fit());
      cv.addEventListener('wheel', (e) => {
        if (!this._data || !this._geom) return;
        e.preventDefault();
        const span = this._view.t1 - this._view.t0;
        if (e.ctrlKey || e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
          const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
          this._pan((d / 400) * span * 0.4);
        } else {
          this._zoom(e.deltaY > 0 ? 1.25 : 0.8, this._timeAtEvent(e));
        }
      }, { passive: false });
      cv.addEventListener('keydown', (e) => {
        if (!this._data) return;
        const span = this._view.t1 - this._view.t0;
        const handled = { ArrowLeft: () => this._pan(-span * 0.1), ArrowRight: () => this._pan(span * 0.1),
          '+': () => this.zoomIn(), '=': () => this.zoomIn(), '-': () => this.zoomOut(), Home: () => this.fit() }[e.key];
        if (!handled) return;
        e.preventDefault(); e.stopPropagation();    // the page's own shortcuts (map zoom, ...) must not also fire
        handled();
      });
    }
  }

  if (!customElements.get('joinfs-ground-profile')) customElements.define('joinfs-ground-profile', JoinfsGroundProfile);
})(typeof window !== 'undefined' ? window : globalThis);
