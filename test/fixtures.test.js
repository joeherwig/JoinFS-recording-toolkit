import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { decodeJfsFile, encodeJfsFile, LAYOUT } from '../src/jfs-codec.js';
import { FIXTURES, buildFixture } from './helpers/fixture-builders.js';

const read = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const ab = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

for (const [name, o] of Object.entries(FIXTURES)) {
  test(`golden fixture ${name}: encoder output is byte-identical and the reader reports ${o.layout}`, () => {
    const golden = read(name);
    assert.equal(Buffer.compare(Buffer.from(golden), Buffer.from(buildFixture(o))), 0, 'encoder drifted from the golden bytes');
    const r = decodeJfsFile(ab(golden), { sourceFileName: name });
    assert.equal(r.layout, o.layout);
    assert.equal(r.tracks[0].frames.times.length, 12);
  });
}

test('the two layouts differ by exactly 4 bytes per position frame', () => {
  const d = read('current-other.jfs').length - read('legacy-staticcg-other.jfs').length;
  assert.equal(d, -12 * 4);
});

test('converter output (vendored) is a current-layout file that the toolkit decodes and re-encodes stably', () => {
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(new URL('../src/vendor/joinfs-gpx-to-jfs.js', import.meta.url), 'utf8'),
    { module, console, URL, setTimeout, TextEncoder, TextDecoder });
  const pts = Array.from({ length: 120 }, (_, i) => ({ t: 1.78e9 + i, lat: 50 + i * 1e-4, lon: 10 + i * 1.5e-4, ele: 400 + i * 2 }));
  const { data } = module.exports._core.convertPoints(pts, 'FIXTURE', { systems: 'off' });
  const first = decodeJfsFile(ab(data));
  assert.equal(first.layout, LAYOUT.CURRENT);
  assert.ok(first.tracks[0].frames.times.length > 100);
  const again = decodeJfsFile(ab(encodeJfsFile(first.tracks, { buildVariant: 'other' })));
  const a = first.tracks[0].frames, b = again.tracks[0].frames;
  for (const k of ['lat', 'lon', 'alt']) a[k].forEach((v, i) => assert.ok(Math.abs(v - b[k][i]) < 1e-9, k));
  for (const k of ['times', 'heading', 'kin', 'ctl', 'groundFlags']) {
    assert.deepEqual(Array.from(b[k]), Array.from(a[k]), k);
  }
});
