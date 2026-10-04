// GPX importer. The conversion itself is the vendored joinfs-gpx-to-jfs component (opened in a dialog by the
// UI); until that component hands back neutral tracks directly (PLAN-v2.md §3.3), its output is a legacy
// `.jfs` blob which is decoded by the legacy format. The dialog is injected as `ctx.ui.convertGpx(file)` so
// this module stays free of DOM code and testable in node.

import { jfsLegacyFormat } from './jfs-legacy.js';

export const gpxFormat = {
  id: 'gpx',
  label: 'GPX track (.gpx)',
  extensions: ['.gpx'],

  sniff(u8, name = '') {
    if (/\.gpx$/i.test(name)) return 0.9;
    const head = new TextDecoder('utf-8', { fatal: false }).decode(u8.subarray(0, 512));
    return /<gpx[\s>]/i.test(head) ? 0.8 : 0;
  },

  async decode(_arrayBuffer, ctx = {}) {
    const convert = ctx.ui && ctx.ui.convertGpx;
    if (!convert) throw new Error('GPX import needs the converter dialog, which is not available here.');
    const result = await convert(ctx.file); // { blob, filename } or null when the user cancels
    if (!result) return null;
    const converted = await jfsLegacyFormat.decode(await result.blob.arrayBuffer(), { name: result.filename });
    for (const t of converted.tracks) t.sourceFormat = 'gpx';
    return converted;
  },
};
