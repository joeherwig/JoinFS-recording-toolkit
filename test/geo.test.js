import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findFrameIndexAtTime, buildLodPyramid, altColor, buildColoredRuns, haversineM, buildPositionSeries, interpolatePosition } from '../src/geo.js';

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

test('altColor: on-ground color is theme-dependent for contrast (dark/satellite got a reported low-contrast bug), airborne colors are not', () => {
  const light = altColor(5000, true, 'light');
  const dark = altColor(5000, true, 'dark');
  const satellite = altColor(5000, true, 'satellite');
  assert.equal(light, 'hsl(0,0%,45%)', 'light/OSM was not reported as low-contrast, so its shade is unchanged');
  assert.notEqual(dark, light);
  assert.notEqual(satellite, light);
  assert.notEqual(dark, satellite);
  // airborne colors don't need per-theme tuning - the ramp already reads against every basemap
  assert.equal(altColor(5000, false, 'dark'), altColor(5000, false, 'satellite'));
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

test('buildPositionSeries + interpolatePosition: a variable frame sharing a position frame\'s exact timestamp must not resolve to (0,0)', () => {
  // Reproduces the reported bug: the real gpx-to-jfs-webcomponent writer emits gear/flaps/light
  // variable frames at the exact same timestamp as the position sample they were derived from.
  // Interpolating against the raw, unfiltered frames (whose lat/lon default to 0 for non-position
  // frame slots) landed on that variable frame's own (0,0) entry instead of the real position frame
  // right next to it, since both share the identical timestamp - every event marker ended up at
  // Null Island. frames: [pos t=0 @ (10,20)] [variable t=0.5, lat/lon default 0] [pos t=1 @ (11,21)].
  const frames = {
    times: Float64Array.from([0, 0.5, 1]),
    types: Uint8Array.from([1, 11, 1]), // AircraftPosition, IntegerVariables, AircraftPosition
    lat: Float64Array.from([10, 0, 11]),
    lon: Float64Array.from([20, 0, 21]),
    alt: Float64Array.from([100, 0, 200]),
    heading: Float32Array.from([0, 0, 90]),
    groundFlags: Uint8Array.from([0, 0, 0]),
  };
  const series = buildPositionSeries(frames);
  assert.equal(series.times.length, 2, 'the variable frame entry must be filtered out');
  // The event's own timeS (0.5) exactly matches the variable frame's timestamp in the raw frames -
  // interpolating against the filtered series must fall between the two REAL position samples.
  const pos = interpolatePosition(series, 0.5);
  assert.ok(pos.lat > 0 && pos.lon > 0, `expected an interpolated position between (10,20) and (11,21), got (${pos.lat},${pos.lon})`);
  assert.ok(Math.abs(pos.lat - 10.5) < 0.01 && Math.abs(pos.lon - 20.5) < 0.01);
});

test('buildPositionSeries: returns null when a track has no valid position frames at all', () => {
  const frames = { times: Float64Array.from([0]), types: Uint8Array.from([11]), lat: Float64Array.from([0]), lon: Float64Array.from([0]), alt: Float64Array.from([0]), heading: Float32Array.from([0]), groundFlags: Uint8Array.from([0]) };
  assert.equal(buildPositionSeries(frames), null);
});
