// Regenerates the golden .jfs fixtures: `node test/fixtures/make-fixtures.js`. The committed bytes pin the
// two legacy layouts and both tail families; test/fixtures.test.js fails if the encoder drifts from them.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodeJfsFile, LAYOUT } from '../../src/jfs-codec.js';
import { buildSyntheticTrack } from '../helpers/jfs-samples.js';

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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [name, o] of Object.entries(FIXTURES)) {
    const dir = fileURLToPath(new URL('.', import.meta.url));
    writeFileSync(dir + name, buildFixture(o));
  }
}
