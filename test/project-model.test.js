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

test('exportProject keeps the timeline positions, cuts what lies before 00:00 and drops tracks that lie entirely before it', () => {
  const a = buildSyntheticTrack({ id: 'a', callsign: 'ALPHA', frameCount: 10 }); // frames at 0 .. 0.45 s
  const b = buildSyntheticTrack({ id: 'b', callsign: 'BRAVO', frameCount: 10 });
  const gone = buildSyntheticTrack({ id: 'c', callsign: 'CHARLIE', frameCount: 10 });
  const project = { tracks: [a, b, gone] };
  setTrackOffset(project, 'a', -0.2); // its first four frames (0, .05, .1, .15) lie before 00:00
  setTrackOffset(project, 'b', 50);
  setTrackOffset(project, 'c', -100); // entirely before 00:00

  const bytes = exportProject(project, { buildVariant: 'other' });
  const { tracks } = decodeJfsFile(bytes.buffer);
  assert.deepEqual(tracks.map((t) => t.callsign).sort(), ['ALPHA', 'BRAVO']);

  const alpha = tracks.find((t) => t.callsign === 'ALPHA').frames.times;
  const bravo = tracks.find((t) => t.callsign === 'BRAVO').frames.times;
  assert.equal(alpha.length, 6, 'four frames cut, six kept');
  assert.ok(Math.abs(alpha[0]) < 1e-9 && Math.abs(alpha[1] - 0.05) < 1e-9, 'kept frames keep their timeline position (0.2 - 0.2 = 0)');
  assert.ok(Math.abs(bravo[0] - 50) < 1e-9, 'a track that starts later keeps its lead-in');
  assert.equal(a.frames.times.length, 10, 'the live project is untouched');
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
