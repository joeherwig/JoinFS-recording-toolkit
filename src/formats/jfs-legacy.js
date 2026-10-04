// Legacy `.jfs` format module: wraps src/jfs-codec.js (see docs/format-notes.md for the two position-frame
// layouts). Sniffing is deliberately weak - the legacy format has no magic number, only a plausible version
// int16 - so a format with a real magic number (JFS2) always outranks it.

import { decodeJfsFile, encodeJfsFile } from '../jfs-codec.js';
import { colorForTrackId } from '../colors.js';

export const jfsLegacyFormat = {
  id: 'jfs-legacy',
  label: 'JoinFS recording (.jfs)',
  extensions: ['.jfs'],

  sniff(u8, name = '') {
    if (u8.length < 6) return 0;
    const version = new DataView(u8.buffer, u8.byteOffset, u8.length).getInt16(0, true);
    const plausible = version >= 10022 && version <= 29999;
    if (!plausible) return /\.jfs$/i.test(name) ? 0.2 : 0; // let decode produce the precise error for a .jfs
    return /\.jfs$/i.test(name) ? 0.6 : 0.4;
  },

  decode(arrayBuffer, { name = '' } = {}) {
    const { tracks, warnings, layout, version } = decodeJfsFile(arrayBuffer, { sourceFileName: name });
    for (const t of tracks) t.color = colorForTrackId(t.id);
    return { tracks, warnings, info: { layout, version } };
  },

  encode(tracks, { buildVariant = 'fs2024' } = {}) {
    return encodeJfsFile(tracks, { buildVariant });
  },

  // The tail layout depends on the JoinFS build that will replay the file and is not stored in the file.
  saveOptions: [{ id: 'buildVariant', values: ['fs2024', 'other'], default: 'fs2024' }],

  capabilities: { staticCgToGround: false, controls: true, nonAircraft: false, nickname: true, livery: 'fs2024-only' },

  lossWarnings(project) {
    const out = [];
    const layouts = new Set(project.tracks.map((t) => t.sourceLayout).filter(Boolean));
    if (layouts.has('legacy-staticcg')) out.push('format.loss.staticCg');
    return out;
  },
};
