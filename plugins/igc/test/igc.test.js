import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadPlugin, makeTrack } from '../../../test/helpers/fake-host.js';
import { sniff } from '../index.js';

const IGC = 'AXXXSYN synthetic\r\nHFDTE200626\r\nHFPLTPILOT:Test\r\nB1100004833000N00928008EA0068500700\r\n';
const file = (name, text) => ({ name, arrayBuffer: async () => new TextEncoder().encode(text).buffer });

test('igc: loads cleanly and registers the format with a translated label', async () => {
  const h = await loadPlugin('igc', { locale: 'de' });
  assert.equal(h.status().state, 'active');
  assert.deepEqual(h.warnings, []);
  const format = h.formats.get('igc');
  assert.ok(format);
  assert.deepEqual(format.extensions, ['.igc']);
  assert.equal(format.label, 'IGC-Flugaufzeichnung (.igc)');
  assert.deepEqual(h.formats.importExtensions(), ['.igc']);
});

test('igc: sniff recognises the name, or a manufacturer record plus a date header, and nothing else', () => {
  const bytes = (t) => new TextEncoder().encode(t);
  assert.equal(sniff(bytes('whatever'), 'Flight.IGC'), 0.9);
  assert.equal(sniff(bytes(IGC), 'upload.bin'), 0.85);
  assert.equal(sniff(bytes('<?xml version="1.0"?><gpx/>'), 'track.gpx'), 0);
  assert.equal(sniff(bytes('plain text'), 'notes.txt'), 0);
});

test('igc: import goes through the converter dialog hook with the component, title and track source', async () => {
  const h = await loadPlugin('igc');
  const calls = [];
  const convert = async (f, opts) => { calls.push({ f, opts }); return { tracks: [makeTrack({ id: 'g' })], warnings: [] }; };
  const r = await h.formats.decodeFile(file('flight.igc', IGC), { convert });
  assert.equal(r.formatId, 'igc');
  assert.equal(r.tracks[0].sourceFormat, 'igc');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].f.name, 'flight.igc');
  assert.equal(calls[0].opts.tag, 'joinfs-igc-to-jfs');
  assert.match(calls[0].opts.script, /plugins\/igc\/vendor\/joinfs-igc-to-jfs\.js$/);
  assert.equal(calls[0].opts.title, 'Convert IGC flight log to JoinFS recording');
});

test('igc: closing the dialog cancels the import; no dialog hook is a clear error', async () => {
  const h = await loadPlugin('igc');
  assert.equal(await h.formats.decodeFile(file('f.igc', IGC), { convert: async () => null }), null);
  await assert.rejects(() => h.formats.decodeFile(file('f.igc', IGC), {}), /converter dialog/);
});

test('igc: the vendored component and its German strings are delivered with the plugin', () => {
  const dir = new URL('../vendor/', import.meta.url);
  assert.ok(fs.existsSync(new URL('joinfs-igc-to-jfs.js', dir)));
  assert.ok(fs.existsSync(new URL('joinfs-igc-to-jfs-de.json', dir)));
});
