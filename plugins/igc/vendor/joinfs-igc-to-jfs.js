/*!
 * joinfs-igc-to-jfs - converts IGC flight logs (gliders) into JoinFS recordings (.jfs) in the browser.
 *
 * Two parts in one file, like the GPX converter next to it:
 *   JoinfsIgc.parse(text)         pure IGC parser  -> { points, meta, warnings }
 *   JoinfsIgc.toGpx(points, name) GPX 1.1 text of a parsed flight
 *   <joinfs-igc-to-jfs>           custom element: a thin wrapper around <joinfs-gpx-to-jfs> (peer dependency). It parses
 *                                 the IGC file, hands the track to the GPX converter as GPX and prefills the form from
 *                                 the IGC header (competition id / glider id, glider type, pilot, ICAO type GLID).
 *                                 The conversion itself (ground clamping, attitude, gear/flaps/lights) stays in the
 *                                 GPX converter, so there is exactly one engine.
 *
 * Attributes
 *   lang            force a UI language (observed; default: navigator.languages, English fallback)
 *   converter-src   URL of joinfs-gpx-to-jfs.js if <joinfs-gpx-to-jfs> is not defined yet
 *                   (default: joinfs-gpx-to-jfs.js next to this script)
 *   locale-base     folder of the locale files (default: the folder of this script)
 *   build, hz, typerole, systems, elevation-scale, altitude-offset, smooth-pos, ground-clearance, controls,
 *   no-url-params, auto-convert        forwarded to <joinfs-gpx-to-jfs>. `build="fs2024"` presets the target format and
 *                                      hides that question (what an embedding application wants); without it the
 *                                      GPX converter asks, as it does standalone.
 * Public API  loadFile(file) -> Promise      (used by the picker, by drop and by embedding applications)
 * Events      'converted' (detail { info, blob, filename }, info.igc = flight meta), 'igc-error' (detail { code, message })
 *
 * License: CC BY-NC-SA 4.0 (see LICENSE)
 */
