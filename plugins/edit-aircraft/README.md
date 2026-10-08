# edit-aircraft

Corrects the identity of a loaded track.

- **Edit aircraft type, callsign, nickname, altitude** (menu entry, pen icon) opens the `<jfs-edit-aircraft>` form in a plugin modal:
  - *Aircraft type (ICAO)*: upper-cased, 2-4 letters or digits, or empty. Written to `track.icaoType`.
  - *Callsign / tail number*: up to 16 characters. `.jfs` has no separate registration field; the callsign is what JoinFS shows as tail number. Written to `track.callsign`.
  - *Pilot nickname*: up to 32 characters. Written to `track.nickname`.
  - *Starting altitude* (ft or m): every position frame is moved by the same amount so the first one has this altitude.
  - *Fetch ground altitude at position* fills the altitude field with the terrain height at the track's first position, looked up online (Open-Meteo, Copernicus 90 m model; the same service as the GPX importer). Only on click; the position is sent rounded to about 11 m. Fails visibly and leaves the field alone.
- Apply is one undoable `ctx.exec` command. Shifting the altitude also drops the track's cached ground-height profile (`track.ext.groundHeight`, so the ALT-lane terrain curve disappears and is looked up again on demand; undo restores it); nothing else is stored in `track.ext`, the values are saved with the recording.
- Uses `ctx.tracks.patch`, `ctx.ui.openModal`, `ctx.exec`, `ctx.i18n`.
- `logic.js` holds the pure helpers (validation, unit conversion, diff); `edit-aircraft-form.js` the element (shadow DOM, themed by
  `prefers-color-scheme` or the `theme="light|dark"` attribute; `--ea-accent`, `--ea-outline`, `--ea-max-width` override colours and width).
- **Slim build:** delete this folder and the id in `src/plugins/known.js`.
- Strings: `locales/en.json`, `locales/de.json` (same keys; a test checks it). To add a language, add `locales/<lang>.json`.
- Tests: `node --test plugins/edit-aircraft/test`.
