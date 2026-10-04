// Keyboard shortcut registry (PLAN-v2.md §3.6).
//
// One place decides whether a key press is a shortcut or ordinary typing. The old per-listener check
// (`e.target.tagName` on window) failed for inputs inside shadow roots: the event is retargeted to the
// outermost shadow host, so typing a space into the GPX converter form (shadow DOM inside a modal
// host) looked like a press on a <div> and toggled playback.

const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const TEXT_ENTRY_ROLES = new Set(['textbox', 'combobox', 'searchbox', 'spinbutton']);
const KEY_OWNING_TAGS = new Set(['BUTTON', 'A', 'SUMMARY']);

function isTextEntry(el) {
  if (!el || el.nodeType !== 1) return false;
  if (TEXT_ENTRY_TAGS.has(el.tagName)) return true;
  if (el.isContentEditable) return true;
  const role = el.getAttribute && el.getAttribute('role');
  return !!role && TEXT_ENTRY_ROLES.has(role);
}

function isKeyOwner(el) {
  if (!el || el.nodeType !== 1) return false;
  if (KEY_OWNING_TAGS.has(el.tagName)) return true;
  const role = el.getAttribute && el.getAttribute('role');
  return role === 'button';
}

function isOpenModal(el) {
  return !!el && el.nodeType === 1 && el.tagName === 'DIALOG' && el.open === true;
}

/**
 * True if `event` happens where the user is typing (or interacting with a control that owns the key),
 * so a global shortcut must stay out of the way. Uses the composed path so inputs inside (nested)
 * shadow roots are seen, and treats everything inside an open modal <dialog> as typing context.
 */
export function isTypingContext(event) {
  if (event.isComposing) return true;
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
  if (path.some(isOpenModal)) return true;
  const origin = path[0] || event.target;
  if (isTextEntry(origin)) return true;
  // a focused button/link/summary activates on Space and Enter: the shortcut must not also fire
  if ((event.key === ' ' || event.key === 'Enter') && path.some(isKeyOwner)) return true;
  return false;
}

function matches(spec, e) {
  const key = (e.key || '').toLowerCase();
  if (key !== spec.key.toLowerCase()) return false;
  const primary = e.ctrlKey || e.metaKey;
  if (!!spec.primary !== primary) return false;
  if (!!spec.alt !== e.altKey) return false;
  if (!spec.primary && e.shiftKey !== !!spec.shift && key.length > 1) return false;
  return true;
}

export class Shortcuts {
  constructor() {
    this._specs = [];
    this._listener = null;
  }

  /**
   * Registers a shortcut. `spec`: `{ id, key, primary?, alt?, shift?, allowInTyping?, preventDefault?, when?, run }`.
   * `allowInTyping` lets Ctrl/Cmd+S style chords work inside inputs (never inside an open modal).
   * Returns an unregister function.
   */
  register(spec) {
    const entry = { preventDefault: true, ...spec };
    this._specs.push(entry);
    return () => { this._specs = this._specs.filter((s) => s !== entry); };
  }

  handle(e) {
    if (e.defaultPrevented) return false;
    for (const spec of this._specs) {
      if (!matches(spec, e)) continue;
      if (spec.when && !spec.when(e)) continue;
      if (isTypingContext(e)) {
        const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
        const inModal = path.some(isOpenModal);
        if (!(spec.allowInTyping && !inModal && !e.isComposing)) continue;
      }
      if (spec.preventDefault) e.preventDefault();
      spec.run(e);
      return true;
    }
    return false;
  }

  attach(target = window) {
    this.detach();
    this._target = target;
    this._listener = (e) => this.handle(e);
    target.addEventListener('keydown', this._listener);
  }

  detach() {
    if (this._listener && this._target) this._target.removeEventListener('keydown', this._listener);
    this._listener = null;
  }
}

/** The app-wide registry; components register their keys here instead of adding their own listeners. */
export const shortcuts = new Shortcuts();
