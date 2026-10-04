# igc

Opens **IGC glider flight logs** (`.igc`). Drop or pick one like any other file: the converter dialog opens with the
flight summarised and callsign, model and nickname taken from the IGC header (competition id or glider id, glider type,
pilot), ICAO type `GLID` (editable), category glider. **Convert** turns it into a normal track you can move, trim and
save with the others. The target-format question (FS2024 or other) is not asked here; the toolkit's build selector decides
when saving.

- The conversion is done by the vendored web component [`joinfs-igc-to-jfs`](https://github.com/joeherwig/joinfs-igc-to-jfs-webcomponent)
  (`vendor/`, copied verbatim, with its German locale file), which wraps the GPX converter of the toolkit.
- The plugin registers the `igc` format (`ctx.io.registerFormat`) and runs the component through the decode context's
  `convert(file, { tag, script, title })`.
- **Slim build:** delete this folder and the id in `src/plugins/known.js`; `.igc` is then not offered, nothing else changes.
- Strings: `locales/en.json`, `locales/de.json`; the component's own dialog strings come with it.
- Tests: `node --test plugins/igc/test`.
