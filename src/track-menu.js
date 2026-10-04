// Track actions menu: one popup shared by the right-click menu on timeline rows and the menu button in the timeline
// header. Entries come from the plugin host (manifest placeholders first, live registrations once a plugin has
// started). The popup lives in the page itself (not in a component's shadow root) so it can overlay everything.

import { t } from './i18n.js';

const STYLE_ID = 'jfs-track-menu-style';
const CSS = `
  .jfs-track-menu { position: fixed; z-index: 3000; min-width: 220px; max-width: min(92vw, 320px); padding: 4px; margin: 0;
    background: var(--panel-bg, #12141a); color: var(--fg, #e2e8f0); border: 1px solid var(--border, #262b36);
    border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.4); font: 13px system-ui, sans-serif; }
  .jfs-track-menu .head { padding: 6px 10px; color: var(--muted, #6b7280); font-size: 12px; }
  .jfs-track-menu button { display: block; width: 100%; min-height: 44px; padding: 0 12px; text-align: left; border: none;
    border-radius: 6px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
  .jfs-track-menu button:hover, .jfs-track-menu button:focus-visible { background: var(--btn-bg-hover, #2d3748); outline: none; }
  .jfs-track-menu .empty { padding: 10px 12px; color: var(--muted, #6b7280); }
`;

let openMenu = null;

export function closeTrackMenu() {
  if (!openMenu) return;
  const { el, cleanup, restoreFocus } = openMenu;
  openMenu = null;
  cleanup();
  el.remove();
  if (restoreFocus && restoreFocus.isConnected) restoreFocus.focus();
}

/**
 * Opens the menu for one track. Position: at the pointer (`x`,`y`) or under `anchor` (an element, for the button).
 * `restoreFocus` (optional) gets the focus back when the menu closes without running anything.
 */
export function showTrackMenu({ store, trackId, x = 0, y = 0, anchor = null, restoreFocus = null }) {
  closeTrackMenu();
  const track = store.project.tracks.find((tr) => tr.id === trackId);
  if (!track) return;
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  const el = document.createElement('div');
  el.className = 'jfs-track-menu';
  el.setAttribute('role', 'menu');
  const head = document.createElement('div');
  head.className = 'head';
  head.textContent = track.callsign || track.model || track.id;
  el.appendChild(head);

  const actions = store.plugins ? store.plugins.trackActions() : [];
  if (!actions.length) {
    const none = document.createElement('div');
    none.className = 'empty';
    none.textContent = t('toolbar.trackMenuEmpty');
    el.appendChild(none);
  }
  for (const a of actions) {
    const item = document.createElement('button');
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.textContent = a.text;
    item.addEventListener('click', () => {
      openMenu.restoreFocus = null; // the action decides where the focus goes
      closeTrackMenu();
      store.plugins.runTrackAction(a.pluginId, a.id, trackId);
    });
    el.appendChild(item);
  }
  document.body.appendChild(el);

  // keep it inside the viewport
  const rect = el.getBoundingClientRect();
  if (anchor) {
    const ar = anchor.getBoundingClientRect();
    x = ar.left;
    y = ar.bottom + 4;
  }
  el.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 4))}px`;
  el.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 4))}px`;

  const items = [...el.querySelectorAll('button')];
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeTrackMenu(); return; }
    if (!items.length || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
  };
  const onOutside = (e) => { if (!e.composedPath().includes(el)) closeTrackMenu(); };
  const onScrollOrResize = () => closeTrackMenu();
  document.addEventListener('keydown', onKey, true);
  // capture + pointerdown so a click on another row closes this menu before that row reacts
  document.addEventListener('pointerdown', onOutside, true);
  window.addEventListener('resize', onScrollOrResize);
  openMenu = {
    el, restoreFocus,
    cleanup: () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onOutside, true);
      window.removeEventListener('resize', onScrollOrResize);
    },
  };
  if (items[0]) items[0].focus();
}
