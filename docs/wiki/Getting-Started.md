# Getting Started

## Run it

The app uses ES modules, so it must be served over HTTP (opening `index.html` as a `file://` page does not work in
most browsers). From the repository folder:

```sh
npm run serve        # http://localhost:5500
```

Any other static file server works too (`npx serve .`, VS Code Live Server). Node 22 or newer is needed only for the
tiny server and the tests (`npm test`).

## Open recordings

> [!TIP]
> **Drag several files at once.** Select multiple `.jfs` and `.gpx` files in your file manager and drop them
> together onto the map or the timeline: they are all imported in one go (the Import button and Ctrl+O also allow
> selecting several files). Files of other types in the same drop are ignored.

Three ways, all equivalent:

- drag one or more files onto the map or the timeline,
- press **Import** in the toolbar,
- press **Ctrl+O** (Cmd+O on a Mac).

Accepted files: `.jfs` and `.gpx`. The app looks at the content, not only the name, so a GPX file named `.jfs` is
still treated as GPX.

- A `.jfs` file adds one track per recorded aircraft.
- A `.gpx` file opens the converter dialog where you choose aircraft type, callsign and so on; its result is added as
  a track. With several GPX files in one drop, the dialog opens for each of them in turn. See [Saving and Formats](Saving-and-Formats).

If something looks off (an older file layout, an ambiguous tail), a notice appears in the top right corner and
disappears by itself after a while.

## Look around

Select a track by clicking its path, its arrow, its row on the timeline or its entry in the legend. The other tracks
fade so you can follow one. Click an empty spot on the map or press **Esc** to clear the selection. Press **Space** to
play. More in [Map and Timeline](Map-and-Timeline).

## Edit and save

Right-click a track row for its actions, drag a row to move it in time, press **Ctrl+Z** to undo. See
[Editing Tracks](Editing-Tracks). Press **Save** (or **Ctrl+S**) to write one `.jfs` file with all tracks. Choose
the **build variant** in the toolbar first if you need to; see [Saving and Formats](Saving-and-Formats).

## Language and theme

- **Language:** English and German. The browser language is used; add `?lang=de` or `?lang=en` to the address to force
  one.
- **Theme:** the *Auto / Light / Dark* selector at the right of the toolbar. The map has its own layer button
  (see [Map and Timeline](Map-and-Timeline)).
