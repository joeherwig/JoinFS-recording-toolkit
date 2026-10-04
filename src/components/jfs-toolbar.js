// <jfs-toolbar> - import/save controls, map/app theme + locale switches, clear-selection, warnings
// banner. See PLAN.md Step 1/6.

import { pickFilesToOpen, saveJfsFile } from '../file-io.js';
import { exportProject } from '../project-model.js';
import { formats } from '../formats/index.js';
import { openGpxImportModal, openConverterModal } from './jfs-converter-modal.js';
import { jfsLegacyFormat } from '../formats/jfs-legacy.js';
import { t } from '../i18n.js';
import { svgIcon } from '../track-menu.js';
import { formatClock, parseClock } from '../clock.js';

// Persists the save-time build-variant choice (matches theme.js's localStorage pattern) so it
// survives a reload instead of always resetting to the fs2024 default.
const BUILD_VARIANT_KEY = 'jfs-toolkit:buildVariant';
function getStoredBuildVariant() {
  try { return localStorage.getItem(BUILD_VARIANT_KEY) || 'fs2024'; } catch { return 'fs2024'; }
}
function setStoredBuildVariant(v) {
  try { localStorage.setItem(BUILD_VARIANT_KEY, v); } catch { /* ignore (private browsing etc.) */ }
}

