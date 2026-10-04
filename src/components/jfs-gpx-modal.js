// GPX import modal: embeds the real <joinfs-gpx-to-jfs> component (vendored verbatim in
// src/vendor/joinfs-gpx-to-jfs.js) instead of reimplementing GPX->JFS conversion ourselves, so
// ground-clamping, derived attitude, and derived gear/flaps/lights all come from the tested,
// upstream logic - see PLAN.md Step 6b. The user reviews/adjusts the real component's own form
// (ICAO type, callsign, livery, FS2024-vs-other, etc.) and clicks its own Convert button; we just
// listen for the 'converted' event it dispatches and hand the resulting .jfs Blob back to the caller,
// who feeds it through the normal jfs-codec.js decode path exactly like any other .jfs import.

import { t } from '../i18n.js';

const VENDOR_SRC = new URL('../vendor/joinfs-gpx-to-jfs.js', import.meta.url);


let _loadPromise = null;
function loadGpxToJfsComponent() {
  if (customElements.get('joinfs-gpx-to-jfs')) return Promise.resolve();
  if (_loadPromise) return _loadPromise;
  _loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = VENDOR_SRC;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load the GPX converter component.'));
    document.head.appendChild(script);
  });
  return _loadPromise;
}

const STYLE = `
  dialog {
    border: none; border-radius: 12px; padding: 0; background: var(--panel-bg, #12141a); color: var(--fg, #e2e8f0);
    max-width: min(600px, 92vw); width: 100%;
  }
  dialog::backdrop { background: rgba(0,0,0,.55); }
  .modal-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid var(--border, #262b36); }
  .modal-head h3 { margin: 0; font: 600 14px system-ui, sans-serif; }
  .modal-head button { background: transparent; border: none; color: inherit; font-size: 18px; cursor: pointer; line-height: 1; padding: 2px 6px; }
  .modal-body { padding: 16px; max-height: 80vh; overflow: auto; }
`;

/**
 * Opens a modal embedding the real GPX->JFS converter, pre-loaded with `file`.
 * Resolves with `{ blob, filename }` once the user completes a conversion, or `null` if they close
 * the modal without converting.
 */
export async function openGpxImportModal(file) {
  await loadGpxToJfsComponent();

  const host = document.createElement('div');
  host.attachShadow({ mode: 'open' });
  const root = host.shadowRoot;
  root.innerHTML = `
    <style>${STYLE}</style>
    <dialog id="dlg">
      <div class="modal-head">
        <h3>${t('modal.gpxTitle')}</h3>
        <button type="button" id="closeBtn" aria-label="${t('modal.close')}" title="${t('modal.close')}">×</button>
      </div>
      <div class="modal-body">
        <joinfs-gpx-to-jfs no-url-params></joinfs-gpx-to-jfs>
      </div>
    </dialog>
  `;
  document.body.appendChild(host);
  const dialog = root.getElementById('dlg');
  const converter = root.querySelector('joinfs-gpx-to-jfs');

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      dialog.close();
      host.remove();
      resolve(result);
    };

    converter.addEventListener('converted', (e) => {
      finish({ blob: e.detail.blob, filename: e.detail.filename });
    });
    root.getElementById('closeBtn').addEventListener('click', () => finish(null));
    dialog.addEventListener('cancel', () => finish(null)); // Escape key
    dialog.addEventListener('close', () => finish(null)); // any other close path

    dialog.showModal();
    // Pre-load the file the user already dropped/picked on our own toolbar, so they don't have to
    // select it again inside the embedded component - loadFile() is its documented public entry
    // point ("also used by the picker and drop").
    converter.loadFile(file);
  });
}
