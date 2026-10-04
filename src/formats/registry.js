// Format registry (PLAN-v2.md §3.2). Importers/exporters register themselves here; the app only ever
// talks to this registry, never to a concrete codec, so a new JoinFS format is one new module.
//
// A format spec: { id, label, extensions: ['.jfs'], sniff(u8, name) -> score 0..1,
//   decode(arrayBuffer, ctx) -> { tracks, warnings }  (optional - export-only formats omit it),
//   encode(tracks, options) -> Uint8Array              (optional - import-only formats omit it),
//   saveOptions: [{ id, values: [...], default }], capabilities: { ... } }

export class FormatError extends Error {
  constructor(message, code) { super(message); this.name = 'FormatError'; this.code = code; }
}

export class FormatRegistry {
  constructor() { this._formats = new Map(); }

  register(spec) {
    if (!spec || !spec.id) throw new Error('A format needs an id.');
    if (this._formats.has(spec.id)) throw new Error(`Format "${spec.id}" is already registered.`);
    this._formats.set(spec.id, { saveOptions: [], capabilities: {}, extensions: [], ...spec });
    return () => this._formats.delete(spec.id);
  }

  get(id) { return this._formats.get(id) || null; }
  list() { return [...this._formats.values()]; }
  importable() { return this.list().filter((f) => typeof f.decode === 'function'); }
  exportable() { return this.list().filter((f) => typeof f.encode === 'function'); }

  /** All extensions (lower case, with dot) any importable format accepts - for pickers and drop filters. */
  importExtensions() { return [...new Set(this.importable().flatMap((f) => f.extensions.map((e) => e.toLowerCase())))]; }

  /** True if a file name looks importable (drag-and-drop filter). */
  acceptsName(name) {
    const lower = String(name || '').toLowerCase();
    return this.importExtensions().some((e) => lower.endsWith(e));
  }

  /**
   * Picks the importable format that recognises the content best. Ties go to the format registered first.
   * A format whose sniff throws is skipped (and counts as 0), never aborting the others.
   */
  detect(u8, name = '') {
    let best = null;
    let bestScore = 0;
    for (const f of this.importable()) {
      let score = 0;
      try { score = Number(f.sniff ? f.sniff(u8, name) : 0) || 0; } catch { score = 0; }
      if (score > bestScore) { best = f; bestScore = score; }
    }
    return best;
  }

  /**
   * Decodes `file` ({ name, arrayBuffer() }) with the best-matching format. `ctx` is passed through to the
   * format (e.g. UI hooks for importers that need a dialog). Resolves `{ tracks, warnings, formatId }`,
   * or `null` if an interactive importer was cancelled.
   */
  async decodeFile(file, ctx = {}) {
    const buffer = await file.arrayBuffer();
    const u8 = new Uint8Array(buffer);
    const format = this.detect(u8, file.name);
    if (!format) throw new FormatError(`"${file.name}" is not a file type this toolkit can open.`, 'unknownFormat');
    const result = await format.decode(buffer, { ...ctx, name: file.name, file });
    if (!result) return null;
    return { warnings: [], ...result, formatId: format.id };
  }

  encode(formatId, tracks, options = {}) {
    const f = this.get(formatId);
    if (!f || typeof f.encode !== 'function') throw new FormatError(`Cannot save as "${formatId}".`, 'noExporter');
    return f.encode(tracks, options);
  }

  /** What a save to `formatId` would lose, as warnings: one per capability the project uses but the format lacks. */
  lossWarnings(formatId, project) {
    const f = this.get(formatId);
    if (!f || typeof f.lossWarnings !== 'function') return [];
    return f.lossWarnings(project);
  }
}
