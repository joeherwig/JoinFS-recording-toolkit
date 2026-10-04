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
  .menu-wrap { position: relative; }
  .menu { position: absolute; top: 100%; left: 0; z-index: 2100; min-width: 200px; margin-top: 4px; padding: 4px; background: var(--panel-bg, #12141a); border: 1px solid var(--border, #262b36); border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,.35); }
  .menu[hidden] { display: none; }
  .menu button { display: block; width: 100%; min-height: 44px; text-align: left; border: none; background: transparent; }
  .menu button:hover, .menu button:focus-visible { background: var(--btn-bg-hover, #2d3748); }
  .menu .empty { padding: 10px; color: var(--muted, #6b7280); }
  .modebar { flex-basis: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 6px 0 2px; border-top: 1px solid var(--border, #262b36); }
  .modebar[hidden] { display: none; }
  .modebar .mode-title { font-weight: 600; }
  .modebar label { display: flex; align-items: center; gap: 6px; }
  .modebar input { width: 7em; min-height: 32px; background: var(--btn-bg, #1e2433); color: inherit; border: 1px solid var(--border, #262b36); border-radius: 6px; padding: 2px 6px; }
  .modebar button { min-height: 44px; }
  .modebar button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
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
      <span class="menu-wrap">
        <button id="trackBtn" aria-haspopup="menu" aria-expanded="false" disabled>${t('toolbar.trackMenu')} ▾</button>
        <div class="menu" id="trackMenu" role="menu" hidden></div>
      </span>
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
      <div class="modebar" id="modeBar" hidden></div>
      <div class="warnings" id="warnings"></div>
    `;
    this._store = null;
    this._warningsEl = this._root.getElementById('warnings');
    this._root.getElementById('buildVariant').value = getStoredBuildVariant();

    this._root.getElementById('importBtn').addEventListener('click', () => this._doImport());
    this._root.getElementById('saveBtn').addEventListener('click', () => this._doSave());
    this._root.getElementById('undoBtn').addEventListener('click', () => this._store && this._store.undo());
    this._root.getElementById('redoBtn').addEventListener('click', () => this._store && this._store.redo());
    this._root.getElementById('trackBtn').addEventListener('click', (e) => { e.stopPropagation(); this._toggleTrackMenu(); });
    // outside click or Escape closes the menu; composedPath so clicks inside this shadow root count as inside
    document.addEventListener('click', (e) => { if (!e.composedPath().includes(this._root.getElementById('trackMenu'))) this._closeTrackMenu(); });
    this._root.getElementById('trackMenu').addEventListener('keydown', (e) => { if (e.key === 'Escape') { this._closeTrackMenu(); this._root.getElementById('trackBtn').focus(); } });
    this._root.getElementById('appTheme').addEventListener('change', (e) => {
      this.dispatchEvent(new CustomEvent('app-theme-changed', { detail: { theme: e.target.value } }));
    });
    this._root.getElementById('buildVariant').addEventListener('change', (e) => {
      setStoredBuildVariant(e.target.value);
    });
  }

  set store(store) {
    this._store = store;
    const syncTrackBtn = () => { this._root.getElementById('trackBtn').disabled = !store.selectedTrackId; this._closeTrackMenu(); };
    store.addEventListener('selection-changed', syncTrackBtn);
    store.addEventListener('history-changed', (e) => {
      this._root.getElementById('undoBtn').disabled = !e.detail.canUndo;
      this._root.getElementById('redoBtn').disabled = !e.detail.canRedo;
    });
  }

  // ---- Track Actions menu: entries come from the plugin host (manifests first, live registrations after) ----

  _toggleTrackMenu() {
    const menu = this._root.getElementById('trackMenu');
    if (!menu.hidden) return this._closeTrackMenu();
    menu.replaceChildren();
    const actions = this.plugins ? this.plugins.trackActions() : [];
    if (!actions.length) {
      const none = document.createElement('div');
      none.className = 'empty';
      none.textContent = t('toolbar.trackMenuEmpty');
      menu.appendChild(none);
    }
    for (const a of actions) {
      const item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.textContent = a.text;
      item.addEventListener('click', () => {
        this._closeTrackMenu();
        const id = this._store && this._store.selectedTrackId;
        if (id) this.plugins.runTrackAction(a.pluginId, a.id, id);
      });
      menu.appendChild(item);
    }
    menu.hidden = false;
    this._root.getElementById('trackBtn').setAttribute('aria-expanded', 'true');
    const first = menu.querySelector('button');
    if (first) first.focus();
  }

  _closeTrackMenu() {
    const menu = this._root.getElementById('trackMenu');
    if (menu.hidden) return;
    menu.hidden = true;
    this._root.getElementById('trackBtn').setAttribute('aria-expanded', 'false');
  }

  // ---- mode bar: a non-modal strip for plugin edit modes (trim, ...) ----

  /**
   * spec: { title, fields: [{ id, label, value, step, min }], buttons: [{ id, label, primary }], onChange(values), onButton(id, values) }
   * Returns { setValues(values), close() }. Only one mode bar is open at a time; opening another closes the first.
   */
  openModeBar(spec) {
    if (this._modeBarHandle) this._modeBarHandle.close();
    const bar = this._root.getElementById('modeBar');
    bar.replaceChildren();
    const title = document.createElement('span');
    title.className = 'mode-title';
    title.textContent = spec.title;
    bar.appendChild(title);
    const inputs = new Map();
    const values = () => Object.fromEntries([...inputs].map(([id, el]) => [id, el.value === '' ? NaN : Number(el.value)]));
    for (const fld of spec.fields || []) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'number';
      input.value = fld.value;
      if (fld.step !== undefined) input.step = fld.step;
      if (fld.min !== undefined) input.min = fld.min;
      input.addEventListener('input', () => spec.onChange && spec.onChange(values()));
      inputs.set(fld.id, input);
      label.append(fld.label + ' ', input);
      bar.appendChild(label);
    }
    for (const b of spec.buttons || []) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = b.label;
      if (b.primary) btn.className = 'primary';
      btn.addEventListener('click', () => spec.onButton && spec.onButton(b.id, values()));
      bar.appendChild(btn);
    }
    bar.hidden = false;
    const handle = {
      setValues: (v) => { for (const [id, el] of inputs) if (v[id] !== undefined) el.value = v[id]; },
      close: () => { if (this._modeBarHandle !== handle) return; this._modeBarHandle = null; bar.hidden = true; bar.replaceChildren(); },
    };
    this._modeBarHandle = handle;
    return handle;
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
