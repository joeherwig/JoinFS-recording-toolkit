// App shell: wires the Store to <jfs-map>/<jfs-timeline>/<jfs-toolbar>, handles drag-and-drop
// import and the global keyboard shortcuts. See PLAN.md Step 1.

import { Store } from './store.js';
import { initTheme, setTheme, getStoredTheme } from './theme.js';
import { setLocale, resolveLocaleFromUrl } from './i18n.js';
import { shortcuts } from './shortcuts.js';

async function main() {
  initTheme();
  await setLocale(resolveLocaleFromUrl());

  // Components render their (locale-dependent) text at construction time, so their modules -
  // and therefore their customElements.define() calls - are imported only after the locale is
  // ready; the <jfs-map>/<jfs-timeline>/<jfs-toolbar> tags already in index.html upgrade at that
  // point with the right strings.
  await Promise.all([
    import('./components/jfs-map.js'),
    import('./components/jfs-timeline.js'),
    import('./components/jfs-toolbar.js'),
  ]);

  const store = new Store();
  const mapEl = document.querySelector('jfs-map');
  const timelineEl = document.querySelector('jfs-timeline');
  const toolbarEl = document.querySelector('jfs-toolbar');

  mapEl.store = store;
  timelineEl.store = store;
  toolbarEl.store = store;
  toolbarEl.setAppTheme(getStoredTheme());

  // <jfs-map> now owns its own layer-button control (three buttons: dark/light/satellite,
  // overlaid on the map itself) rather than a toolbar dropdown, so it manages `store.mapTileTheme`
  // and its own `theme` attribute directly - see jfs-map.js's _swapTileLayer().
  toolbarEl.addEventListener('app-theme-changed', (e) => {
    store.appTheme = e.detail.theme;
    setTheme(e.detail.theme);
  });

  for (const el of [mapEl, timelineEl]) {
    el.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files || []).filter((f) => /\.(jfs|gpx)$/i.test(f.name));
      if (files.length) toolbarEl.importFiles(files);
    });
  }

  // Every global key goes through the shortcut registry (src/shortcuts.js), which ignores key presses
  // in text-entry contexts - including inputs inside shadow roots such as the GPX converter form.
  shortcuts.register({ id: 'save', key: 's', primary: true, allowInTyping: true, run: () => toolbarEl.save() });
  shortcuts.register({ id: 'open', key: 'o', primary: true, allowInTyping: true, run: () => toolbarEl.openFiles() });
  // Space's default action is scrolling the page - not what we want here, so it is prevented
  shortcuts.register({ id: 'play-pause', key: ' ', run: () => timelineEl.togglePlay() });
  shortcuts.attach(window);
}

main();
