// Builders for the golden .jfs fixtures in test/fixtures/ (regenerate them with `node tools/make-fixtures.js`).
// The committed bytes pin the two legacy layouts and both tail families; test/fixtures.test.js fails if the encoder
// drifts from them. This module has no side effects: node --test runs every file under test/ as a test file.
import { encodeJfsFile, LAYOUT } from '../../src/jfs-codec.js';
import { buildSyntheticTrack } from './jfs-samples.js';

export const FIXTURES = {
  'current-fs2024.jfs': { layout: LAYOUT.CURRENT, buildVariant: 'fs2024', livery: true },
  'current-other.jfs': { layout: LAYOUT.CURRENT, buildVariant: 'other' },
  'legacy-staticcg-other.jfs': { layout: LAYOUT.LEGACY_STATIC_CG, buildVariant: 'other' },
};

export function buildFixture({ layout, buildVariant, livery = false }) {
  const track = buildSyntheticTrack({ frameCount: 12, withLivery: livery });
  track.frames.kin = new Float32Array(12 * 6).map((_, i) => 0.25 * (i + 1));
  track.frames.ctl = new Int16Array(12 * 5).map((_, i) => i * 100 - 2000);
  return encodeJfsFile([track], { buildVariant, layout });
}