(function (root) {
  'use strict';

  // ==================================================================
  // IGC parser
  // ==================================================================
  class IgcError extends Error {
    constructor(message, code, params) { super(message); this.name = 'IgcError'; this.code = code; this.params = params || {}; }
  }

  const MAX_BYTES = 30 * 1024 * 1024;

  /** Two-digit years: 90-99 -> 19xx, 00-89 -> 20xx (IGC logging starts in the early 1990s). */
  function fullYear(yy) { return yy >= 90 ? 1900 + yy : 2000 + yy; }

  function headerValue(line) {
    const i = line.indexOf(':');
    return (i >= 0 ? line.slice(i + 1) : line.replace(/^H[FOP][A-Z]{3}/, '')).trim();
  }

  /**
   * Parses an IGC file (spec: https://xp-soaring.github.io/igc_file_format/). Reads the B records (fixes), the date and the
   * header lines that name pilot and glider, and the LAD/LOD fix extensions (extra minute digits). Times are UTC and run
   * past midnight. GNSS altitude is used; pressure altitude only for fixes that carry none (2D fixes).
   * Throws IgcError (codes: notIgc, noDate, noFixes, fewFixes).
   */
  function parse(text) {
    if (typeof text !== 'string') throw new IgcError('Not text', 'notIgc');
    const lines = text.split(/\r\n|\r|\n/);
    const meta = { pilot: '', gliderType: '', gliderId: '', compId: '', compClass: '', date: '', fixes: 0, durationS: 0, altitude: 'gnss' };
    let dateParts = null;
    let ext = [];                                    // [{ code, start, end }] from the I record, 1-based inclusive columns
    let sawIgcLike = false;
    const raw = [];                                  // B records, parsed after the headers (the date may come late)

    for (const line of lines) {
      if (!line) continue;
      const c = line[0];
      if (c === 'B') { raw.push(line); continue; }
      if (c === 'A' || c === 'H' || c === 'I' || c === 'J' || c === 'C' || c === 'E' || c === 'F' || c === 'G' || c === 'L' || c === 'D' || c === 'K') sawIgcLike = true;
      if (c === 'H') {
        const dte = /^H[FOP]DTE(?:DATE:)?(\d{2})(\d{2})(\d{2})/.exec(line);
        if (dte) { dateParts = { d: +dte[1], m: +dte[2], y: fullYear(+dte[3]) }; continue; }
        const code = (/^H[FOP]([A-Z]{3})/.exec(line) || [])[1];
        const v = headerValue(line);
        if (code === 'PLT') meta.pilot = v;
        else if (code === 'GTY') meta.gliderType = v;
        else if (code === 'GID') meta.gliderId = v;
        else if (code === 'CID') meta.compId = v;
        else if (code === 'CCL') meta.compClass = v;
      } else if (c === 'I') {
        const n = parseInt(line.slice(1, 3), 10);
        ext = [];
        for (let k = 0; k < n; k++) {
          const s = line.slice(3 + k * 7, 10 + k * 7);
          if (s.length === 7) ext.push({ start: +s.slice(0, 2), end: +s.slice(2, 4), code: s.slice(4, 7) });
        }
      }
    }
    if (!raw.length && !sawIgcLike) throw new IgcError('This does not look like an IGC file.', 'notIgc');
    if (!raw.length) throw new IgcError('No fixes (B records) found.', 'noFixes');
    if (!dateParts || dateParts.m < 1 || dateParts.m > 12 || dateParts.d < 1 || dateParts.d > 31) throw new IgcError('The flight date (HFDTE) is missing or invalid.', 'noDate');
    meta.date = `${dateParts.y}-${String(dateParts.m).padStart(2, '0')}-${String(dateParts.d).padStart(2, '0')}`;

    const lad = ext.find((e) => e.code === 'LAD'), lod = ext.find((e) => e.code === 'LOD');
    let dayStart = Date.UTC(dateParts.y, dateParts.m - 1, dateParts.d) / 1000;
    let lastSec = -1;
    const points = [];
    let pressureOnly = 0;

    for (const line of raw) {
      if (line.length < 35) continue;
      const hh = +line.slice(1, 3), mm = +line.slice(3, 5), ss = +line.slice(5, 7);
      if (!(hh < 24 && mm < 60 && ss < 61)) continue;
      const latDeg = +line.slice(7, 9), latMin = line.slice(9, 11), latFrac = line.slice(11, 14) + (lad ? line.slice(lad.start - 1, lad.end) : '');
      const lonDeg = +line.slice(15, 18), lonMin = line.slice(18, 20), lonFrac = line.slice(20, 23) + (lod ? line.slice(lod.start - 1, lod.end) : '');
      const ns = line[14], ew = line[23];
      if (!/^\d+$/.test(latMin + latFrac + lonMin + lonFrac) || (ns !== 'N' && ns !== 'S') || (ew !== 'E' && ew !== 'W')) continue;
      let lat = latDeg + parseFloat(`${latMin}.${latFrac}`) / 60;
      let lon = lonDeg + parseFloat(`${lonMin}.${lonFrac}`) / 60;
      if (ns === 'S') lat = -lat;
      if (ew === 'W') lon = -lon;
      if (lat === 0 && lon === 0) continue;                       // no fix yet
      const press = parseInt(line.slice(25, 30), 10), gnss = parseInt(line.slice(30, 35), 10);
      let ele = Number.isFinite(gnss) ? gnss : 0;
      if (ele === 0 && Number.isFinite(press) && press !== 0) { ele = press; pressureOnly++; }

      const sec = hh * 3600 + mm * 60 + ss;
      if (lastSec >= 0 && sec < lastSec - 3600) { dayStart += 86400; lastSec = sec; }      // past midnight (small backward steps are logger jitter)
      else if (sec >= lastSec) lastSec = sec;
      points.push({ t: dayStart + sec, lat, lon, ele });
    }
    if (points.length === 0) throw new IgcError('No usable fixes found.', 'noFixes');
    if (points.length < 2) throw new IgcError('A flight needs at least 2 fixes.', 'fewFixes', { n: points.length });
    meta.fixes = points.length;
    meta.durationS = Math.max(0, points[points.length - 1].t - points[0].t);
    if (pressureOnly > points.length / 2) meta.altitude = 'pressure';
    return { points, meta, warnings: [] };
  }

  const xmlEsc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

  // IGC altitudes are whole metres, so every elevation is an exact multiple of 0.1 - which is what the GPX converter's
  // "this track lost a digit" advisory looks for. A deterministic +-2 cm dither (far below the 1 m resolution of the log)
  // keeps that advisory for genuine problems instead of firing on every IGC file.
  const dither = (i) => (((i * 7919) % 97) - 48) / 2400;

  /** GPX 1.1 text for the converter: one track segment, `ele` in metres, UTC `time`. */
  function toGpx(points, name) {
    const out = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="joinfs-igc-to-jfs" xmlns="http://www.topografix.com/GPX/1/1">',
      `  <trk><name>${xmlEsc(name || 'IGC flight')}</name><trkseg>`];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      out.push(`    <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><ele>${(p.ele + dither(i)).toFixed(3)}</ele><time>${new Date(p.t * 1000).toISOString()}</time></trkpt>`);
    }
    out.push('  </trkseg></trk>', '</gpx>', '');
    return out.join('\n');
  }

  /** What the GPX converter's form is prefilled with, from the IGC header. */
  function prefillFor(meta) {
    const prefill = { icaoType: 'GLID' };
    const callsign = meta.compId || meta.gliderId;
    if (callsign) prefill.callsign = callsign;
    if (meta.gliderType) prefill.model = meta.gliderType;
    if (meta.pilot) prefill.nickname = meta.pilot;
    return prefill;
  }

  const api = { parse, toGpx, prefillFor, IgcError, MAX_BYTES };
  root.JoinfsIgc = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // ==================================================================
  // Localisation: English is built in; every other language is joinfs-igc-to-jfs-<locale>.json next to this script
  // ==================================================================
  const EN = {
    'title': 'Convert an IGC flight log to a JoinFS recording',
    'privacy': 'The file is read in your browser and is not uploaded anywhere.',
    'drop.prompt': 'Drop an IGC file here',
    'drop.choose': 'Choose a file',
    'drop.aria': 'Drop area for an IGC flight log',
    'loading': 'Reading the flight…',
    'summary.pilot': 'Pilot',
    'summary.glider': 'Glider',
    'summary.date': 'Date',
    'summary.fixes': 'Fixes',
    'summary.duration': 'Duration',
    'summary.altitudePressure': 'Altitude: from the pressure sensor (the log has no GPS altitude)',
    'err.notIgc': 'This does not look like an IGC file.',
    'err.noDate': 'The flight date (HFDTE) is missing or invalid.',
    'err.noFixes': 'No GPS fixes (B records) were found in this file.',
    'err.fewFixes': 'Only {n} fixes found; a flight needs at least 2.',
    'err.tooLarge': 'The file is too large (limit {mb} MB).',
    'err.read': 'The file could not be read.',
    'err.noConverter': 'The GPX converter component could not be loaded ({src}).',
  };
  api.messages = { en: EN };
  if (typeof HTMLElement === 'undefined' || typeof customElements === 'undefined') return;     // node: parser and messages only
  const SUPPORTED = ['de', 'es', 'fr', 'it', 'ko', 'nl', 'pt', 'uk'];     // + en; the languages JoinFS ships, plus Ukrainian

  const SCRIPT_URL = (function () {
    try { const s = root.document && root.document.currentScript; if (s && s.src) return s.src.replace(/[?#].*$/, ''); } catch (_) { /* fall through */ }
    return '';
  })();
  const SCRIPT_BASE = SCRIPT_URL ? SCRIPT_URL.replace(/[^/]*$/, '') : '';
  const localeCache = new Map();                       // base + lang -> Promise<dict>

  function loadLocale(base, lang) {
    const url = `${base}joinfs-igc-to-jfs-${lang}.json`;
    if (!localeCache.has(url)) {
      localeCache.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).catch((err) => {
        console.warn(`joinfs-igc-to-jfs: locale file ${url} not loaded (${err.message}); using English.`);
        return {};
      }));
    }
    return localeCache.get(url);
  }

  function primary(tag) { return String(tag || '').split('-')[0].toLowerCase(); }

  function whenConverterReady(el) {
    if (customElements.get('joinfs-gpx-to-jfs')) return Promise.resolve();
    const src = el.getAttribute('converter-src') || (SCRIPT_BASE ? `${SCRIPT_BASE}joinfs-gpx-to-jfs.js` : '');
    return new Promise((resolve, reject) => {
      if (!src) { reject(new Error('no converter-src')); return; }
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => customElements.whenDefined('joinfs-gpx-to-jfs').then(resolve, reject);
      s.onerror = () => reject(new Error(src));
      document.head.appendChild(s);
    });
  }

  const FORWARDED = ['build', 'hz', 'typerole', 'systems', 'elevation-scale', 'altitude-offset', 'smooth-pos', 'ground-clearance', 'controls', 'no-url-params', 'auto-convert'];
  const CSS = `
    :host { display: block; max-width: 34rem; font: 16px/1.5 system-ui, sans-serif; color: inherit; }
    * { box-sizing: border-box; }
    h2 { font-size: 1.1rem; margin: 0 0 .25rem; }
    .note { margin: 0 0 1rem; opacity: .75; font-size: .85rem; }
    .drop { display: flex; flex-direction: column; align-items: center; gap: .5rem; padding: 1.5rem 1rem; border: 2px dashed currentColor;
      border-radius: 12px; text-align: center; opacity: .9; }
    .drop.over { background: rgba(127,127,127,.18); }
    button { font: inherit; min-height: 44px; padding: 0 1rem; border-radius: 8px; border: 1px solid currentColor; background: transparent; color: inherit; cursor: pointer; }
    .error { margin: .75rem 0 0; padding: .6rem .8rem; border-radius: 8px; border: 1px solid #f87171; color: #f87171; }
    dl.summary { display: grid; grid-template-columns: auto 1fr; gap: .15rem .75rem; margin: 0 0 1rem; font-size: .9rem; }
    dl.summary dt { opacity: .7; } dl.summary dd { margin: 0; }
    .loading { opacity: .8; }
    [hidden] { display: none !important; }
  `;

  class JoinfsIgcToJfs extends HTMLElement {
    static get observedAttributes() { return ['lang']; }

    constructor() {
      super();
      this._ready = false;
      this._strings = EN;
      this._state = 'empty';
      this._meta = null;
      this._error = null;
      this._prefKey = null;
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
      if (lang !== this.language) return;                      // changed again while the file was loading
      this._strings = { ...EN, ...dict };
      this._lang = lang;
      if (this._inner) this._inner.setAttribute('lang', lang);
      this.render();
    }

    attributeChangedCallback(name) { if (name === 'lang' && this._ready) this.applyLanguage(); }

    // ---- lifecycle ----
    connectedCallback() {
      if (this._ready) return;
      this._ready = true;
      const sr = this.attachShadow({ mode: 'open' });
      sr.innerHTML = `<style>${CSS}</style>
        <div class="box">
          <section id="intro">
            <h2 id="h"></h2><p class="note" id="priv"></p>
            <div class="drop" id="drop" role="group"><span id="prompt"></span><button type="button" id="choose"></button></div>
            <input type="file" id="file" hidden accept=".igc,text/plain">
          </section>
          <p class="loading" id="loading" hidden></p>
          <p class="error" id="error" role="alert" hidden></p>
          <dl class="summary" id="summary" hidden></dl>
          <div id="slot"></div>
        </div>`;
      const $ = (id) => sr.getElementById(id);
      const drop = $('drop'), file = $('file');
      $('choose').addEventListener('click', () => file.click());
      file.addEventListener('change', () => { const f = file.files[0]; file.value = ''; if (f) this.loadFile(f); });
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) this.loadFile(f); });
      this.render();
      this.applyLanguage();
    }

    disconnectedCallback() { this._dropPrefs(); }

    // ---- rendering (structure is static; only texts and visibility change, so the inner converter survives a language switch) ----
    render() {
      const sr = this.shadowRoot;
      if (!sr) return;
      const $ = (id) => sr.getElementById(id);
      $('h').textContent = this.t('title');
      $('priv').textContent = this.t('privacy');
      $('prompt').textContent = this.t('drop.prompt');
      $('choose').textContent = this.t('drop.choose');
      $('drop').setAttribute('aria-label', this.t('drop.aria'));
      $('loading').textContent = this.t('loading');
      $('intro').hidden = this._state === 'ready' || this._state === 'loading';
      $('loading').hidden = this._state !== 'loading';
      const err = $('error');
      err.hidden = !this._error;
      err.textContent = this._error ? this.t(`err.${this._error.code}`, this._error.params) : '';
      const dl = $('summary');
      dl.hidden = this._state !== 'ready' || !this._meta;
      dl.replaceChildren();
      if (!dl.hidden) {
        const m = this._meta;
        const rows = [['summary.pilot', m.pilot], ['summary.glider', [m.gliderType, m.compId || m.gliderId].filter(Boolean).join(' · ')],
          ['summary.date', m.date], ['summary.fixes', String(m.fixes)], ['summary.duration', fmtDuration(m.durationS)]];
        for (const [k, v] of rows) {
          if (!v) continue;
          const dt = document.createElement('dt'); dt.textContent = this.t(k);
          const dd = document.createElement('dd'); dd.textContent = v;
          dl.append(dt, dd);
        }
        if (m.altitude === 'pressure') {
          const dd = document.createElement('dd'); dd.style.gridColumn = '1 / -1'; dd.textContent = this.t('summary.altitudePressure');
          dl.append(dd);
        }
      }
    }

    // ---- public API ----
    async loadFile(file) {
      this._dropInner();
      this._error = null;
      this._meta = null;
      this._state = 'loading';
      this.render();
      try {
        if (file.size > MAX_BYTES) throw new IgcError('too large', 'tooLarge', { mb: Math.round(MAX_BYTES / 1048576) });
        let text;
        try { text = await file.text(); } catch (_) { throw new IgcError('unreadable', 'read'); }
        const { points, meta } = parse(text);
        try { await whenConverterReady(this); } catch (e) { throw new IgcError('converter missing', 'noConverter', { src: e.message }); }
        const base = String(file.name || 'flight.igc').replace(/\.igc$/i, '');
        const gpx = new File([toGpx(points, [meta.pilot, meta.gliderType].filter(Boolean).join(' - ') || base)], `${base}.gpx`, { type: 'application/gpx+xml' });
        this._meta = meta;
        this._mountInner(meta);
        this._state = 'ready';
        this.render();
        this._inner.loadFile(gpx);
      } catch (err) {
        const e = err instanceof IgcError ? err : new IgcError(String(err && err.message || err), 'read');
        this._error = { code: e.code, params: e.params };
        this._state = 'empty';
        this.render();
        this.dispatchEvent(new CustomEvent('igc-error', { detail: { code: e.code, message: e.message }, bubbles: true, composed: true }));
      }
    }

    // ---- the wrapped GPX converter ----
    _mountInner(meta) {
      const inner = document.createElement('joinfs-gpx-to-jfs');
      for (const name of FORWARDED) if (this.hasAttribute(name)) inner.setAttribute(name, this.getAttribute(name));
      if (!this.hasAttribute('typerole')) inner.setAttribute('typerole', 'glider');
      inner.setAttribute('lang', this._lang || this.language);
      if (!this.hasAttribute('no-url-params')) inner.setAttribute('no-url-params', '');
      this._seedPrefs(inner, prefillFor(meta));
      inner.addEventListener('converted', (e) => { if (e.detail && e.detail.info) e.detail.info.igc = { ...meta }; this._dropPrefs(); });
      this.shadowRoot.getElementById('slot').appendChild(inner);
      this._inner = inner;
      // the wrapper has its own heading and drop area, so the inner converter's heading would only say "GPX"
      try {
        if (inner.shadowRoot) {
          const style = document.createElement('style');
          style.textContent = '.box > h2 { display: none; }';
          inner.shadowRoot.appendChild(style);
        }
      } catch (_) { /* cosmetic only */ }
    }

    /**
     * The GPX converter reads its form defaults from the preferences stored under its `storage-key`. Seeding a private
     * key per file prefills exactly the wanted fields while a preset `build` stays hidden. Without usable storage the
     * values are passed as attributes plus `editable` (the form then shows every field, including the build).
     */
    _seedPrefs(inner, prefill) {
      this._dropPrefs();
      try {
        const key = `joinfs-igc-to-jfs:prefill:${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(key, JSON.stringify(prefill));
        inner.setAttribute('storage-key', key);
        this._prefKey = key;
      } catch (_) {
        const attr = { icaoType: 'icao-type', callsign: 'callsign', model: 'model', nickname: 'nickname' };
        for (const [k, v] of Object.entries(prefill)) inner.setAttribute(attr[k], v);
        inner.setAttribute('editable', '');
      }
    }

    _dropPrefs() {
      if (!this._prefKey) return;
      try { localStorage.removeItem(this._prefKey); } catch (_) { /* ignore */ }
      this._prefKey = null;
    }

    _dropInner() {
      this._dropPrefs();
      if (this._inner) { this._inner.remove(); this._inner = null; }
    }
  }

  function fmtDuration(sec) {
    const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min ${String(s % 60).padStart(2, '0')} s`;
  }

  if (!customElements.get('joinfs-igc-to-jfs')) customElements.define('joinfs-igc-to-jfs', JoinfsIgcToJfs);
})(typeof globalThis !== 'undefined' ? globalThis : this);
