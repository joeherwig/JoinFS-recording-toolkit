// Command history (PLAN-v2.md §3.5 / F2): every mutation of the project is a command `{ label, do(), undo() }`
// run through `exec`, which is what makes edits undoable and the only way plugins may change data.
// Checkpoints let an edit mode (trim, event editor) revert everything it did with one Cancel.

export class History {
  constructor({ limit = 200, onChange = () => {} } = {}) {
    this._undo = [];
    this._redo = [];
    this._limit = limit;
    this._onChange = onChange;
    this._seq = 0;
  }

  /** Runs a command and records it. Anything redoable is discarded. A command that throws is not recorded. */
  exec(command) {
    if (!command || typeof command.do !== 'function' || typeof command.undo !== 'function') {
      throw new Error('A command needs do() and undo().');
    }
    command.do();
    this._undo.push(command);
    if (this._undo.length > this._limit) this._undo.shift();
    this._redo.length = 0;
    this._onChange();
    return command;
  }

  get canUndo() { return this._undo.length > 0; }
  get canRedo() { return this._redo.length > 0; }
  get undoLabel() { return this.canUndo ? this._undo[this._undo.length - 1].label || '' : ''; }
  get redoLabel() { return this.canRedo ? this._redo[this._redo.length - 1].label || '' : ''; }

  undo() {
    const c = this._undo.pop();
    if (!c) return false;
    c.undo();
    this._redo.push(c);
    this._onChange();
    return true;
  }

  redo() {
    const c = this._redo.pop();
    if (!c) return false;
    c.do();
    this._undo.push(c);
    this._onChange();
    return true;
  }

  /** Marks the current position; `revertTo(mark)` undoes everything done after it. */
  checkpoint() { return { size: this._undo.length, id: ++this._seq }; }

  revertTo(mark) {
    while (this._undo.length > mark.size) this.undo();
    this._redo.length = 0; // a cancelled edit session leaves nothing to redo
    this._onChange();
  }

  clear() {
    this._undo.length = 0;
    this._redo.length = 0;
    this._onChange();
  }
}
