# ground-height

Shows how high a track really flew above the ground.

- **Ground height: show / hide** (menu entry, icon: a track over terrain) looks the terrain height up along the track (once, then
  cached on the track) and draws it in the track's **ALT** lane on the same scale as the altitude. Undoable. Not saved into the
  recording.
- **Altitude and ground profile…** (menu entry, icon: axes with a curve over terrain) opens a large modal window with the vendored
  `<joinfs-ground-profile>` chart for that one aircraft: altitude, terrain, height above ground, the lowest height above ground;
  wheel zoom, drag or Ctrl+wheel scrolling, click to move the playhead, ft / m. It looks the terrain up first if that was not done yet.

Where the heights come from: the vendored component asks [open-meteo.com](https://open-meteo.com) (Copernicus 90 m terrain model)
for a thinned-out sample of the track's positions (about one per 250 m, at most about 600, rounded to about 11 m). The first
lookup says so in a notice. Nothing else leaves the browser.

- `vendor/` is a verbatim copy of `src/` of [joinfs-ground-height-webcomponent](https://github.com/joeherwig/joinfs-ground-height-webcomponent)
  (script plus its locale files; a test fails when it is out of date and the repo is checked out next to this one).
- State: `track.ext.groundHeight = { profile: { times (track time), height (m), source, points }, shown }`. Other plugins (an analysis
  plugin) can read the profile and use `JoinfsGroundHeight.interpolate / aglSeries / statistics` from the component.
- Uses `ctx.ui.registerTimelineLayer` (with `altitudeY`), `ctx.ui.openModal`, `ctx.i18n.locale`, `ctx.exec`.
- `options.provider` (exported from `index.js`) replaces the lookup; the tests use it.
- **Slim build:** delete this folder and the id in `src/plugins/known.js`; nothing else changes.
- Strings: `locales/en.json`, `locales/de.json`; the chart's own strings come with the component in 8 languages.
- Tests: `node --test plugins/ground-height/test`.
