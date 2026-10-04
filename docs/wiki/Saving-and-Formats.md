# Saving and Formats

## Save

**Save** (or **Ctrl+S**) writes **one `.jfs` file containing all tracks of the project**, using the order:

1. every track's frame times plus its timeline offset,
2. what lies before 00:00 is cut (see [Editing Tracks](Editing-Tracks#the-0000-rule)),
3. plugin transforms, for example trim,
4. the earliest remaining frame is moved to time 0, so a trimmed file does not start with silence,
5. the file is encoded in the format JoinFS reads.

Your browser's save dialog asks for the place and name where it supports it, otherwise the file lands in the
downloads folder as `project.jfs`.

A warning is shown when saving loses something (for example the static CG height of an older file, below).

## Build variant

The selector next to the undo buttons chooses the tail of each aircraft record:

| Option | Writes | Use for |
|---|---|---|
| **FS2024 (with livery)** | livery, ICAO type, ICAO airline | JoinFS builds for Microsoft Flight Simulator 2024 |
| **Other builds** | ICAO type, ICAO airline | FSX, P3D, MSFS 2020, X-Plane builds |

The choice is remembered. Livery is only kept in the FS2024 variant.

## What a `.jfs` file looks like

Legacy `.jfs` files all say *version 21008* but come in **two layouts**, and nothing in the file tells which:

| Layout | Written by | Position frame |
|---|---|---|
| **current** | current JoinFS, this toolkit, the GPX converter | 96 bytes |
| **legacy-staticcg** | 26.6-beta JoinFS builds, older exports of the tools | 100 bytes (adds a static CG height) |

The toolkit **probes**: it tries each layout, and the first one that reads the whole file cleanly wins. Files that fit
none are refused with a message listing what was tried. Saving always writes the **current** layout; the static CG
height is not stored by current JoinFS, so older files lose that one value (a notice tells you). This does not shift
altitudes.

Everything else in a recording is kept: position, attitude, velocity, angular velocity, acceleration, control
positions, state flags, and the gear/flaps/light and other variable frames. Not kept: non-aircraft objects
(scenery) are not preserved.

Details and the reasoning are in `docs/format-notes.md` in the repository.

## GPX import

A `.gpx` file needs timestamps (a replay needs time). The converter dialog lets you choose the aircraft (ICAO type,
callsign, livery, FS2024 or other) and the conversion options, and derives attitude, speed, ground contact and gear,
flaps and lights from the track. Its result becomes a normal track you can move, trim and save with the others.

The converter is the separate
[joinfs-gpx-to-jfs-webcomponent](https://github.com/joeherwig/joinfs-gpx-to-jfs-webcomponent), included unchanged in
`src/vendor/`.

## Formats are modules

Import and export formats register themselves in a registry (`src/formats/`); the app never reads bytes itself. Adding
a format (for example a future JFS2) means adding a module. See [Plugin Concept](Plugin-Concept).
