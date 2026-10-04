// Converter modal: embeds a real converter web component (the GPX one vendored verbatim in src/vendor/, or another one
// a plugin brings along, such as the IGC converter) instead of reimplementing conversion here, so ground clamping,
// derived attitude and derived gear/flaps/lights come from one tested engine. The user reviews the component's own form
// and clicks its Convert button; we listen for the 'converted' event and hand the resulting .jfs Blob back to the caller,
// who decodes it like any other .jfs import. Embedded here, the converters are told the target format (`build`), so
// the FS2024-vs-other question is not asked: the toolkit's own build selector decides when saving.

import { t, getLocale } from '../i18n.js';

const GPX_SRC = new URL('../vendor/joinfs-gpx-to-jfs.js', import.meta.url).href;

const loading = new Map();
/** Loads a classic script once; resolves when it has run. */
function loadScript(src) {
  if (!loading.has(src)) {
    loading.set(src, new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => { loading.delete(src); reject(new Error(`Failed to load the converter component (${src}).`)); };
      document.head.appendChild(script);
    }));
  }
  return loading.get(src);
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
 * Opens a modal embedding a converter component, pre-loaded with `file`.
 * opts: { tag = 'joinfs-gpx-to-jfs', script (URL of the component, loaded after the GPX converter, which it may build on),
 *         title, attributes (extra attributes for the element) }.
 * Resolves with `{ blob, filename }` once the user completes a conversion, or `null` if they close the modal without
 * converting.
 */
export async function openConverterModal(file, opts = {}) {
  const tag = opts.tag || 'joinfs-gpx-to-jfs';
  await loadScript(GPX_SRC);
  if (opts.script) await loadScript(opts.script);
  const attrs = { 'no-url-params': '', lang: getLocale(), build: 'fs2024', ...(opts.attributes || {}) };
  const attrText = Object.entries(attrs).map(([k, v]) => (v === '' ? k : `${k}="${String(v).replace(/"/g, '&quot;')}"`)).join(' ');
  const title = opts.title || t('modal.gpxTitle');

  const host = document.createElement('div');
  host.attachShadow({ mode: 'open' });
  const root = host.shadowRoot;
  root.innerHTML = `
    <style>${STYLE}</style>
    <dialog id="dlg">
      <div class="modal-head">
        <h3></h3>
        <button type="button" id="closeBtn" aria-label="${t('modal.close')}" title="${t('modal.close')}">×</button>
      </div>
      <div class="modal-body">
        <${tag} ${attrText}></${tag}>
      </div>
    </dialog>
  `;
  document.body.appendChild(host);
  const dialog = root.getElementById('dlg');
  root.querySelector('h3').textContent = title;
  const converter = root.querySelector(tag);

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

/** The GPX import dialog. */
export function openGpxImportModal(file) { return openConverterModal(file); }
