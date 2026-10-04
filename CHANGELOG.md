# Changelog

## Unreleased

- **IGC import** (plugin `igc`): `.igc` glider flight logs open like GPX tracks, with a flight summary and the form prefilled from
  the IGC header (competition id or glider id, glider type, pilot, ICAO type `GLID`, category glider). Based on the new
  component [joinfs-igc-to-jfs-webcomponent](https://github.com/joeherwig/joinfs-igc-to-jfs-webcomponent), vendored into the
  plugin folder.
- The converter dialogs embedded in the toolkit no longer ask for the target format (FS2024 or other); the toolbar's build
  selector decides when saving. This applies to GPX and IGC.
- Plugins can open converter dialogs through `decodeCtx.convert(file, { tag, script, title })` in their format's `decode`.
- `src/components/jfs-gpx-modal.js` is now the generic `jfs-converter-modal.js`.

## 1.0.0

First stable release. The toolkit opens JoinFS recordings, shows them on a map and a timeline, lets you line up,
pin and trim tracks, and saves one `.jfs` that current JoinFS replays.

### Highlights

- **Reads every `.jfs` in the wild.** JoinFS files all say version 21008 but come in two layouts (96-byte and 100-byte
  position frames). The reader probes both, shows which one it found, and refuses files that fit neither with a
  message listing what was tried.
- **Writes the layout current JoinFS reads.** Position frames are 96 bytes; the static CG height that current JoinFS
  no longer stores is dropped, with a notice when an older file loses it.
- **Keeps more of the recording.** Angular velocity, acceleration, control positions and the full state flags now
  survive load and save, together with the gear, flaps, light and other variable frames.
- **Plugins.** Everything beyond viewing, playing, moving, removing and saving is a plugin that loads by itself and is
  skipped if missing or broken. The first two plugins:
  - **Pin:** lock a track so it cannot be moved in time.
  - **Trim:** cut the start and end off a track with a range bar, `Start = playhead` / `End = playhead` buttons and a
    live summary. The map and the timeline show the track as it will be saved; the cut happens on save and the
    gear, flaps, lights and names from before the new start are written again at the start so the replay begins in
    the right state.
- **The timeline's 00:00 is where the file starts.** Moving a track so that part of it lies before 00:00 cuts that
  part on save (shown as cut in the views); moving it back restores it. Other tracks keep their timeline positions.
- **Undo and redo** for every change (move, remove, pin, trim): Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y, and toolbar buttons.
- **Zoom hotkeys:** **+** and **−** (also on the number pad) zoom the map like its buttons.
- **Track menu** on right-click of a track row and on a ⋮ button in the timeline header, with icons supplied by the
  plugins.
- **Formats are modules.** Import and save go through a formats registry that picks the format by content.
- **GPX import** through the embedded converter, which now writes the current JoinFS layout.
- **Documentation.** User guide, plugin concept and plugin authoring guide in `docs/wiki`.

### Fixes

- Typing a space in the GPX import form no longer toggles playback: keyboard shortcuts now ignore every text-entry
  context, including inputs inside shadow roots and open dialogs.
- The timeline's ruler, event markers and lines were drawn in a fixed light colour and vanished on the light theme;
  they now follow the theme and redraw when it changes.
- The GPX converter dialog now follows the toolkit's `?lang=` language instead of only the browser language.
- Esc closes the open menu or dialog without applying anything, wherever the focus is.
- Hard-coded timeline and dialog strings now go through the translator (English and German).
- Warning text is shown as text, never as markup.

### Changes

- The main script `src/app.js` is now `src/joinfs-recorder-toolkit.js`, so it cannot be confused with other `app.js`
  or `map.js` files on a page.
- The project was renamed from `joinfs-jfs-toolkit` to `JoinFS-recording-toolkit`.
- The "clear selection" toolbar button is gone; Esc or a click on the empty map does the same.
- Saving no longer shifts a project only when times are negative: the earliest remaining frame of the result is
  always moved to time 0.

### Known limitations

- Replaying a file with several aircraft in JoinFS and watching it on a websocket-fed map can show only one aircraft:
  JoinFS keys websocket updates by the owner node, which the replayed aircraft share. This is a JoinFS issue, not a
  file problem, and is not fixed here.
- Non-aircraft objects (scenery) are not preserved. Livery is kept only in the FS2024 build variant.
- Only gear, flaps and lights get event markers.
- Not built yet: editing single gear, flaps and light events, flight analytics, a Plugins dialog (switch plugins on
  and off, add by URL), a map layer hook for plugins (a trimmed range is not marked on the map beyond hiding the cut
  part), and the JFS2 format.
