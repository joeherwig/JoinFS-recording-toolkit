# Plugin Concept

## Idea

The **core** does what every user needs and nothing more: it opens files, shows the map and the timeline, plays
back, moves and removes tracks, keeps the undo history, and saves. Everything else is a **plugin** that adds to the
core through a small, versioned interface (the *Host API*). Plugins load by themselves and are skipped quietly if
they are missing or broken, so the core still opens, plays and saves with **all plugins off**.

```
 formats (modules)                       core                           plugins
 jfs-legacy  --decode-->                                                pin
 gpx (converter dialog) -->  one neutral model  -->  map                trim
 jfs-legacy  <--encode--     history, Host API       timeline           (more to come)
                             shortcuts, import/save
 save pipeline:  offsets -> cut before 00:00 -> plugin transforms -> rebase -> format.encode
```

## What is core, what is plugin

| Core | Plugin |
|---|---|
| neutral track model, formats registry | pin, trim, igc, ground-height, edit-aircraft |
| map, timeline, playback | future: event editor, analytics |
| undo/redo history | |
| keyboard shortcut service | |
| import and save, the 00:00 cut | |
| track actions menu, right-click, ⋮ button | menu entries and their icons |
| the plugin host itself | |

## Rules every plugin lives by

- **One way to change data:** `ctx.exec(command)`. A command is `{ label, do(), undo() }`. Because every change goes
  through the history, every plugin edit is undoable, and a failing command is simply not recorded.
- **Plugins never touch components or each other.** They see only the Host API object (`ctx`), not the map, the
  timeline or other plugins.
- **Failure is contained.** A plugin that cannot be loaded, has the wrong API version, throws while starting, or
  throws inside a callback is switched off with a warning in the browser console (and a message for the user);
  everything it registered is removed again; the other plugins and the core are unaffected.
- **Plugin data stays with the track** in `track.ext.<something>` (for example `track.ext.pin`, `track.ext.trim`). It
  is kept while the plugin is off, but is not written into the `.jfs` file.
- **Strings are translated:** each plugin has its own `locales/en.json` and `locales/de.json`.
- **Responsive and accessible:** touch targets of at least 44 px, every drag has a button or keyboard alternative.

## Folder layout

```
plugins/<id>/
  manifest.json          declarative: id, version, apiVersion, activation, icons, contributions
  index.js               exports activate(ctx) and optionally deactivate()
  locales/en.json        strings (English is the fallback)
  locales/de.json
  icons/*.svg            menu and dialog icons (stroke="currentColor")
  test/*.test.js         run with node --test, using test/helpers/fake-host.js
  README.md
```

## How plugins are found and started

1. `src/plugins/known.js` lists the ids of the first-party plugins this build knows (`pin`, `trim`, `igc`, `ground-height`, `edit-aircraft`).
2. At startup the host tries to load all of them in parallel, **without delaying the app**: it fetches
   `plugins/<id>/manifest.json`, validates it, loads the locale files and the icons.
3. Because the manifest is declarative, the **menu entries appear before any plugin code is loaded**. A plugin
   marked `"activation": "onAction"` (pin, trim) imports its `index.js` only when the user first chooses one of its
   entries; `onStartup` plugins are started right away.
4. Plugins that contribute **export transforms** (trim) are always activated before a save, even if never opened, so
   their edits cannot be forgotten.
5. A plugin whose folder is not delivered is simply not used. **A slim build is made by deleting plugin folders**;
   nothing else needs editing. A test checks that every folder under `plugins/` is listed in `known.js`, so a new
   plugin cannot be forgotten.

A manifest can set `"defaultEnabled": false` for plugins that should be opt-in. A plugin can be switched off by
storing `false` under `jfs-toolkit:plugin.<id>.enabled` in the browser's local storage (a settings dialog for this is
planned).

## What plugins can contribute

| Contribution | Example | Host API |
|---|---|---|
| a track action in the right-click menu and the ⋮ menu | pin, trim | `ui.registerTrackAction` |
| a floating dialog | trim | `ui.openDialog` |
| drawing on the timeline rows | pin marker, trim borders | `ui.registerTimelineLayer` |
| a veto on dragging a track | pin | `tracks.registerDragGuard` |
| the part of a track that is shown and saved | trim | `tracks.registerRange` |
| a transform of the tracks when saving | trim | `io.registerExportTransform` |
| a keyboard shortcut | (none yet) | `shortcuts.register` |
| an import/export format | igc | `io.registerFormat` |

See [Writing a Plugin](Writing-a-Plugin) for the details.

## The plugins that exist

- **pin:** locks a track in time. About 40 lines; it is the smallest example of the whole stack (menu entry, guard,
  timeline layer, undoable command).
- **trim:** non-destructive trimming. It shows how a plugin narrows what is *shown* (`registerRange`), what is *saved*
  (`registerExportTransform`), and keeps the state of gear, flaps, lights and names correct at the new start.

- **igc:** opens `.igc` glider logs. It registers the format and asks the toolkit to run the vendored
  `joinfs-igc-to-jfs` component in the converter dialog; the component ships inside the plugin folder, so deleting the
  folder removes the feature completely.

- **ground-height:** looks the terrain height up along a track and shows it in the timeline's ALT lane
  (`registerTimelineLayer` with the lane scale `altitudeY`), and opens a large zoomable altitude/ground diagram
  (`ui.openModal`). Engine and chart come from the separate repo
  [joinfs-ground-height-webcomponent](https://github.com/joeherwig/joinfs-ground-height-webcomponent), vendored into the plugin folder.

- **edit-aircraft:** edits aircraft type (ICAO), callsign / tail number, pilot nickname and the starting altitude of a track in a form
  (`<jfs-edit-aircraft>`, shown with `ui.openModal`). The text fields are written with `ctx.tracks.patch`, the altitude shift is done on
  the shared `frames.alt` array; both in one `ctx.exec` command.

User documentation for pin, trim, ground-height and edit-aircraft is in [Editing Tracks](Editing-Tracks), for igc in [Saving and Formats](Saving-and-Formats#igc-import).

## Roadmap

Planned, not built yet:

- **event editor:** add, delete and move gear, flaps and light events (needs the variable frames as typed data in
  the core first),
- **analytics:** flight phases, block and air time, climb/cruise/descent, and an optional AI summary (opt-in, bring
  your own key, off by default),
- **Plugins dialog** to switch plugins on and off and **add a plugin by URL**,
- a **map layer** hook (so a plugin can mark things on the map),
- the **JFS2** recording format as a format module once JoinFS ships a recorder for it.
