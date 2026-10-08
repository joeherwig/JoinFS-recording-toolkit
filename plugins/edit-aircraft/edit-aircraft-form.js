// <jfs-edit-aircraft>: the form of the edit-aircraft plugin. Look and feel follow the importer components (outlined fields with
// the label in the border, pill buttons, automatic light / dark theme, one column on phones). All text comes in through
// `labels` (already translated by the plugin), so the element knows no language itself.
//
//   el.labels = { 'field.icao': '…', … }   el.values = { icaoType, callsign, nickname, altitudeM | null }
//   el.lookup = async () => metres | null   (optional; shows the "ground altitude at position" button)
//   events: 'apply' (detail: { icaoType?, callsign?, nickname?, altitudeDeltaM }), 'cancel'
import { MAX_CALLSIGN, MAX_NICKNAME, parseAltitude, toUnit, toMetres, altitudeDeltaM, validate, diff } from './logic.js';

const STYLE = `
  :host { display: block; color: var(--_fg); font: 16px/1.4 system-ui, sans-serif; max-width: var(--ea-max-width, 34rem); margin: 0 auto; width: 100%;
    --_accent: var(--ea-accent, #1a5fb4); --_on-accent: #fff; --_fg: var(--fg, #1d1b20); --_muted: var(--muted, #5b5f66);
    --_outline: var(--ea-outline, #79747e); --_error: #b3261e; --_container: #e8eefa; --_hover: rgba(26,95,180,.08); }
  @media (prefers-color-scheme: dark) { :host(:not([theme="light"])) { --_accent: var(--ea-accent, #8ab4f8); --_on-accent: #0b1a33; --_fg: var(--fg, #e6e1e5);
    --_muted: var(--muted, #a9adb4); --_outline: var(--ea-outline, #8e9099); --_error: #f2b8b5; --_container: #2b3446; --_hover: rgba(138,180,248,.12); } }
  :host([theme="dark"]) { --_accent: var(--ea-accent, #8ab4f8); --_on-accent: #0b1a33; --_fg: var(--fg, #e6e1e5); --_muted: var(--muted, #a9adb4);
    --_outline: var(--ea-outline, #8e9099); --_error: #f2b8b5; --_container: #2b3446; --_hover: rgba(138,180,248,.12); }
  form { display: flex; flex-direction: column; gap: 6px; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; }
  .alt { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 14px; align-items: start; }
  @media (max-width: 30rem) { .row { grid-template-columns: 1fr; } }
  .cell { display: flex; flex-direction: column; margin-top: 12px; }
  .field { position: relative; }
  .field input { box-sizing: border-box; width: 100%; height: 56px; padding: 0 16px; background: transparent; color: inherit; font: inherit;
    border: 1px solid var(--_outline); border-radius: 4px; outline: none; }
  .field input:hover { border-color: var(--_fg); }
  .field input:focus { border-color: var(--_accent); box-shadow: inset 0 0 0 1px var(--_accent); }
  .field input:disabled { opacity: .5; }
  .field label { position: absolute; left: 12px; top: -9px; padding: 0 4px; font-size: 12px; line-height: 16px; color: var(--_muted);
    background: var(--panel-bg, Canvas); }
  .field:focus-within label { color: var(--_accent); }
  .uc input { text-transform: uppercase; }
  .invalid input { border-color: var(--_error); box-shadow: inset 0 0 0 1px var(--_error); }
  .invalid label, .invalid .hint { color: var(--_error); }
  .hint { font-size: 12px; color: var(--_muted); margin: 4px 16px 0; min-height: 16px; }
  .lookup { display: flex; align-items: center; gap: 8px; margin: 2px 0 0; flex-wrap: wrap; }
  .lookup .btn { height: 36px; }
  .lookup .status { font-size: 12px; color: var(--_muted); flex: 1 1 12rem; }
  .lookup .status.err { color: var(--_error); }
  .units { display: inline-flex; height: 56px; align-items: center; }
  .units button { height: 40px; min-width: 48px; padding: 0 14px; border: 1px solid var(--_outline); background: transparent; color: inherit; font: inherit; cursor: pointer; }
  .units button:first-child { border-radius: 20px 0 0 20px; }
  .units button:last-child { border-radius: 0 20px 20px 0; border-left: none; }
  .units button[aria-pressed="true"] { background: var(--_container); color: var(--_accent); font-weight: 600; }
  footer { display: flex; gap: 8px; align-items: center; margin-top: 20px; position: sticky; bottom: 0; padding: 12px 0 2px; background: var(--panel-bg, Canvas); }
  footer .spacer { flex: 1; }
  .btn { height: 40px; padding: 0 22px; border-radius: 20px; border: none; font: inherit; font-weight: 600; cursor: pointer; background: var(--_accent); color: var(--_on-accent); }
  .btn.text { background: transparent; color: var(--_accent); padding: 0 14px; }
  .btn:hover:not(:disabled) { filter: brightness(1.1); }
  .btn.text:hover:not(:disabled) { background: var(--_hover); filter: none; }
  .btn:disabled { opacity: .4; cursor: default; }
  .btn:focus-visible, .units button:focus-visible { outline: 2px solid var(--_accent); outline-offset: 2px; }
  @media (pointer: coarse) { .field input { height: 60px; } .btn { height: 48px; border-radius: 24px; } .units button { height: 48px; } }
`;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const round1 = (n) => Math.round(n * 10) / 10;

