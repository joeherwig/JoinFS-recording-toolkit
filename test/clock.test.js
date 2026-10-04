import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatClock, parseClock } from '../src/clock.js';

test('formatClock shows hh:mm:ss, with tenths only when present', () => {
  assert.equal(formatClock(0), '00:00:00');
  assert.equal(formatClock(3), '00:00:03');
  assert.equal(formatClock(3725.4), '01:02:05.4');
  assert.equal(formatClock(59.96), '00:01:00');
  assert.equal(formatClock(-5), '00:00:00');
});

test('parseClock accepts h:mm:ss, m:ss and plain seconds and rejects the rest', () => {
  assert.equal(parseClock('01:02:05'), 3725);
  assert.equal(parseClock('2:05'), 125);
  assert.equal(parseClock('7.5'), 7.5);
  assert.equal(parseClock('00:00:03,5'), 3.5);
  for (const bad of ['', 'abc', '1:2:3:4', '1::2', '-3', ':']) assert.ok(Number.isNaN(parseClock(bad)), bad);
});

test('parseClock inverts formatClock', () => {
  for (const v of [0, 1, 59.9, 3600, 7325.3]) assert.equal(parseClock(formatClock(v)), v);
});
