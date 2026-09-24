import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VU, decodeKnownVariable } from '../src/variables.js';

// These exact values are hardcoded in joinfs-gpx-to-jfs-webcomponent/test/helpers/jfs.js as
// "verified against the JoinFS source lookup" - matching them is a regression guard against our
// ported hashString() drifting from the upstream implementation.
test('VU ids match joinfs-gpx-to-jfs-webcomponent test fixture exactly', () => {
  assert.equal(VU.gear, 2991743992);
  assert.equal(VU.flaps, 3322317413);
  assert.equal(VU.lightStates, 437078432);
  assert.equal(VU.nav, 1582526319);
  assert.equal(VU.beacon, 1582526322);
  assert.equal(VU.landing, 1582526316);
  assert.equal(VU.taxi, 1582526312);
  assert.equal(VU.strobe, 981784475);
});

test('decodeKnownVariable: gear/flaps/light bit mirrors format as expected, unknown ids return null', () => {
  assert.deepEqual(decodeKnownVariable(VU.gear, 1), { variable: 'gear', label: 'Gear: Down' });
  assert.deepEqual(decodeKnownVariable(VU.gear, 0), { variable: 'gear', label: 'Gear: Up' });
  assert.deepEqual(decodeKnownVariable(VU.flaps, 0.5), { variable: 'flaps', label: 'Flaps: 50%' });
  assert.deepEqual(decodeKnownVariable(VU.flaps, 0), { variable: 'flaps', label: 'Flaps: Up' });
  assert.deepEqual(decodeKnownVariable(VU.flaps, 1), { variable: 'flaps', label: 'Flaps: Full' });
  assert.equal(decodeKnownVariable(VU.landing, 1).label, 'Landing light: ON');
  assert.equal(decodeKnownVariable(VU.landing, 0).label, 'Landing light: OFF');
  assert.equal(decodeKnownVariable(123456789, 1), null);
});