export class EditAircraftForm extends HTMLElement {
  constructor() {
    super();
    this._labels = {};
    this._values = { icaoType: '', callsign: '', nickname: '', altitudeM: null };
    this._unit = 'ft';
    this.attachShadow({ mode: 'open' });
  }

  set labels(v) { this._labels = v || {}; if (this._built) this._build(); }
  get labels() { return this._labels; }
  set values(v) { this._values = { icaoType: '', callsign: '', nickname: '', altitudeM: null, ...v }; this._build(); }
  get values() { return this._values; }
  set lookup(fn) { this._lookup = fn; if (this._built) this._build(); }

  connectedCallback() { if (!this._built) this._build(); this.focusFirst(); }
  focusFirst() { const el = this.shadowRoot.getElementById('icao'); if (el) { el.focus(); el.select(); } }     // selected, so typing replaces it

  _t(key, params) {
    let s = this._labels[key] ?? key;
    for (const [k, v] of Object.entries(params || {})) s = s.replaceAll(`{${k}}`, v);
    return s;
  }

  _fmt(metres) {
    const v = toUnit(metres, this._unit);
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: this._unit === 'ft' ? 0 : 1 }).format(v)} ${this._t('unit.' + this._unit)}`;
  }

  _build() {
    this._built = true;
    const v = this._values;
    const hasAlt = v.altitudeM !== null && v.altitudeM !== undefined;
    const field = (id, labelKey, value, extra = '', cls = '') => `
      <div class="cell"><div class="field ${cls}" data-f="${id}">
        <input id="${id}" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(value)}" ${extra} placeholder=" ">
        <label for="${id}">${esc(this._t(labelKey))}</label></div>
        <div class="hint" id="${id}-hint"></div></div>`;
    const altText = hasAlt ? String(round1(toUnit(v.altitudeM, this._unit))) : '';
    this.shadowRoot.innerHTML = `<style>${STYLE}</style>
      <form novalidate>
        <div class="row">
          ${field('icao', 'field.icao', v.icaoType, 'maxlength="4"', 'uc')}
          ${field('callsign', 'field.callsign', v.callsign, `maxlength="${MAX_CALLSIGN + 8}"`)}
        </div>
        ${field('nickname', 'field.nickname', v.nickname, `maxlength="${MAX_NICKNAME + 8}"`)}
        <div class="alt">
          ${field('altitude', 'field.altitude', altText, `inputmode="decimal" ${hasAlt ? '' : 'disabled'}`)}
          <div class="cell"><div class="units" role="group" aria-label="${esc(this._t('unit.label'))}">
            <button type="button" data-unit="ft" aria-pressed="${this._unit === 'ft'}">${esc(this._t('unit.ft'))}</button>
            <button type="button" data-unit="m" aria-pressed="${this._unit === 'm'}">${esc(this._t('unit.m'))}</button></div></div>
        </div>
        ${hasAlt && this._lookup ? `<div class="lookup"><button type="button" class="btn text" id="lookup" title="${esc(this._t('btn.lookup.title'))}">${esc(this._t('btn.lookup'))}</button>
          <span class="status" id="lookup-status" role="status" aria-live="polite"></span></div>` : ''}
        <footer>
          <button type="button" class="btn text" id="reset">${esc(this._t('btn.reset'))}</button>
          <span class="spacer"></span>
          <button type="button" class="btn text" id="cancel">${esc(this._t('btn.cancel'))}</button>
          <button type="submit" class="btn" id="apply">${esc(this._t('btn.apply'))}</button>
        </footer>
      </form>`;
    const root = this.shadowRoot;
    const form = root.querySelector('form');
    form.addEventListener('submit', (e) => { e.preventDefault(); this._apply(); });
    form.addEventListener('input', () => this._refresh());
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); this._cancel(); } });
    root.getElementById('cancel').addEventListener('click', () => this._cancel());
    root.getElementById('reset').addEventListener('click', () => { this._build(); this.focusFirst(); });
    const lookupBtn = root.getElementById('lookup');
    if (lookupBtn) lookupBtn.addEventListener('click', () => this._doLookup());
    for (const b of root.querySelectorAll('[data-unit]')) b.addEventListener('click', () => this._switchUnit(b.dataset.unit));
    this._refresh();
  }

  /** Asks the plugin for the terrain height at the track's start and puts it into the altitude field (in the chosen unit). */
  async _doLookup() {
    const r = this.shadowRoot;
    const btn = r.getElementById('lookup'), status = r.getElementById('lookup-status');
    const setStatus = (text, err) => { status.textContent = text; status.classList.toggle('err', !!err); };
    const token = (this._lookupToken = (this._lookupToken || 0) + 1);
    btn.disabled = true;
    setStatus(this._t('status.checking'));
    let metres = null;
    try { metres = await this._lookup(); } catch { metres = null; }
    if (token !== this._lookupToken || !this.isConnected || r.getElementById('lookup') !== btn) return;     // the form was rebuilt meanwhile
    btn.disabled = false;
    if (!Number.isFinite(metres)) { setStatus(this._t('err.lookup'), true); return; }
    r.getElementById('altitude').value = String(round1(toUnit(metres, this._unit)));
    setStatus(this._t('status.found', { value: this._fmt(metres) }));
    this._refresh();
  }

  _switchUnit(unit) {
    if (unit === this._unit) return;
    const input = this.shadowRoot.getElementById('altitude');
    const n = parseAltitude(input.value);
    const old = this._unit;
    this._unit = unit;
    if (Number.isFinite(n)) input.value = String(round1(toUnit(toMetres(n, old), unit)));
    for (const b of this.shadowRoot.querySelectorAll('[data-unit]')) b.setAttribute('aria-pressed', String(b.dataset.unit === unit));
    this._refresh();
  }

  /** Reads the inputs; `altitude` is a number, NaN when unparsable, null when the track has no positions. */
  _read() {
    const r = this.shadowRoot;
    const alt = r.getElementById('altitude');
    return {
      icaoType: r.getElementById('icao').value, callsign: r.getElementById('callsign').value, nickname: r.getElementById('nickname').value,
      altitude: alt.disabled ? null : parseAltitude(alt.value),
    };
  }

  _changes() {
    const cur = this._read();
    const text = diff(this._values, cur);
    let altDelta = null;
    if (Number.isFinite(cur.altitude) && this._values.altitudeM != null) {
      const d = altitudeDeltaM(this._values.altitudeM, cur.altitude, this._unit);
      if (Math.abs(d) >= 0.05) altDelta = d;                          // below 5 cm is the rounding of the displayed value
    }
    return { cur, text, altDelta };
  }

  _refresh() {
    const r = this.shadowRoot;
    const { cur, text, altDelta } = this._changes();
    const hasAlt = cur.altitude !== null;
    const errors = validate({ ...cur, altitude: hasAlt ? cur.altitude : undefined });
    const show = (id, hintKey, errKey, params) => {
      r.querySelector(`[data-f="${id}"]`).classList.toggle('invalid', !!errKey);
      r.getElementById(`${id}-hint`).textContent = this._t(errKey || hintKey, params);
    };
    show('icao', 'hint.icao', errors.icaoType, {});
    show('callsign', 'hint.callsign', errors.callsign, { max: MAX_CALLSIGN });
    show('nickname', 'hint.nickname', errors.nickname, { max: MAX_NICKNAME });
    show('altitude', hasAlt ? 'hint.altitude' : 'hint.noaltitude', errors.altitude, { current: hasAlt ? this._fmt(this._values.altitudeM) : '' });
    const dirty = Object.keys(text).length > 0 || altDelta !== null;
    r.getElementById('apply').disabled = !dirty || Object.keys(errors).length > 0;
  }

  _apply() {
    if (this.shadowRoot.getElementById('apply').disabled) return;
    const { text, altDelta } = this._changes();
    this.dispatchEvent(new CustomEvent('apply', { detail: { ...text, altitudeDeltaM: altDelta }, bubbles: true, composed: true }));
  }

  _cancel() { this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true })); }
}

if (typeof customElements !== 'undefined' && !customElements.get('jfs-edit-aircraft')) customElements.define('jfs-edit-aircraft', EditAircraftForm);
