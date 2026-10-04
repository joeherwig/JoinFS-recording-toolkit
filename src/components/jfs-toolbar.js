// <jfs-toolbar> - import/save controls, map/app theme + locale switches, clear-selection, warnings
// banner. See PLAN.md Step 1/6.

import { pickFilesToOpen, saveJfsFile } from '../file-io.js';
import { exportProject } from '../project-model.js';
import { formats } from '../formats/index.js';
import { openGpxImportModal } from './jfs-gpx-modal.js';
import { t } from '../i18n.js';

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
  dialog.edit { position: fixed; inset: 0 auto auto 0; z-index: 2500; margin: 0; width: min(92vw, 360px); max-height: 80vh; overflow: auto; padding: 0;
    background: var(--panel-bg, #12141a); color: var(--fg, #e2e8f0); border: 1px solid var(--border, #262b36); border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.45); }
  dialog.edit .edit-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border, #262b36); font-weight: 600; }
  dialog.edit .edit-head button { min-width: 44px; min-height: 44px; border: none; background: transparent; font-size: 18px; }
  dialog.edit .edit-body { display: flex; flex-direction: column; gap: 10px; padding: 12px; }
  dialog.edit label { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  dialog.edit input { width: 8em; min-height: 36px; background: var(--btn-bg, #1e2433); color: inherit; border: 1px solid var(--border, #262b36); border-radius: 6px; padding: 2px 8px; }
  dialog.edit .edit-buttons { display: flex; flex-wrap: wrap; gap: 8px; }
  dialog.edit .edit-buttons button { min-height: 44px; flex: 1 1 auto; }
  dialog.edit .edit-buttons button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
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
  // Non-modal on purpose: the timeline and the playhead stay usable while it is open ("Start = playhead").

  /**
   * spec: { title, fields: [{ id, label, value, step, min }], buttons: [{ id, label, primary }], onChange(values), onButton(id, values) }
   * Returns { setValues(values), close() }. Only one is open at a time; opening another closes the first.
   * The close button and Esc count as the button with id 'cancel'.
   */
  openDialog(spec) {
    if (this._dialogHandle) this._dialogHandle.close();
    const dlg = this._root.getElementById('editDialog');
    dlg.replaceChildren();
    const head = document.createElement('div');
    head.className = 'edit-head';
    const title = document.createElement('span');
    title.textContent = spec.title;
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '×';
    closeBtn.title = t('modal.close');
    closeBtn.setAttribute('aria-label', t('modal.close'));
    head.append(title, closeBtn);
    const body = document.createElement('div');
    body.className = 'edit-body';
    const inputs = new Map();
    const values = () => Object.fromEntries([...inputs].map(([id, el]) => [id, el.value === '' ? NaN : Number(el.value)]));
    for (const fld of spec.fields || []) {
      const label = document.createElement('label');
      const text = document.createElement('span');
      text.textContent = fld.label;
      const input = document.createElement('input');
      input.type = 'number';
      input.value = fld.value;
      if (fld.step !== undefined) input.step = fld.step;
      if (fld.min !== undefined) input.min = fld.min;
      input.addEventListener('input', () => spec.onChange && spec.onChange(values()));
      inputs.set(fld.id, input);
      label.append(text, input);
      body.appendChild(label);
    }
    const buttons = document.createElement('div');
    buttons.className = 'edit-buttons';
    for (const b of spec.buttons || []) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = b.label;
      if (b.primary) btn.className = 'primary';
      btn.addEventListener('click', () => spec.onButton && spec.onButton(b.id, values()));
      buttons.appendChild(btn);
    }
    body.appendChild(buttons);
    dlg.append(head, body);
    closeBtn.addEventListener('click', () => spec.onButton && spec.onButton('cancel', values()));
    dlg.oncancel = (e) => { e.preventDefault(); if (spec.onButton) spec.onButton('cancel', values()); };
    dlg.show();
    this._centerOverMap(dlg);
    this._onResize = () => this._centerOverMap(dlg);
    window.addEventListener('resize', this._onResize);
    const first = inputs.values().next().value;
    if (first) first.focus();
    const handle = {
      setValues: (v) => { for (const [id, el] of inputs) if (v[id] !== undefined) el.value = v[id]; },
      close: () => { if (this._dialogHandle !== handle) return; this._dialogHandle = null; window.removeEventListener('resize', this._onResize); dlg.close(); dlg.replaceChildren(); },
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
    const ctx = { ui: { convertGpx: (file) => openGpxImportModal(file) } };
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