const STYLE = `
  :host { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: var(--toolbar-bg, #0d0f14); color: var(--fg, #e2e8f0); font: 13px system-ui, sans-serif; border-bottom: 1px solid var(--border, #262b36); flex-wrap: wrap; }
  button { background: var(--btn-bg, #1e2433); color: inherit; border: 1px solid var(--border, #262b36); border-radius: 6px; padding: 5px 10px; cursor: pointer; }
  button:hover { background: var(--btn-bg-hover, #2d3748); }
  button:disabled { opacity: .5; cursor: default; }
  select { background: var(--btn-bg, #1e2433); color: inherit; border: 1px solid var(--border, #262b36); border-radius: 6px; padding: 4px 6px; }
  .spacer { flex: 1; }
  .title { font-weight: 600; margin-right: 8px; }
  dialog.edit { position: fixed; inset: 0 auto auto 0; z-index: 2500; margin: 0; width: min(92vw, 420px); max-height: 80vh; overflow: auto; padding: 0;
    background: var(--panel-bg, #12141a); color: var(--fg, #e2e8f0); border: 1px solid var(--border, #262b36); border-radius: 14px; box-shadow: 0 12px 36px rgba(0,0,0,.5); }
  dialog.edit .edit-head { display: flex; align-items: center; gap: 10px; padding: 6px 6px 6px 18px; }
  dialog.edit .edit-head h2 { flex: 1; margin: 0; font-size: 15px; font-weight: 600; }
  dialog.edit .edit-head button { min-width: 44px; min-height: 44px; border: none; background: transparent; font-size: 20px; border-radius: 10px; }
  dialog.edit .edit-body { display: flex; flex-direction: column; gap: 16px; padding: 4px 18px 16px; }
  dialog.edit .summary { font-size: 13px; color: var(--muted, #94a3b8); font-variant-numeric: tabular-nums; }
  dialog.edit .summary strong { color: var(--fg, #e2e8f0); font-weight: 600; }
  /* dual-handle range: the whole recording as a bar, the kept part highlighted */
  dialog.edit .range { position: relative; height: 44px; margin: 0 14px; touch-action: none; user-select: none; }
  dialog.edit .range-track { position: absolute; left: 0; right: 0; top: 19px; height: 6px; border-radius: 3px; background: var(--btn-bg, #1e2433); }
  dialog.edit .range-fill { position: absolute; top: 0; bottom: 0; border-radius: 3px; background: #2563eb; }
  dialog.edit .thumb { position: absolute; top: 0; width: 44px; height: 44px; margin-left: -22px; padding: 0; border: none; background: transparent; cursor: ew-resize; border-radius: 50%; }
  dialog.edit .thumb::after { content: ''; position: absolute; left: 14px; top: 12px; width: 16px; height: 20px; border-radius: 5px; background: #fff; border: 2px solid #2563eb; box-sizing: border-box; box-shadow: 0 1px 4px rgba(0,0,0,.4); }
  dialog.edit .thumb:focus-visible { outline: 2px solid #93c5fd; outline-offset: -4px; }
  dialog.edit .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  dialog.edit .field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  dialog.edit .field > label { font-size: 12px; color: var(--muted, #94a3b8); }
  dialog.edit .field-input { display: flex; align-items: center; gap: 6px; background: var(--btn-bg, #1e2433); border: 1px solid var(--border, #262b36); border-radius: 8px; padding-right: 10px; }
  dialog.edit .field-input:focus-within { border-color: #2563eb; }
  dialog.edit .field-input input { flex: 1; min-width: 0; min-height: 44px; border: none; background: transparent; color: inherit; font: inherit; font-size: 16px; font-variant-numeric: tabular-nums; padding: 0 0 0 12px; outline: none; }
  dialog.edit .field-input .suffix { color: var(--muted, #94a3b8); font-size: 13px; }
  dialog.edit .field-btn { flex: none; width: 44px; min-height: 44px; display: grid; place-items: center; border: none; border-left: 1px solid var(--border, #262b36); border-radius: 0 8px 8px 0; background: transparent; color: inherit; margin-right: -10px; padding: 0; }
  dialog.edit .field-btn:hover, dialog.edit .field-btn:focus-visible { background: var(--btn-bg-hover, #2d3748); outline: none; }
  dialog.edit .field-btn svg { width: 20px; height: 20px; }
  dialog.edit .field-input input[aria-invalid="true"] { color: #f87171; }
  dialog.edit .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  dialog.edit .actions .action { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 6px 10px; border-radius: 8px; line-height: 1.2; text-align: left; }
  dialog.edit .actions .action svg { width: 20px; height: 20px; flex: none; }
  @media (max-width: 420px) { dialog.edit .actions { grid-template-columns: 1fr; } }
  dialog.edit .edit-footer { display: flex; align-items: center; gap: 8px; padding-top: 4px; }
  dialog.edit .edit-footer .grow { flex: 1; }
  dialog.edit .edit-footer button { min-height: 44px; padding: 0 16px; border-radius: 8px; }
  dialog.edit .edit-footer button.quiet { border-color: transparent; background: transparent; }
  dialog.edit .edit-footer button.primary { background: #2563eb; border-color: #2563eb; color: #fff; font-weight: 600; }
  @media (max-width: 420px) { dialog.edit .fields { grid-template-columns: 1fr; } }
  .warnings { position: fixed; top: 44px; right: 10px; z-index: 2000; display: flex; flex-direction: column; gap: 6px; max-width: 360px; }
  .warning { background: #7c2d12; color: #fed7aa; border-radius: 6px; padding: 8px 10px; font-size: 12px; display: flex; gap: 8px; align-items: start; }
  .warning button { background: transparent; border: none; color: inherit; font-size: 14px; padding: 0 0 0 4px; }
`;

