import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FormatRegistry } from '../src/formats/registry.js';
import { formats } from '../src/formats/index.js';
import { encodeJfsFile, LAYOUT } from '../src/jfs-codec.js';
import { exportProject } from '../src/project-model.js';
import { buildSyntheticTrack } from './helpers/jfs-samples.js';

const file = (name, bytes) => ({ name, arrayBuffer: async () => (bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes) });

test('built-in registry knows .jfs and .gpx and filters dropped names', () => {
  assert.deepEqual(formats.importExtensions().sort(), ['.gpx', '.jfs']);
  assert.equal(formats.acceptsName('Flight.JFS'), true);
  assert.equal(formats.acceptsName('track.gpx'), true);
  assert.equal(formats.acceptsName('notes.txt'), false);
});

test('a .jfs file is detected and decoded by the legacy format, with its layout reported', async () => {
  const bytes = encodeJfsFile([buildSyntheticTrack({ frameCount: 20 })], { buildVariant: 'other' });
  const r = await formats.decodeFile(file('a.jfs', bytes));
  assert.equal(r.formatId, 'jfs-legacy');
  assert.equal(r.tracks.length, 1);
  assert.equal(r.info.layout, LAYOUT.CURRENT);
  assert.ok(r.tracks[0].color, 'tracks get a colour');
});

test('a GPX file is routed to the importer and goes through the dialog hook; cancelling resolves null', async () => {
  const gpx = new TextEncoder().encode('<?xml version="1.0"?><gpx version="1.1"><trk/></gpx>');
  const jfs = encodeJfsFile([buildSyntheticTrack({ frameCount: 10, callsign: 'FROMGPX' })], { buildVariant: 'other' });
  let seen = null;
  const ui = { convertGpx: async (f) => { seen = f.name; return { blob: { arrayBuffer: async () => jfs.buffer }, filename: 'converted.jfs' }; } };
  const r = await formats.decodeFile(file('walk.gpx', gpx), { ui });
  assert.equal(seen, 'walk.gpx');
  assert.equal(r.formatId, 'gpx');
  assert.equal(r.tracks[0].callsign, 'FROMGPX');
  assert.equal(r.tracks[0].sourceFormat, 'gpx');
  assert.equal(await formats.decodeFile(file('walk.gpx', gpx), { ui: { convertGpx: async () => null } }), null);
  await assert.rejects(() => formats.decodeFile(file('walk.gpx', gpx)), /converter dialog/);
});

test('content wins over the extension: GPX text named .jfs is still a GPX', async () => {
  const gpx = new TextEncoder().encode('<gpx version="1.1"></gpx>');
  assert.equal(formats.detect(gpx, 'weird.jfs').id, 'gpx');
});

test('an unknown file is rejected with a clear error', async () => {
  await assert.rejects(() => formats.decodeFile(file('x.bin', new Uint8Array(40))), /not a file type/);
});

test('registry: highest sniff score wins, a throwing sniff is ignored, duplicate ids are refused, unregister works', () => {
  const r = new FormatRegistry();
  const off = r.register({ id: 'weak', extensions: ['.x'], sniff: () => 0.3, decode: () => ({ tracks: [] }) });
  r.register({ id: 'strong', extensions: ['.x'], sniff: () => 0.9, decode: () => ({ tracks: [] }) });
  r.register({ id: 'broken', extensions: ['.x'], sniff: () => { throw new Error('boom'); }, decode: () => ({ tracks: [] }) });
  assert.equal(r.detect(new Uint8Array(8)).id, 'strong');
  assert.throws(() => r.register({ id: 'weak' }), /already registered/);
  off();
  assert.equal(r.get('weak'), null);
  assert.equal(r.exportable().length, 0);
});

test('export goes through the registry: legacy format, buildVariant option, current layout by default', () => {
  const project = { tracks: [buildSyntheticTrack({ withLivery: true })] };
  const fs2024 = exportProject(project, { buildVariant: 'fs2024' });
  const other = exportProject(project, { formatId: 'jfs-legacy', buildVariant: 'other' });
  assert.ok(fs2024.length > other.length, 'the fs2024 tail carries the livery string');
  assert.throws(() => exportProject(project, { formatId: 'nope' }), /Cannot save as/);
});

test('saving a project loaded from the older layout warns that the static CG height is dropped', () => {
  const project = { tracks: [{ ...buildSyntheticTrack(), sourceLayout: LAYOUT.LEGACY_STATIC_CG }] };
  assert.deepEqual(formats.lossWarnings('jfs-legacy', project), ['format.loss.staticCg']);
  assert.deepEqual(formats.lossWarnings('jfs-legacy', { tracks: [buildSyntheticTrack()] }), []);
});
