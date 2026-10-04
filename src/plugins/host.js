// Plugin host (PLAN-v2.md §3.5). Loads plugins tolerantly, gives each one a small scoped context (Host API v1)
// and isolates failures: a plugin that is missing, invalid, incompatible or throws is disabled with a warning
// and never takes the app or other plugins down. All environment access (fetch, import, storage, app services)
// is injected, so the host runs unchanged under node --test with a fake environment.

export const API_VERSION = 1;
const ACTIVATIONS = new Set(['onStartup', 'onAction', 'onTrackLoad']);

/** Validates a manifest object; returns a list of problems (empty = valid). */
export function validateManifest(m, expectedId) {
  const problems = [];
  if (!m || typeof m !== 'object') return ['manifest is not an object'];
  if (m.id !== expectedId) problems.push(`manifest id "${m.id}" does not match folder "${expectedId}"`);
  if (!Number.isInteger(m.apiVersion)) problems.push('apiVersion is missing');
  else if (m.apiVersion !== API_VERSION) problems.push(`needs host API v${m.apiVersion}, this app provides v${API_VERSION}`);
  if (m.activation !== undefined && !ACTIVATIONS.has(m.activation)) problems.push(`unknown activation "${m.activation}"`);
  return problems;
}

export class PluginHost {
  /**
   * env: { baseUrl, locale, fetchJson(url), importModule(url), storage: {get(key), set(key, value)}, warn(message) }
   * services: { formats, shortcuts, getTracks(), exec(command), toast(message), t(key, params), addMessages(prefix, dict),
   *   addDragGuard(fn), addTimelineLayer(layer), openModeBar(spec), getTime(), setTime(s), getSelectedId() }
   */
  constructor(env, services) {
    this._env = env;
    this._services = services;
    this._plugins = new Map(); // id -> { id, manifest, state, reason, enabled, module, dispose[] }
    this._trackActions = [];
    this._exportTransforms = [];
  }

  // ---- loading -----------------------------------------------------------------------------------------

  /** Tries to load every id in parallel; never rejects. Resolves the status list. */
  async loadAll(ids) {
    await Promise.all(ids.map((id) => this.load(id)));
    return this.status();
  }

  async load(id) {
    const entry = { id, manifest: null, state: 'unavailable', reason: '', enabled: true, module: null, dispose: [] };
    this._plugins.set(id, entry);
    const manifestUrl = new URL(`${id}/manifest.json`, this._env.baseUrl).href;
    try {
      entry.manifest = await this._env.fetchJson(manifestUrl);
    } catch (err) {
      return this._fail(entry, `manifest could not be loaded (${manifestUrl}): ${err.message}`);
    }
    const problems = validateManifest(entry.manifest, id);
    if (problems.length) return this._fail(entry, problems.join('; '));
    await this._loadLocales(entry);
    const defaultEnabled = entry.manifest.defaultEnabled !== false;
    const stored = this._readEnabled(id);
    entry.enabled = stored === null ? defaultEnabled : stored;
    entry.state = entry.enabled ? 'ready' : 'disabled';
    if (entry.enabled) this._declare(entry);
    if (entry.enabled && (entry.manifest.activation || 'onStartup') === 'onStartup') await this.activate(id);
    return entry;
  }

  /** Plugin strings live in plugins/<id>/locales/<lang>.json (English first, then the UI language on top). */
  async _loadLocales(entry) {
    const langs = ['en'];
    if (this._env.locale && this._env.locale !== 'en') langs.push(this._env.locale);
    const dict = {};
    for (const lang of langs) {
      const url = new URL(`${entry.id}/locales/${lang}.json`, this._env.baseUrl).href;
      try { Object.assign(dict, await this._env.fetchJson(url)); } catch (err) {
        this._env.warn(`Plugin "${entry.id}": locale ${url} not loaded (${err.message}); using English.`);
      }
    }
    if (this._services.addMessages) this._services.addMessages(`plugin.${entry.id}.`, dict);
  }

  _fail(entry, reason) {
    entry.state = 'unavailable';
    entry.reason = reason;
    this._unregister(entry);
    this._env.warn(`Plugin "${entry.id}" unavailable: ${reason}`);
    return entry;
  }

  /** Manifest-declared contributions are visible before (and without) loading the plugin's code. */
  _declare(entry) {
    const c = (entry.manifest && entry.manifest.contributes) || {};
    for (const a of c.trackActions || []) this._trackActions.push({ ...a, pluginId: entry.id, declared: true });
  }

  // ---- activation --------------------------------------------------------------------------------------

  /** Imports index.js and runs activate(ctx). Safe to call repeatedly; failures disable the plugin. */
  async activate(id) {
    const entry = this._plugins.get(id);
    if (!entry || !entry.enabled || entry.state === 'unavailable') return false;
    if (entry.state === 'active') return true;
    if (entry.activating) return entry.activating;
    entry.activating = (async () => {
      const url = new URL(`${id}/index.js`, this._env.baseUrl).href;
      try {
        entry.module = await this._env.importModule(url);
        if (typeof entry.module.activate !== 'function') throw new Error('index.js exports no activate()');
        await entry.module.activate(this._makeContext(entry));
        entry.state = 'active';
        return true;
      } catch (err) {
        this._fail(entry, `failed to start: ${err.message}`);
        this._services.toast(this._services.t('plugins.failed', { name: id }));
        return false;
      } finally {
        entry.activating = null;
      }
    })();
    return entry.activating;
  }

  /** Plugins that contribute export transforms must run before every save, even if never opened. */
  async activateForSave() {
    const ids = [...this._plugins.values()]
      .filter((p) => p.enabled && p.manifest && ((p.manifest.contributes || {}).exportTransforms || []).length)
      .map((p) => p.id);
    await Promise.all(ids.map((id) => this.activate(id)));
  }

