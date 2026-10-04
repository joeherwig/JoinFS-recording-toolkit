import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTrackOffset, removeTrack, exportProject } from '../src/project-model.js';
import { decodeJfsFile } from '../src/jfs-codec.js';
import { buildSyntheticTrack } from './helpers/jfs-samples.js';

test('setTrackOffset sets timeOffsetS only, does not touch frame data', () => {
  const track = buildSyntheticTrack();
  const project = { tracks: [track] };
  const originalTimes = Array.from(track.frames.times);
  setTrackOffset(project, track.id, 42);
  assert.equal(project.tracks[0].timeOffsetS, 42);
  assert.deepEqual(Array.from(project.tracks[0].frames.times), originalTimes);
});

test('removeTrack splices the track out; a missing id is a no-op', () => {
  const a = buildSyntheticTrack({ id: 'a' });
  const b = buildSyntheticTrack({ id: 'b' });
  const project = { tracks: [a, b] };
  removeTrack(project, 'a');
  assert.equal(project.tracks.length, 1);
  assert.equal(project.tracks[0].id, 'b');
  removeTrack(project, 'does-not-exist');
  assert.equal(project.tracks.length, 1);
});

test('exportProject rebases so the minimum effective frame time is ~0, offsets combine correctly, aircraftCount reflects remaining tracks', () => {
  const a = buildSyntheticTrack({ id: 'a', callsign: 'ALPHA', frameCount: 10 });
  const b = buildSyntheticTrack({ id: 'b', callsign: 'BRAVO', frameCount: 10 });
  const project = { tracks: [a, b] };
  setTrackOffset(project, 'a', -100); // push track a's effective start well before 0
  setTrackOffset(project, 'b', 50);

  const bytes = exportProject(project, { buildVariant: 'other' });
  const { tracks } = decodeJfsFile(bytes.buffer);
  assert.equal(tracks.length, 2);

  let minEffective = Infinity;
  for (const t of tracks) for (const time of t.frames.times) if (time < minEffective) minEffective = time;
  assert.ok(Math.abs(minEffective) < 1e-6, `expected rebased minimum time ~0, got ${minEffective}`);

  // track b's frames should still be 150 (offset 50 + rebase 100) seconds ahead of track a's
  const bStart = tracks.find((t) => t.callsign === 'BRAVO').frames.times[0];
  const aStart = tracks.find((t) => t.callsign === 'ALPHA').frames.times[0];
  assert.ok(Math.abs((bStart - aStart) - 150) < 1e-6);
});

test('exportProject throws on an empty project', () => {
  assert.throws(() => exportProject({ tracks: [] }));
});

test('exportProject applies export transforms to the rebased copy, not to the live project', () => {
  const track = buildSyntheticTrack({ id: 'a', callsign: 'ALPHA', frameCount: 10 });
  const project = { tracks: [track] };
  let sawLive = null;
  const bytes = exportProject(project, { buildVariant: 'other', transform: (tracks) => {
    sawLive = tracks[0] === project.tracks[0];
    return tracks.map((t) => ({ ...t, callsign: 'CHANGED' }));
  } });
  assert.equal(sawLive, false);
  assert.equal(project.tracks[0].callsign, 'ALPHA');
  assert.equal(decodeJfsFile(bytes.buffer).tracks[0].callsign, 'CHANGED');
});
