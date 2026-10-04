# JoinFS-recording-toolkit

A browser-based toolkit to **visualize** and **edit** [JoinFS](https://joinfs.net/) `.jfs` flight-recording files on a map and a video-editor-style timeline.

- Load one or more `.jfs`, `.gpx` or `.igc` (glider flight log) files into a project; each recorded aircraft becomes an independent track.
- View every track's flight path on a map (dark / OSM / satellite tile layers), with an altitude-colored, grey-on-ground path and gear/flaps/light event markers for the focused track.
- Move a track's appearance in time or remove it entirely on the timeline.
- Save the project back out as a single `.jfs` file JoinFS can load and play back.

No build step: this is plain HTML/CSS/JS (ES modules), matching the conventions of the sibling
[`joinfs-gpx-to-jfs-webcomponent`](https://github.com/joeherwig/joinfs-gpx-to-jfs-webcomponent) and
[`joinfs-map-websocket-webcomponent`](https://github.com/joeherwig/joinfs-map-websocket-webcomponent) repos.
GPX import embeds `joinfs-gpx-to-jfs-webcomponent` directly (vendored verbatim at
`src/vendor/joinfs-gpx-to-jfs.js`, same license) rather than reimplementing its conversion — see
`docs/format-notes.md`.

See [REQUIREMENTS.md](REQUIREMENTS.md) for the full requirements and [PLAN.md](PLAN.md) for the implementation plan and known v1 limitations.

## Documentation

The user guide and the plugin documentation are in [docs/wiki](docs/wiki/Home.md) (the sources of the project wiki):
getting started, map and timeline, editing tracks (move, pin, trim), saving and formats, keyboard and mouse, the plugin
concept and how to write a plugin.

## Running locally

Any static file server works (the app uses ES modules, so `file://` won't work in most browsers). For example, with VS Code's "Live Server" extension: right-click `index.html` → "Open with Live Server". Or from the command line:

```sh
npx serve .
```

## Testing

```sh
npm test
```

Runs the unit test suite (`node --test`) covering the `.jfs` codec, gear/flaps/light variable decoding, geometry helpers, and project-model editing operations.

## Known v1 limitations

See the "Documented limitations" section of [PLAN.md](PLAN.md) — briefly: non-aircraft scenery objects aren't preserved, livery is only kept when saving in the FS2024 format, only a fixed set of simulator variables (gear/flaps/lights) get event markers, and playhead markers are a simple arrow rather than an aircraft-type-shaped icon.

## License

[Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International](LICENSE) (CC BY-NC-SA 4.0), matching
the vendored `joinfs-gpx-to-jfs-webcomponent` component this toolkit embeds.
