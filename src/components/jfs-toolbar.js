// <jfs-toolbar> - import/save controls, map/app theme + locale switches, clear-selection, warnings
// banner. See PLAN.md Step 1/6.

import { pickFilesToOpen, saveJfsFile } from '../file-io.js';
import { tracksFromJfsBuffer, exportProject } from '../project-model.js';
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
      <select id="buildVariant" title="${t('toolbar.buildVariant.fs2024')}">
        <option value="fs2024" selected>${t('toolbar.buildVariant.fs2024')}</option>
        <option value="other">${t('toolbar.buildVariant.other')}</option>
      </select>
      <span class="spacer"></span>
      <button id="clearSelectionBtn" hidden>${t('toolbar.clearSelection')}</button>
      <select id="appTheme">
        <option value="auto">${t('toolbar.appTheme.auto')}</option>
        <option value="light">${t('toolbar.appTheme.light')}</option>
        <option value="dark">${t('toolbar.appTheme.dark')}</option>
      </select>
      <div class="warnings" id="warnings"></div>
    `;
    this._store = null;
    this._warningsEl = this._root.getElementById('warnings');
    this._root.getElementById('buildVariant').value = getStoredBuildVariant();

    this._root.getElementById('importBtn').addEventListener('click', () => this._doImport());
    this._root.getElementById('saveBtn').addEventListener('click', () => this._doSave());
    this._root.getElementById('clearSelectionBtn').addEventListener('click', () => this._store && this._store.clearSelection());
    this._root.getElementById('appTheme').addEventListener('change', (e) => {
      this.dispatchEvent(new CustomEvent('app-theme-changed', { detail: { theme: e.target.value } }));
    });
    this._root.getElementById('buildVariant').addEventListener('change', (e) => {
      setStoredBuildVariant(e.target.value);
    });
  }

  set store(store) {
    this._store = store;
    store.addEventListener('selection-changed', () => {
      this._root.getElementById('clearSelectionBtn').hidden = !store.selectedTrackId;
    });
  }

  setAppTheme(theme) { this._root.getElementById('appTheme').value = theme; }

  async importFiles(files) {
    for (const file of files) {
      try {
        const isGpx = /\.gpx$/i.test(file.name);
        if (isGpx) {
          // Route through the real gpx-to-jfs-webcomponent (embedded as a modal) rather than
          // reimplementing its conversion - see jfs-gpx-modal.js. The user reviews/adjusts its form
          // and clicks its own Convert button; we get back the resulting .jfs Blob (or null if they
          // closed the modal without converting) and feed it through the normal .jfs import path.
          const result = await openGpxImportModal(file);
          if (!result) continue; // cancelled
          const { tracks, warnings } = tracksFromJfsBuffer(await result.blob.arrayBuffer(), result.filename);
          this._store.addTracks(tracks);
          for (const w of warnings) this._pushWarning(w);
        } else {
          const { tracks, warnings } = tracksFromJfsBuffer(await file.arrayBuffer(), file.name);
          this._store.addTracks(tracks);
          for (const w of warnings) this._pushWarning(w);
        }
      } catch (err) {
        this._pushWarning(`${file.name}: ${err.message}`);
      }
    }
  }

  async _doImport() {
    const picked = await pickFilesToOpen();
    await this.importFiles(picked.map((p) => p.file));
  }

  /** Public entry points so app.js can trigger these from global hotkeys (Ctrl+O / Ctrl+S). */
  async openFiles() { return this._doImport(); }
  async save() { return this._doSave(); }

  async _doSave() {
    if (!this._store || this._store.project.tracks.length === 0) {
      this._pushWarning('Nothing to save yet - import a .jfs or .gpx file first.');
      return;
    }
    const buildVariant = this._root.getElementById('buildVariant').value;
    try {
      const bytes = exportProject(this._store.project, { buildVariant });
      await saveJfsFile(bytes, 'project.jfs');
    } catch (err) {
      this._pushWarning(`Save failed: ${err.message}`);
    }
  }

  _pushWarning(message) {
    const el = document.createElement('div');
    el.className = 'warning';
    el.innerHTML = `<span>${message}</span><button title="${t('warnings.dismiss')}">×</button>`;
    el.querySelector('button').addEventListener('click', () => el.remove());
    this._warningsEl.appendChild(el);
    setTimeout(() => el.remove(), 15000);
  }
}

customElements.define('jfs-toolbar', JfsToolbar);
