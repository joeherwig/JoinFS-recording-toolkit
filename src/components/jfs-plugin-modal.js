// Large modal for plugins (Host API `ctx.ui.openModal`): a titled <dialog> with an empty body the plugin fills with its own
// element, such as a chart. It lives in a shadow root so the page's styles do not leak in; the page's theme variables
// (--panel-bg, --fg, --border) are inherited. While it is open the page's global shortcuts are suspended (keydown does not
// reach them), Esc and the close button close it.

import { t } from '../i18n.js';

const STYLE = `
  dialog {
    border: none; border-radius: 12px; padding: 0; background: var(--panel-bg, #12141a); color: var(--fg, #e2e8f0);
    width: min(1280px, 96vw); height: min(820px, 92vh); max-width: none; max-height: none;
  }
  dialog[open] { display: flex; flex-direction: column; }
  dialog.compact { width: min(36rem, 96vw); height: auto; max-height: 92vh; }
  dialog.max { width: 100vw; height: 100vh; border-radius: 0; }
  .modal-head .tools { display: flex; align-items: center; }
  .modal-head svg { width: 20px; height: 20px; }
  dialog::backdrop { background: rgba(0,0,0,.55); }
  .modal-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 8px 6px 16px; border-bottom: 1px solid var(--border, #262b36); }
  .modal-head h3 { margin: 0; font: 600 15px system-ui, sans-serif; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .modal-head button { min-width: 44px; min-height: 44px; background: transparent; border: none; color: inherit; font-size: 22px; cursor: pointer; line-height: 1; border-radius: 8px; }
  .modal-head button:hover, .modal-head button:focus-visible { background: var(--btn-bg-hover, #2d3748); outline: none; }
  .modal-body { flex: 1 1 auto; min-height: 0; padding: 12px 16px 16px; display: flex; flex-direction: column; overflow: auto; }
  .modal-body > * { flex: 1 1 auto; min-height: 0; }
`;

/**
 * Opens the modal (`compact`: only as large as its content, up to 36rem wide) and returns `{ body, close() }`. `body` is the element to fill (it is a flex column, a single child stretches
 * to the available space). `onClose` runs once when the modal is closed by any route. Opening a new one closes the old.
 */
let current = null;
export function openPluginModal({ title = '', onClose, compact = false } = {}) {
  if (current) current.close();
  const host = document.createElement('div');
  host.attachShadow({ mode: 'open' });
  const root = host.shadowRoot;
  root.innerHTML = `
    <style>${STYLE}</style>
    <dialog id="dlg" aria-labelledby="ttl">
      <div class="modal-head">
        <h3 id="ttl"></h3>
        <div class="tools">
          <button type="button" id="maxBtn" aria-pressed="false"></button>
          <button type="button" id="closeBtn" aria-label="${t('modal.close')}" title="${t('modal.close')}">×</button>
        </div>
      </div>
      <div class="modal-body" id="body"></div>
    </dialog>
  `;
  document.body.appendChild(host);
  const dialog = root.getElementById('dlg');
  root.getElementById('ttl').textContent = title;

  let closed = false;
  const handle = {
    body: root.getElementById('body'),
    close() {
      if (closed) return;
      closed = true;
      if (current === handle) current = null;
      if (dialog.open) dialog.close();
      host.remove();
      if (onClose) { try { onClose(); } catch (err) { console.warn('Modal onClose failed:', err); } }
    },
  };
  root.getElementById('closeBtn').addEventListener('click', () => handle.close());
  // fill the whole window and back; the content follows because it stretches with the modal
  const maxBtn = root.getElementById('maxBtn');
  const ICON = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const ICON_MAX = `<svg ${ICON}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>`;
  const ICON_RESTORE = `<svg ${ICON}><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>`;
  const setMax = (on) => {
    dialog.classList.toggle('max', on);
    maxBtn.innerHTML = on ? ICON_RESTORE : ICON_MAX;
    const label = t(on ? 'modal.restore' : 'modal.maximize');
    maxBtn.setAttribute('aria-label', label); maxBtn.title = label; maxBtn.setAttribute('aria-pressed', String(on));
  };
  setMax(false);
  if (compact) { dialog.classList.add('compact'); maxBtn.hidden = true; }   // sized to the content (a form), no maximise button
  maxBtn.addEventListener('click', () => setMax(!dialog.classList.contains('max')));
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); handle.close(); }); // Esc
  dialog.addEventListener('close', () => handle.close());
  // the page's global shortcuts (map zoom, play/pause, undo, ...) must not fire behind the modal; Esc is handled by the dialog
  dialog.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
  current = handle;
  dialog.showModal();
  return handle;
}
