import { test } from 'node:test';
import assert from 'node:assert/strict';
import { History } from '../src/history.js';
import { Store } from '../src/store.js';
import { buildSyntheticTrack } from './helpers/jfs-samples.js';

const counter = () => { const s = { n: 0 }; s.inc = (label = 'inc') => ({ label, do: () => { s.n++; }, undo: () => { s.n--; } }); return s; };

test('exec, undo and redo run the command both ways; a new exec clears the redo stack', () => {
  const h = new History(); const c = counter();
  h.exec(c.inc()); h.exec(c.inc());
  assert.equal(c.n, 2);
  assert.ok(h.undo()); assert.equal(c.n, 1);
  assert.ok(h.canRedo);
  assert.ok(h.redo()); assert.equal(c.n, 2);
  h.undo(); h.exec(c.inc());
  assert.equal(h.canRedo, false);
  assert.equal(h.undo() && h.undo() && h.undo(), false, 'nothing left to undo returns false');
});

test('a command that throws in do() is not recorded', () => {
  const h = new History();
  assert.throws(() => h.exec({ do() { throw new Error('x'); }, undo() {} }));
  assert.equal(h.canUndo, false);
  assert.throws(() => h.exec({ do() {} }), /do\(\) and undo\(\)/);
});

test('checkpoint + revertTo undoes everything since, and leaves nothing to redo (edit mode Cancel)', () => {
  const h = new History(); const c = counter();
  h.exec(c.inc());
  const mark = h.checkpoint();
  h.exec(c.inc()); h.exec(c.inc());
  assert.equal(c.n, 3);
  h.revertTo(mark);
  assert.equal(c.n, 1);
  assert.equal(h.canRedo, false);
  assert.equal(h.canUndo, true, 'work before the checkpoint stays undoable');
});

test('the history is bounded and reports changes', () => {
  let changes = 0;
  const h = new History({ limit: 3, onChange: () => { changes++; } });
  const c = counter();
  for (let i = 0; i < 5; i++) h.exec(c.inc());
  let undone = 0; while (h.undo()) undone++;
  assert.equal(undone, 3);
  assert.equal(c.n, 2, 'the two oldest commands fell out of the history and cannot be undone');
  assert.ok(changes >= 5);
});

test('Store: moving and removing a track are undoable, redo restores, order and selection survive', () => {
  const store = new Store();
  const a = buildSyntheticTrack({ id: 'a' }); const b = buildSyntheticTrack({ id: 'b' }); const c = buildSyntheticTrack({ id: 'c' });
  store.addTracks([a, b, c]);
  store.setTrackOffset('b', 12);
  assert.equal(b.timeOffsetS, 12);
  store.undo(); assert.equal(b.timeOffsetS, 0);
  store.redo(); assert.equal(b.timeOffsetS, 12);

  store.removeTrack('b');
  assert.deepEqual(store.project.tracks.map((t) => t.id), ['a', 'c']);
  store.undo();
  assert.deepEqual(store.project.tracks.map((t) => t.id), ['a', 'b', 'c'], 'the track comes back at its old position');
  assert.equal(store.project.tracks[1].timeOffsetS, 12);
  store.redo();
  assert.deepEqual(store.project.tracks.map((t) => t.id), ['a', 'c']);
});

test('Store: history-changed is emitted so the UI can enable/disable undo and redo', () => {
  const store = new Store();
  const seen = [];
  store.addEventListener('history-changed', (e) => seen.push([e.detail.canUndo, e.detail.canRedo]));
  store.addTracks([buildSyntheticTrack({ id: 'a' })]);
  store.setTrackOffset('a', 5);
  store.undo();
  assert.deepEqual(seen, [[true, false], [false, true]]);
});
