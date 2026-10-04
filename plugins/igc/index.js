// IGC import: adds the .igc glider flight log to the formats the toolkit opens. The work is done by the
// <joinfs-igc-to-jfs> component in vendor/ (parses the IGC file, prefills the form from its header, and hands the track
// to the GPX converter); this plugin only registers the format and asks the toolkit to run that component in its
// converter dialog, exactly like a GPX import. Without this folder the toolkit simply does not offer .igc.

const COMPONENT = {
  tag: 'joinfs-igc-to-jfs',
  script: new URL('./vendor/joinfs-igc-to-jfs.js', import.meta.url).href,
};

/** Score 0..1 that `u8` is an IGC file: the .igc name, or a manufacturer record plus a date header in the first 2 KB. */
export function sniff(u8, name = '') {
  if (/\.igc$/i.test(name)) return 0.9;
  const head = new TextDecoder('latin1').decode(u8.subarray(0, 2048));
  return /^A[A-Z0-9]{3}/.test(head) && /\nH[FOP]DTE/.test(head) ? 0.85 : 0;
}

export function activate(ctx) {
  ctx.io.registerFormat({
    id: 'igc',
    label: ctx.i18n.t('format.label'),
    extensions: ['.igc'],
    sniff,
    async decode(_buffer, decodeCtx) {
      if (typeof decodeCtx.convert !== 'function') throw new Error('IGC import needs the converter dialog, which is not available here.');
      // resolves { tracks, warnings }, or null when the user closes the dialog
      const result = await decodeCtx.convert(decodeCtx.file, { ...COMPONENT, title: ctx.i18n.t('dialog.title') });
      if (result) for (const track of result.tracks) track.sourceFormat = 'igc';
      return result;
    },
  });
}