export class JfsToolbar extends HTMLElement {
  constructor() {
    super();
    this._root = this.attachShadow({ mode: 'open' });
    this._root.innerHTML = `
      <style>${STYLE}</style>
      <span class="title">${t('app.title')}</span>
      <button id="importBtn" title="${t('toolbar.import')} (Ctrl+O)">${t('toolbar.import')}</button>
      <button id="saveBtn" title="${t('toolbar.save')} (Ctrl+S)">${t('toolbar.save')}</button>
      <button id="undoBtn" title="${t('toolbar.undo')} (Ctrl+Z)" disabled>↶</button>
      <button id="redoBtn" title="${t('toolbar.redo')} (Ctrl+Shift+Z)" disabled>↷</button>
      <select id="buildVariant" title="${t('toolbar.buildVariant.fs2024')}">
        <option value="fs2024" selected>${t('toolbar.buildVariant.fs2024')}</option>
        <option value="other">${t('toolbar.buildVariant.other')}</option>
      </select>
      <span class="spacer"></span>
      <select id="appTheme">
        <option value="auto">${t('toolbar.appTheme.auto')}</option>
        <option value="light">${t('toolbar.appTheme.light')}</option>
        <option value="dark">${t('toolbar.appTheme.dark')}</option>
      </select>
      <dialog class="edit" id="editDialog"></dialog>
      <div class="warnings" id="warnings"></div>
    `;
    this._store = null;
    this._warningsEl = this._root.getElementById('warnings');
    this._root.getElementById('buildVariant').value = getStoredBuildVariant();

    this._root.getElementById('importBtn').addEventListener('click', () => this._doImport());
    this._root.getElementById('saveBtn').addEventListener('click', () => this._doSave());
    this._root.getElementById('undoBtn').addEventListener('click', () => this._store && this._store.undo());
    this._root.getElementById('redoBtn').addEventListener('click', () => this._store && this._store.redo());
    this._root.getElementById('appTheme').addEventListener('change', (e) => {
      this.dispatchEvent(new CustomEvent('app-theme-changed', { detail: { theme: e.target.value } }));
    });
    this._root.getElementById('buildVariant').addEventListener('change', (e) => {
      setStoredBuildVariant(e.target.value);
    });
  }

  set store(store) {
    this._store = store;
    store.addEventListener('history-changed', (e) => {
      this._root.getElementById('undoBtn').disabled = !e.detail.canUndo;
      this._root.getElementById('redoBtn').disabled = !e.detail.canRedo;
    });
  }

  // ---- edit dialog: a floating, non-modal dialog for plugin edit modes (trim, ...) ----
  // Non-modal on purpose: the timeline and the playhead stay usable while it is open ("playhead" buttons).

