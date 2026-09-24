import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findFrameIndexAtTime, buildLodPyramid, altColor, buildColoredRuns, haversineM } from '../src/geo.js';

test('findFrameIndexAtTime: boundaries', () => {
  const times = [0, 1, 2, 3, 4];
  assert.equal(findFrameIndexAtTime(times, -1), -1);
  assert.equal(findFrameIndexAtTime(times, 0), 0);
  assert.equal(findFrameIndexAtTime(times, 2.5), 2);
  assert.equal(findFrameIndexAtTime(times, 10), 4);
});

test('buildLodPyramid: coarser levels have fewer buckets and preserve min/max spikes', () => {
  const n = 2000;
  const times = Array.from({ length: n }, (_, i) => i);
  const values = Array.from({ length: n }, (_, i) => (i === 1000 ? 9999 : 100));
  const pyramid = buildLodPyramid(times, values, { levels: 4, minBuckets: 32 });
  assert.ok(pyramid.length >= 2);
  assert.ok(pyramid[pyramid.length - 1].times.length < n, 'the coarsest level should have fewer buckets than raw samples');
  for (const level of pyramid) {
    let sawSpike = false;
    for (let i = 0; i < level.max.length; i++) if (level.max[i] > 5000) sawSpike = true;
    assert.ok(sawSpike, 'a min/max-preserving level should still show the spike');
  }
});

test('altColor: ground is grey regardless of altitude, airborne ramps by altitude', () => {
  assert.equal(altColor(5000, true), 'hsl(0,0%,45%)');
  assert.notEqual(altColor(500, false), altColor(20000, false));
});

test('buildColoredRuns: merges consecutive same-color points, splits on color change', () => {
  const points = [
    { lat: 0, lon: 0, color: 'a', colorKey: 'a' },
    { lat: 0, lon: 1, color: 'a', colorKey: 'a' },
    { lat: 0, lon: 2, color: 'b', colorKey: 'b' },
    { lat: 0, lon: 3, color: 'b', colorKey: 'b' },
  ];
  const runs = buildColoredRuns(points);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].latlngs.length, 2);
  // second run's first point should connect to the first run's last point
  assert.deepEqual(runs[1].latlngs[0], runs[0].latlngs[1]);
});

test('haversineM: zero distance for identical points, plausible for a known separation', () => {
  assert.equal(haversineM(0, 0, 0, 0), 0);
  const d = haversineM(0, 0, 0, 1); // ~1 degree of longitude at the equator
  assert.ok(d > 100000 && d < 120000);
});
