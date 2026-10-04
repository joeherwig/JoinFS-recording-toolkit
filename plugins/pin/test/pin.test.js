import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPlugin, makeTrack } from '../../../test/helpers/fake-host.js';

test('pin: loads without warnings and offers a translated menu entry before its code is activated', async () => {
  const h = await loadPlugin('pin', { tracks: [makeTrack()], locale: 'de' });
  assert.equal(h.status().state, 'ready');
  assert.deepEqual(h.warnings, []);
  assert.equal(h.host.trackActions()[0].text, 'Spur anheften / lösen');
});

test('pin: toggling vetoes dragging, draws the marker, and undo/redo restore it', async () => {
  const track = makeTrack();
  const h = await loadPlugin('pin', { tracks: [track] });
  assert.equal(await h.host.runTrackAction('pin', 'toggle', 't1'), true);
  assert.equal(track.ext.pin, true);
  assert.equal(h.canDrag(track), false);
  assert.match(h.toasts.at(-1), /pinned/);

  const drawn = [];
  const g = { fillText: (...a) => drawn.push(a), set font(_) {}, set textBaseline(_) {} };
  [...h.layers][0].draw(g, { track, top: 20, height: 40 });
  assert.equal(drawn.length, 1);

  h.history.undo();
  assert.equal(h.canDrag(track), true);
  h.history.redo();
  assert.equal(h.canDrag(track), false);
  await h.host.runTrackAction('pin', 'toggle', 't1');
  assert.equal(h.canDrag(track), true);
});

test('pin: disabling the plugin removes its guard and layer', async () => {
  const track = makeTrack();
  const h = await loadPlugin('pin', { tracks: [track] });
  await h.host.runTrackAction('pin', 'toggle', 't1');
  h.host.setEnabled('pin', false);
  assert.equal(h.guards.size, 0);
  assert.equal(h.layers.size, 0);
});
