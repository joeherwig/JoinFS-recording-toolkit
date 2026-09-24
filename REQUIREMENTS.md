# JoinFS JFS Toolkit — Requirements

## Project
- A project consists of one or more loaded `.jfs` track recordings.
- Each `.jfs` file may itself contain one or more aircraft recordings (JoinFS records each aircraft as an independent entry with its own frame timeline).
- The project's unit of editing is the individual **aircraft track** — not the source file — since that's what the `.jfs` format itself treats as independent (own frames, own relative timestamps, all sharing one global recording clock).
- Saving a project produces exactly **one** merged `.jfs` file containing every aircraft track still in the project, loadable back into JoinFS.
- Re-opening that exported `.jfs` file is the resume-editing workflow — no separate editable-project file format or autosave is needed.
- On save (`Ctrl+S`), the user chooses the target build-variant tail layout: **FS2024** (3-string tail, livery preserved when present, default — the most commonly used build) or **other builds** (FSX/P3D/MSFS2020/X-Plane; 2-string tail, no livery field at all) — see recording-protocol.md §7.1. This choice is persisted in `localStorage` (same pattern as the app theme) so it survives a reload instead of always resetting to the FS2024 default.

## UI
- Auto-themeable, respecting the OS color theme (preferred default).
- Theme manually switchable.
- Sticks to design best practices (contrast, sizes, etc.).
- Responsive design.
- Localizeable via a `?lang=` URL parameter (matching `joinfs-gpx-to-jfs-webcomponent`'s own pattern), not an in-app dropdown — there's no interactive locale switch in the UI.
- Icons/logos are themeable vector files (SVG) only.
- Dragging track files onto the map or timeline adds them to the project.
- A `[+]`/"Import" control adds tracks without drag-and-drop.
- A `.jfs` file with multiple aircraft is split into one track per aircraft on import.
- A `.gpx` file opens a modal embedding the real `joinfs-gpx-to-jfs-webcomponent` converter (not a reimplementation) so ground-clamping, derived attitude, and derived gear/flaps/lights all come from that tested component; the resulting `.jfs` is then added as a track like any other import.
- All functionality is well tested.

## Visualizing
- A map shows every aircraft track in the project as a flight path, regardless of how many source files or aircraft contributed them.
- The map zooms/pans to fit all currently-included tracks whenever the set of tracks changes (a track is added or removed) - not on every unrelated update (e.g. toggling a lane or dragging a track's time offset must not re-zoom the map).
- Map layer switching between: dark schematic, bright OSM, and satellite imagery, via a single "layer stack" icon button overlaid on the map itself (cycles through the three on click; not a dropdown or three separate buttons), matching the reference gpxviewer.app screenshot's minimalist icon-control style.
- A timeline editor (video-editing-timeline style) shows one row per aircraft track along a shared time axis.
  - Each row has two independently toggleable (show/hide), stacked sub-lanes: altitude and speed (overlaid, not side-by-side).
  - Reference: gpxviewer.app's layout, adapted so altitude/speed are per-row stacked lanes instead of one global pair of graphs.
  - v1: a heading-rotated arrow marker (altitude-colored) moves along the path during scrubbing/playback. A full aircraft-type-shaped icon is a deferred follow-up.
- Timeline zoom is independent of map zoom.
- Timeline zoom: mouse wheel. Timeline pan: Ctrl+mousewheel, or dragging the scrubber/playhead indicator. Vertical scroll (when there are more tracks than fit): Shift+mousewheel, hovering the sidebar's mouse wheel, or dragging the native scrollbar.
- Zooming the timeline keeps the current time cursor (the vertical playhead indicator) within view, nudging the visible window if the zoom would otherwise push it out of frame.
- The timeline's initial zoom, the first time tracks are loaded into an empty project, shows the full duration of all loaded tracks (analogous to the map's auto-fit-bounds). Later track additions/removals don't force a re-fit, so a zoom level the user has since chosen is preserved.
- When there are more tracks than fit in the visible height, the timeline scrolls vertically (a real scrollbar) with the time ruler staying visible (pinned to the top) so elapsed time since the project start is always readable, for whichever tracks are currently in view.
- On-ground segments (`GroundFlags` bit 0) render grey; airborne segments use an altitude-based color ramp (ADSBExchange/tar1090-style).
- Markers show where gear/flaps/light events happen (hover tooltip), on both the map and the timeline. Shown per-track via a third toggle (EVT) alongside ALT/SPD — independent of focus/selection, defaults on — not gated to only the focused track.
- **Focus mode**: clicking a track (its timeline row sidebar or its map path) focuses it — other tracks (including their event markers, if shown) dim and desaturate in both map and timeline (synced); the focused track keeps full color. Click again, click empty map background, press Escape, or use "Clear selection" to return to equal display.
- Playback stops and the time cursor resets to the start when it reaches the end of the longest track (ready to replay immediately, rather than sitting at the end).

## Keyboard shortcuts
- `Ctrl+S` — save. `Ctrl+O` — import/open. `Space` — play/pause (ignored while typing in a form control). `L` — cycle the map layer. `Escape` — clear track focus/selection.

## Editing
- Move a single aircraft track along the timeline (shifts all its frame timestamps by a constant offset). Newly-added tracks default to starting at project t=0.
- Remove a single aircraft track from the project entirely.
- Dragging a track on the timeline works with mouse or touch.

## Technical decisions
- **Vanilla JS, no TypeScript, no bundler/build step** — matches sibling repos `joinfs-gpx-to-jfs-webcomponent` and `joinfs-map-websocket-webcomponent`.
- **File I/O**: File System Access API as primary mechanism (Chromium-first), falling back to `<input type=file>` + Blob download. Pure client-side web app, no backend.
- No project-file/autosave format — the exported `.jfs` itself is the resume point.
- Standalone repo; reusable logic is ported/adapted into this repo's own files (not npm/submodule dependencies), each ported function header-commented with its origin.
- Writer always targets `Sim.VERSION` 21008; tail layout (2-string vs. 3-string incl. livery) is chosen by the user at save time.

## `.jfs` format reference
- Authoritative spec: `JoinFS/docs/recording-protocol.md` — little-endian binary, `.NET BinaryWriter`-style strings, no magic number/checksum/length-framing, version-gated fields, ~20Hz recording rate, all recorded objects share one global recording clock.
- Existing tested writer reference (JS + Python): `joinfs-gpx-to-jfs-webcomponent/src/joinfs-gpx-to-jfs.js`, `tools/reference/gpx2jfs.py`.
- Non-aircraft `Obj` (scenery) records are out of scope for v1: not visualized, not editable, dropped on save (surfaced as a UI warning).

## Repo conventions reused
- `.jfs` codec: ported writer from `joinfs-gpx-to-jfs-webcomponent`; reader built from `test/helpers/jfs.js` with known gaps closed.
- Map tile layers: ported `TILES` pattern from `joinfs-map-websocket-webcomponent/joinfs-map.js`, plus a new keyless satellite theme.
- Map altitude coloring: ported `altColor(altFt)` from the same file.
- `.jfs` variable events (gear/flaps/lights): ported `hashString` + `VU` table from `joinfs-gpx-to-jfs.js`.
- Localization: ported lazy-fetched locale-JSON pattern from `joinfs-gpx-to-jfs-webcomponent`.
- GPX import: embeds `joinfs-gpx-to-jfs-webcomponent` itself (vendored verbatim), in a modal, rather than reimplementing its conversion.