  /**
   * spec: {
   *   title,
   *   summary(values) -> string          (optional, shown live above the controls; **bold** parts are emphasised)
   *   range: { startId, endId, min, max, step, startLabel, endLabel }   (optional dual-handle slider bound to two fields)
   *   fields: [{ id, label, value, type: 'number'|'time', step, min, suffix, hidden, button: { id, label, icon, title } }],
   *   actions: [{ id, label, icon (SVG text), title }]   (icon + text buttons under the controls)
   *   buttons: [{ id, label, primary, quiet }]   (footer; quiet ones sit on the left)
   *   onChange(values), onButton(id, values)
   * }
   * Returns { setValues(values), close() }. Only one is open at a time; opening another closes the first.
   * The close button and Esc count as the button with id 'cancel'.
   */
  openDialog(spec) {
    if (this._dialogHandle) this._dialogHandle.close();
    const dlg = this._root.getElementById('editDialog');
    dlg.replaceChildren();
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

    const head = el('div', 'edit-head');
    const closeBtn = el('button', '', '×');
    closeBtn.type = 'button';
    closeBtn.title = t('modal.close');
    closeBtn.setAttribute('aria-label', t('modal.close'));
    head.append(el('h2', '', spec.title), closeBtn);

    const body = el('div', 'edit-body');
    const inputs = new Map(); // id -> { el, get() -> number (NaN if unreadable), set(number) }
    const values = () => Object.fromEntries([...inputs].map(([id, a]) => [id, a.get()]));
    const emit = () => { refresh(); if (spec.onChange) spec.onChange(values()); };

    const summary = spec.summary ? el('div', 'summary') : null;
    if (summary) body.appendChild(summary);
    const refresh = () => {
      if (summary) {
        summary.replaceChildren();
        // "**x**" marks emphasis; built with text nodes so plugin text never becomes markup
        spec.summary(values()).split('**').forEach((part, k) => summary.appendChild(k % 2 ? el('strong', '', part) : document.createTextNode(part)));
      }
      syncRange();
    };

    // dual-handle range
    let syncRange = () => {};
    if (spec.range) {
      const { startId, endId, min, max, step = 0.1 } = spec.range;
      const wrap = el('div', 'range');
      wrap.setAttribute('role', 'group');
      const track = el('div', 'range-track');
      const fill = el('div', 'range-fill');
      track.appendChild(fill);
      const mk = (cls, label) => {
        const b = el('button', 'thumb ' + cls);
        b.type = 'button';
        b.setAttribute('role', 'slider');
        b.setAttribute('aria-label', label || '');
        b.setAttribute('aria-valuemin', min);
        b.setAttribute('aria-valuemax', max);
        return b;
      };
      const startThumb = mk('start', spec.range.startLabel), endThumb = mk('end', spec.range.endLabel);
      wrap.append(track, startThumb, endThumb);
      const pct = (v) => (max > min ? ((Math.min(Math.max(v, min), max) - min) / (max - min)) * 100 : 0);
      const round = (v) => Math.round(v / step) * step;
      const setVal = (id, v) => inputs.get(id).set(Math.round(v * 100) / 100);
      syncRange = () => {
        const a = inputs.get(startId).get(), b = inputs.get(endId).get();
        if (!Number.isFinite(a) || !Number.isFinite(b)) return;
        startThumb.style.left = pct(a) + '%'; endThumb.style.left = pct(b) + '%';
        fill.style.left = pct(a) + '%'; fill.style.right = (100 - pct(b)) + '%';
        startThumb.setAttribute('aria-valuenow', a); endThumb.setAttribute('aria-valuenow', b);
      };
      const move = (which, v) => {
        const a = inputs.get(startId).get(), b = inputs.get(endId).get();
        v = Math.min(Math.max(round(v), min), max);
        if (which === 'start') setVal(startId, Math.min(v, b - step)); else setVal(endId, Math.max(v, a + step));
        emit();
      };
      const valueAt = (clientX) => { const r = track.getBoundingClientRect(); return min + ((clientX - r.left) / r.width) * (max - min); };
      for (const [which, thumb] of [['start', startThumb], ['end', endThumb]]) {
        thumb.addEventListener('pointerdown', (e) => { e.preventDefault(); thumb.setPointerCapture(e.pointerId); thumb.focus(); });
        thumb.addEventListener('pointermove', (e) => { if (thumb.hasPointerCapture(e.pointerId)) move(which, valueAt(e.clientX)); });
        thumb.addEventListener('keydown', (e) => {
          const cur = inputs.get(which === 'start' ? startId : endId).get();
          const big = e.shiftKey ? 10 : 1; // arrows: 1 s, Shift: 10 s; the fields below take exact values
          const keys = { ArrowLeft: cur - big, ArrowDown: cur - big, ArrowRight: cur + big, ArrowUp: cur + big, PageDown: cur - 10, PageUp: cur + 10, Home: min, End: max };
          if (e.key in keys) { e.preventDefault(); move(which, keys[e.key]); }
        });
      }
      // clicking the bar moves the nearer handle
      wrap.addEventListener('pointerdown', (e) => {
        if (e.target !== wrap && e.target !== track && e.target !== fill) return;
        const v = valueAt(e.clientX);
        const a = inputs.get(startId).get(), b = inputs.get(endId).get();
        move(Math.abs(v - a) <= Math.abs(v - b) ? 'start' : 'end', v);
      });
      body.appendChild(wrap);
    }

    // fields
    const fields = el('div', 'fields');
    for (const fld of spec.fields || []) {
      const field = el('div', 'field');
      const id = `edit-${fld.id}`;
      const label = el('label', '', fld.label);
      label.htmlFor = id;
      const box = el('div', 'field-input');
      const input = el('input');
      input.id = id;
      let accessor;
      if (fld.type === 'time') {
        // shown as 00:00:00 (h:mm:ss, m:ss or plain seconds are accepted); an unreadable entry is ignored until fixed
        input.type = 'text';
        input.inputMode = 'numeric';
        input.autocomplete = 'off';
        input.value = formatClock(fld.value);
        let last = fld.value;
        accessor = {
          el: input,
          get: () => { const v = parseClock(input.value); if (Number.isFinite(v)) last = v; return last; },
          set: (v) => { last = v; input.value = formatClock(v); },
        };
        input.addEventListener('input', () => { input.setAttribute('aria-invalid', Number.isFinite(parseClock(input.value)) ? 'false' : 'true'); emit(); });
        input.addEventListener('change', () => accessor.set(accessor.get())); // tidy the text once editing is done
      } else {
        input.type = 'number';
        input.value = fld.value;
        if (fld.step !== undefined) input.step = fld.step;
        if (fld.min !== undefined) input.min = fld.min;
        accessor = { el: input, get: () => (input.value === '' ? NaN : Number(input.value)), set: (v) => { input.value = v; } };
        input.addEventListener('input', emit);
      }
      inputs.set(fld.id, accessor);
      box.appendChild(input);
      if (fld.suffix) box.appendChild(el('span', 'suffix', fld.suffix));
      if (fld.button) {
        const b = el('button', 'field-btn');
        b.type = 'button';
        const icon = svgIcon(fld.button.icon);
        if (icon) b.appendChild(icon); else b.textContent = fld.button.label || '';
        b.title = fld.button.title || fld.button.label || '';
        b.setAttribute('aria-label', b.title);
        b.addEventListener('click', () => spec.onButton && spec.onButton(fld.button.id, values()));
        box.appendChild(b);
      }
      field.append(label, box);
      if (!fld.hidden) fields.appendChild(field); // hidden: a value carried by the range bar only
    }
    if (fields.children.length) body.appendChild(fields);

    // action buttons (icon + text), e.g. "set start to the playhead"
    if ((spec.actions || []).length) {
      const row = el('div', 'actions');
      for (const a of spec.actions) {
        const b = el('button', 'action');
        b.type = 'button';
        const icon = svgIcon(a.icon);
        if (icon) b.appendChild(icon);
        b.appendChild(el('span', '', a.label));
        if (a.title) b.title = a.title;
        b.addEventListener('click', () => spec.onButton && spec.onButton(a.id, values()));
        row.appendChild(b);
      }
      body.appendChild(row);
    }

    // footer: quiet buttons (Reset) on the left, the rest on the right
    const footer = el('div', 'edit-footer');
    const quiet = (spec.buttons || []).filter((b) => b.quiet), rest = (spec.buttons || []).filter((b) => !b.quiet);
    const addButton = (b) => {
      const btn = el('button', b.primary ? 'primary' : b.quiet ? 'quiet' : '', b.label);
      btn.type = 'button';
      btn.addEventListener('click', () => spec.onButton && spec.onButton(b.id, values()));
      footer.appendChild(btn);
    };
    quiet.forEach(addButton);
    footer.appendChild(el('span', 'grow'));
    rest.forEach(addButton);
    body.appendChild(footer);

    dlg.append(head, body);
    closeBtn.addEventListener('click', () => spec.onButton && spec.onButton('cancel', values()));
    dlg.oncancel = (e) => { e.preventDefault(); if (spec.onButton) spec.onButton('cancel', values()); };
    // Esc cancels without saving wherever the focus is (a non-modal dialog gets no native cancel from the page).
    // Capture phase + stopPropagation so it does not also clear the map selection; an open track menu closes first.
    this._onEsc = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
      if (document.querySelector('.jfs-track-menu')) return;
      e.preventDefault();
      e.stopPropagation();
      if (spec.onButton) spec.onButton('cancel', values());
    };
    document.addEventListener('keydown', this._onEsc, true);
    refresh();
    dlg.show();
    this._centerOverMap(dlg);
    this._onResize = () => this._centerOverMap(dlg);
    window.addEventListener('resize', this._onResize);
    // focus the first visible control (hidden fields have no element in the page); the range handle otherwise
    const first = [...inputs.values()].map((x) => x.el).find((e) => e.isConnected) || dlg.querySelector('.thumb.start');
    if (first) first.focus();
    const handle = {
      setValues: (v) => { for (const [id, a] of inputs) if (v[id] !== undefined) a.set(v[id]); refresh(); },
      close: () => { if (this._dialogHandle !== handle) return; this._dialogHandle = null; window.removeEventListener('resize', this._onResize); document.removeEventListener('keydown', this._onEsc, true); dlg.close(); dlg.replaceChildren(); },
    };
    this._dialogHandle = handle;
    return handle;
  }

  /** Centres the floating dialog over the map (the timeline below stays free for scrubbing). */
  _centerOverMap(dlg) {
    const map = document.querySelector('jfs-map');
    const area = map ? map.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const r = dlg.getBoundingClientRect();
    dlg.style.left = `${Math.max(0, area.left + (area.width - r.width) / 2)}px`;
    dlg.style.top = `${Math.max(area.top, area.top + (area.height - r.height) / 2)}px`;
  }

  /** Shows a short message in the warnings area (plugins use it through ctx.ui.toast). */
  notify(message) { this._pushWarning(message); }

  setAppTheme(theme) { this._root.getElementById('appTheme').value = theme; }

  /**
   * Imports files through the formats registry: the registry sniffs each file and the matching format decodes it.
   * Interactive formats (GPX) get their dialog through `ctx.ui`; they resolve `null` if the user cancels.
   */
  async importFiles(files) {
    // Interactive importers get UI hooks. `convert(file, opts)` runs a converter component in the modal (see
    // openConverterModal) and decodes the resulting .jfs: { tracks, warnings }, or null when the user cancels.
    const convert = async (file, opts) => {
      const result = await openConverterModal(file, opts);
      if (!result) return null;
      return jfsLegacyFormat.decode(await result.blob.arrayBuffer(), { name: result.filename });
    };
    const ctx = { ui: { convertGpx: (file) => openGpxImportModal(file) }, convert };
    for (const file of files) {
      try {
        const result = await formats.decodeFile(file, ctx);
        if (!result) continue; // cancelled
        this._store.addTracks(result.tracks);
        for (const w of result.warnings) this._pushWarning(w);
      } catch (err) {
        this._pushWarning(`${file.name}: ${err.message}`);
      }
    }
  }

  async _doImport() {
    const picked = await pickFilesToOpen(formats.importExtensions());
    await this.importFiles(picked.map((p) => p.file));
  }

  /** Public entry points so joinfs-recorder-toolkit.js can trigger these from global hotkeys (Ctrl+O / Ctrl+S). */
  async openFiles() { return this._doImport(); }
  async save() { return this._doSave(); }

  async _doSave() {
    if (!this._store || this._store.project.tracks.length === 0) {
      this._pushWarning('Nothing to save yet - import a .jfs or .gpx file first.');
      return;
    }
    const buildVariant = this._root.getElementById('buildVariant').value;
    try {
      for (const key of formats.lossWarnings('jfs-legacy', this._store.project)) this._pushWarning(t(key));
      if (this.plugins) await this.plugins.activateForSave();
      const bytes = exportProject(this._store.project, { formatId: 'jfs-legacy', buildVariant, transform: this.plugins ? (tracks) => this.plugins.applyExportTransforms(tracks) : undefined });
      await saveJfsFile(bytes, 'project.jfs');
    } catch (err) {
      this._pushWarning(`Save failed: ${err.message}`);
    }
  }

  _pushWarning(message) {
    const el = document.createElement('div');
    el.className = 'warning';
    // textContent, not innerHTML: messages carry file names and plugin text
    const text = document.createElement('span');
    text.textContent = message;
    const close = document.createElement('button');
    close.title = t('warnings.dismiss');
    close.textContent = '×';
    close.addEventListener('click', () => el.remove());
    el.append(text, close);
    this._warningsEl.appendChild(el);
    setTimeout(() => el.remove(), 15000);
  }
}

customElements.define('jfs-toolbar', JfsToolbar);