  setEnabled(id, enabled) {
    const entry = this._plugins.get(id);
    if (!entry || entry.state === 'unavailable') return false;
    this._writeEnabled(id, enabled);
    if (!enabled) {
      this._unregister(entry);
      if (entry.module && typeof entry.module.deactivate === 'function') {
        try { entry.module.deactivate(); } catch (err) { this._env.warn(`Plugin "${id}" deactivate failed: ${err.message}`); }
      }
      entry.module = null;
      entry.enabled = false;
      entry.state = 'disabled';
    } else {
      entry.enabled = true;
      entry.state = 'ready';
      this._declare(entry);
    }
    return true;
  }

  /** Runs a menu action; activates its plugin first if needed. Resolves false if the plugin could not provide it. */
  async runTrackAction(pluginId, actionId, trackId) {
    if (!(await this.activate(pluginId))) return false;
    const action = this._trackActions.find((a) => a.pluginId === pluginId && a.id === actionId && !a.declared);
    if (!action) { this._env.warn(`Plugin "${pluginId}" registered no action "${actionId}".`); return false; }
    action.run({ trackId });
    return true;
  }

  // ---- contributions (read by the UI) ------------------------------------------------------------------

  /** Menu entries: one per action id, live registrations replacing manifest placeholders; labels are translated. */
  trackActions() {
    return this._trackActions
      .filter((a) => a.declared ? !this._trackActions.some((b) => b !== a && b.pluginId === a.pluginId && b.id === a.id && !b.declared) : true)
      .map((a) => ({ ...a, text: this._services.t(`plugin.${a.pluginId}.${a.label || a.id}`) }));
  }

  /** Runs every registered export transform (lowest `order` first) over the tracks about to be saved. */
  applyExportTransforms(tracks) {
    let out = tracks;
    for (const tr of [...this._exportTransforms].sort((a, b) => a.order - b.order)) {
      try { out = tr.apply(out) || out; } catch (err) {
        this._env.warn(`Export transform "${tr.id}" failed and was skipped: ${err.message}`);
      }
    }
    return out;
  }

  status() {
    return [...this._plugins.values()].map((p) => ({
      id: p.id, state: p.state, reason: p.reason, enabled: p.enabled,
      version: p.manifest && p.manifest.version, name: p.manifest && p.manifest.name,
    }));
  }

  // ---- scoped context (Host API v1) --------------------------------------------------------------------

  _makeContext(entry) {
    const s = this._services;
    const own = (off) => { entry.dispose.push(off); return off; };
    const guard = (fn) => (...args) => {
      try { return fn(...args); } catch (err) { this._env.warn(`Plugin "${entry.id}" callback failed: ${err.message}`); return undefined; }
    };
    return Object.freeze({
      id: entry.id,
      apiVersion: API_VERSION,
      tracks: Object.freeze({
        registerDragGuard: (fn) => own(s.addDragGuard(guard(fn))),
        list: () => s.getTracks().map((t) => Object.freeze({ ...t })),
        get: (id) => { const t = s.getTracks().find((x) => x.id === id); return t ? Object.freeze({ ...t }) : null; },
      }),
      exec: (command) => s.exec(command),
      time: Object.freeze({ get: () => s.getTime(), set: (seconds) => s.setTime(seconds) }),
      selection: Object.freeze({ get: () => s.getSelectedId() }),
      i18n: Object.freeze({ t: (key, params) => s.t(`plugin.${entry.id}.${key}`, params) }),
      shortcuts: Object.freeze({
        register: (spec) => own(s.shortcuts.register({ ...spec, id: `${entry.id}:${spec.id}`, run: guard(spec.run) })),
      }),
      io: Object.freeze({
        registerFormat: (spec) => own(s.formats.register(spec)),
        registerExportTransform: (spec) => {
          const tr = { order: 100, ...spec, id: `${entry.id}:${spec.id}` };
          this._exportTransforms.push(tr);
          return own(() => { this._exportTransforms = this._exportTransforms.filter((x) => x !== tr); });
        },
      }),
      ui: Object.freeze({
        toast: (message) => s.toast(message),
        registerTimelineLayer: (layer) => own(s.addTimelineLayer({ draw: guard(layer.draw) })),
        /** Non-modal bar with number fields and buttons; returns { setValues(values), close() }. */
        openModeBar: (spec) => {
          const bar = s.openModeBar({ ...spec, onChange: guard(spec.onChange || (() => {})), onButton: guard(spec.onButton || (() => {})) });
          own(() => bar.close());
          return bar;
        },
        registerTrackAction: (spec) => {
          // replaces the manifest-declared placeholder with the live action
          this._trackActions = this._trackActions.filter((a) => !(a.pluginId === entry.id && a.id === spec.id));
          const action = { ...spec, pluginId: entry.id, run: guard(spec.run) };
          this._trackActions.push(action);
          return own(() => { this._trackActions = this._trackActions.filter((a) => a !== action); });
        },
      }),
    });
  }

  _unregister(entry) {
    for (const off of entry.dispose.splice(0)) { try { off(); } catch { /* already gone */ } }
    this._trackActions = this._trackActions.filter((a) => a.pluginId !== entry.id);
  }

  _readEnabled(id) {
    const v = this._env.storage.get(`plugin.${id}.enabled`);
    return v === 'true' ? true : v === 'false' ? false : null;
  }

  _writeEnabled(id, enabled) {
    this._env.storage.set(`plugin.${id}.enabled`, String(enabled));
  }
}
