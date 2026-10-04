# JoinFS-recording-toolkit — architecture, formats and implementation plan

Repo: `joeherwig/joinfs-jfs-toolkit` is **renamed to `JoinFS-recording-toolkit`**; all work continues on a long-lived branch **`rework-architecture`**, where the plugin architecture comes first, before the remaining features and fixes. Saved after approval as `PLAN-v2.md` in the repo root (companion to `PLAN.md` v1, `REQUIREMENTS.md`). The GPX converter (`joinfs-gpx-to-jfs-webcomponent`) stays its own repo; its engine is consumed by this repo.

## 1. Goals
1. Recordings written by the toolkit and the GPX converter load and replay in **current JoinFS** (upstream main / protocol-updated, #181).
2. The toolkit opens every `.jfs` in the wild and can follow JoinFS format changes (JFS2, tuduce/JoinFS#190) by adding a module, not by changing the app.
3. Map, timeline, import and save are the **core**; editing and analysis tools are optional plugins that load automatically and are skipped if unavailable; the core still views, plays and saves with all plugins off.
4. Keyboard shortcuts never interfere with typing (Space/L etc. ignored in any text-entry context, including the GPX converter's form).

## 2. Format facts
- Legacy `.jfs` is now **two layouts under one version number**: #181 (upstream main `JfsFrames.cs`) removed the 4-byte `staticCgToGround` from the aircraft position frame but kept `FileVersion = 21008`.
  Position frame = 9-byte header + **87-byte payload (96 total)** in current JoinFS; **91-byte payload (100 total)** in 26.6-beta files (Sim.VERSION 21008/21009) and our old exports. Tail strings differ by build (FS2024: livery, icaoType, icaoAirline; other: icaoType, icaoAirline).
  The version cannot tell the layouts apart → readers **probe**, writers target the current layout. (Cause of "Unrecognized frame type 114 at byte offset 149".)
- **Ground clearance:** JoinFS corrects altitude by `localClearance − senderClearance` (`Sim.AircraftUpdate.cs`). Current JoinFS cannot read the field from a file, so sender clearance is 0, equal to the converter's old default (`groundClearanceM: 0`, altitude = contact point, ground-clamped). Dropping the field from converter/toolkit output therefore adds **no jitter or elevation error**; only the `null` (no correction) and non-zero options are lost, which current JoinFS cannot honor anyway. The value stays in the neutral model and in the JFS2 writer.
- JFS2 (#190 draft): magic `JFS2`, length-framed records `time f64 | objectId u32 | messageClass u8 | schemaVersion u8 | length u32 | payload` reusing JFP2 codecs (Position v1 103 B incl. controls, angular data, staticCg, state flags; Identity; VariableSync; Event); unknown records skippable.
- Any JoinFS-side version bump for the two legacy layouts must be ≥21010 (21009 is taken).

## 3. Architecture: one neutral model, modules at the edge
```
 formats (plugins)                        core                        tools (plugins, later)
 formats-jfs-legacy ─decode─┐                                         pin · trim
 formats-jfs2       ─decode─┤                                         event-editor
 formats-gpx (engine) ──────┼─► neutral Project/Track ─► map          analytics (+ai)
                            │   history · Host API v1     timeline
 formats-jfs-legacy ◄encode─┤   shortcuts · gestures
 formats-jfs2       ◄encode─┘   import/save dialogs
 export pipeline: tool transforms → rebase → format.encode
```
Rules: core = model, formats registry, map, timeline, history, gestures, shortcuts, import/save, plugin host. **Formats never leak into the app**, plugins see only the versioned Host API (never components or each other), a failing plugin is disabled with a warning, byte layouts are pinned by **shared golden fixtures**. Every module: responsive (container queries, ≥44 px touch targets), all strings through `t()` with its own `en`+`de` locale, colors only via theme tokens, every drag has a precise button/keyboard alternative.

### 3.1 Neutral model (`src/model/`)
`Track`: `id, objectId, isAircraft, isPlane, typeRole`; `identity{callsign, nickname, model, livery, icaoType, icaoAirline, registration, flightNumber, classCode, classCodeConfirmed, wtc}`; `timeOffsetS, visible, show*, color`; `sourceFormat, sourceVersion, sourceLayout`;
`positions` (columnar typed arrays): `times, lat, lon, alt, pitch, bank, heading, vX..vZ, angVX..Z, accX..Z, rudder, elevator, aileron, brakeL, brakeR, elevation, staticCgToGround (NaN if the source has none), stateFlags(OnGround|ElevCorr|UserCtl|Paused)`;
`variables`: sorted `[{timeS, vuid, kind:'i32'|'f32'|'str', value, srcFrame}]` (typed, decoded; `srcFrame` = origin frame, null once edited); `simEvents`; `unknownRecords` (byte-exact passthrough); `ext{[pluginId]: any}` (plugin-owned, preserved while the plugin is off).
Derived, never persisted: `events[]` (gear/flaps/lights changes) computed from `variables`. Controls and angular data are now preserved (v1 discarded them).

### 3.2 Format plugin contract
`registerFormat({ id, label, extensions, sniff(u8)→score, decode(buf, opts)→{tracks, warnings}, encode(tracks, opts)→Uint8Array, saveOptions, capabilities })`.
- **Import:** all `sniff`s run, highest score wins; the user just drops a file (`.jfs`/`.gpx`).
- **Save:** dialog lists formats and options and warns about data loss from `capabilities`; last choice remembered; default = legacy **current** layout.
- `formats-jfs-legacy`: `decode` probes layouts `current` (87-byte) and `legacy-staticcg` (91-byte) × tail variants (0–3 strings); the first candidate that parses the **whole** file cleanly wins (valid frame types, non-decreasing times, tail validation, sane objectCount, exact EOF); else an error lists what was tried; `detectedLayout` shown as an info chip. `encode` writes version 21008, 96-byte frames, no staticCg (capability warning "static CG height not stored by current JoinFS"); `buildVariant` FS2024/other stays a save option. Variable frames are always rebuilt from typed `variables` (grouped by `(timeS, srcFrame)`, so unedited files re-encode byte-identical).
- `formats-jfs2`: 1:1 port of C# `PositionV1/IdentityV1/VariableSyncV1/EventV1`; import on, export experimental until JoinFS ships a JFS2 recorder.
- `formats-gpx`: `sniff` on `.gpx`; `decode` opens the converter's own form in a dialog and returns the neutral track from `Gpx2Jfs.convertToTrack` (no byte round trip). Converter vendored verbatim, loaded lazily on first GPX.

### 3.3 GPX converter (separate repo) — engine / writer / UI split
- New `Gpx2Jfs.convertToTrack(gpxText, options, DomParser) → { track, info }` (engine: parse → resample → derive → systems); `convert()` = `convertToTrack` + writer, existing behavior unchanged.
- Writer `writeLegacyCurrent`: version 21008, 96-byte frames, no staticCgToGround, `fs2024` selector kept, `format` option (`jfs-legacy` now, `jfs2` later). `groundClearanceM` is no longer written into legacy files (see §2) but stays an engine value for JFS2.
- `converted` event detail gains `track` next to `blob`/`filename`.

### 3.4 Shared golden fixtures
`test/fixtures/`: 96-byte frame hex from `JoinFS/JfsFrames.cs`, an old 100-byte file, a 96-byte file shaped like `2026-10-04_130738_D-HXFS.jfs`, both tail families, later JFS2 files. Used by the toolkit's format tests and the converter's tests (decoder helper, `tools/reference/gpx2jfs.py`); proposed for `JoinFS.Tests`. Property tests: neutral → encode → decode round trip; converter writer bytes decode identically to the toolkit encode of the same track (checked in this repo against the vendored converter).

### 3.5 Plugin host (Host API v1)
- Package `plugins/<id>/{manifest.json, index.js, locales/en.json, locales/de.json, test/, README.md}`; declarative manifest (id, version, `apiVersion`, `activation: onStartup|onAction|onTrackLoad`, contributions: track actions, edit modes, shortcuts, export transforms) so menus render without loading plugin code; export-transform plugins are always activated before a save.
- **Tolerant loading, no registration or index file:** `src/plugins/known.js` holds one constant list of the known first-party plugin ids. At startup the host tries to load every one of them (`fetch plugins/<id>/manifest.json`, then dynamic `import()` of `index.js` per the activation rule). A plugin that is not delivered or cannot run is simply not used:
  - missing folder/404, invalid JSON, unsupported `apiVersion`, import error, or an exception in `activate()` → caught per plugin, `console.warn` with the URL and the reason, shown as "unavailable (reason)" in the Plugins dialog, its contributions are never registered; the other plugins and the core are unaffected.
  - Slim builds just delete plugin folders; nothing else to edit. Adding a first-party plugin = add its folder and one id to `known.js` (a test checks that every folder under `plugins/` is listed there, so it cannot be forgotten).
  - Loads run in parallel and the app does not wait for them to open; menus fill in as manifests arrive.
- **Everything that loads is on by default**; a manifest can set `"defaultEnabled": false` (e.g. `analytics-ai`). Users opt out/in per plugin in the Plugins dialog (`localStorage`) or with `?plugins=-id,+id`.
- **Third-party/extra plugins without touching the repo:** "Add plugin by URL" in the Plugins dialog (or `?plugin=https://…/manifest.json`), remembered in `localStorage`; the host loads that manifest like a local one (trusted by the user's explicit action; same-origin restriction does not apply to ES module imports with CORS).
- No build step for the app itself; first-party plain ES modules.
- API: read-only `ctx.tracks`; **`ctx.exec(command)` is the only mutation path (undoable)**; `ctx.ext`; `ctx.selection`; `ctx.time`; `ctx.shortcuts.register`; `ctx.ui.{registerTrackAction, registerEditMode, registerTimelineLayer, registerMapLayer, openDialog, toast, confirm}`; `ctx.io.{registerFormat, registerExportTransform}`; `ctx.i18n.t`; `ctx.tokens()`; `ctx.gestures`; `ctx.config`. Every call is try/catch-wrapped; `test/helpers/fake-host.js` runs plugin tests under `node --test`.

### 3.6 Keyboard shortcuts (bug fix + service)
Cause of "Space blocks typing in the GPX import": `app.js` checks `e.target.tagName` on `window`, but the converter form lives in nested shadow roots, so the listener sees only the outer host `DIV`, not the inner `INPUT`. The same flaw exists for `L` in `jfs-map.js`.
- New `src/shortcuts.js`: one registry (`register({key, mods, when, run})`) and one pure `isTypingContext(event)`: uses `event.composedPath()[0]` (and walks the path), true for `input`, `textarea`, `select`, `[contenteditable]`, `[role=textbox|combobox|searchbox|spinbutton]`, any element inside an open modal `<dialog>`, and for `button`/`a`/`summary`/`[role=button]` when the key is Space or Enter (they own that key); also ignores `event.isComposing` and key repeat where relevant. Space/L/Esc/Ctrl+S/Ctrl+O all go through it (Ctrl+S/O stay allowed in inputs but not while an import dialog is open).
- `app.js` and `jfs-map.js` register their keys here; plugins use `ctx.shortcuts` so they inherit the rule. Pure-function tests with synthetic composed paths; Playwright test: open the GPX import, type "a b c" in the callsign field, the field gets the spaces and playback does not toggle.

### 3.7 Plugins on top (later phases)
`pin` (tracer bullet, `track.ext.pin`, `canDrag` veto), `trim` (non-destructive `track.ext.trim`, export transform seeds the last value of every variable at the new start), `event-editor` (add/delete/lasso/move gear, flaps, lights by editing typed `variables`; heartbeat repeats and the lights bitmask are rewritten; export rebuilds variable frames so JoinFS replays the edits), `analytics` (phases, block/air time, climb/cruise/descent, bundled airport data) and optional `analytics-ai` (opt-in, bring-your-own key, off by default). Entry point: a core Track Actions menu built from plugin manifests; edit modes are non-modal with a mode bar (Cancel reverts to a history checkpoint).

### 3.8 Core timeline and touch (later phase)
`clampScroll` (≤75 % of the visible width past the end, small margin before the start), overview scrollbar showing position and zoom, touch pinch-to-zoom (trackpad pinch stays parked), vertical overflow hints, tappable event markers on map and timeline.

## 4. Implementation steps
**Step A — Repo and branch (first)**
1. Rename the GitHub repo `joinfs-jfs-toolkit` → `JoinFS-recording-toolkit` (`gh repo rename`, **only after your explicit go**, it is outward-facing), update `origin` locally, `package.json` name, README/PLAN/REQUIREMENTS titles and links, the converter's and map component's references. Rename of the local folder is left to you (it is my working directory).
2. Create branch `rework-architecture`; all steps below are PRs into it. `main` keeps working until the branch is merged.
**Step B — Architecture first (nothing else before this)**
3. B1 neutral model + `formats-jfs-legacy` plugin shell around today's codec, no behavior change (existing tests green, byte-identical re-encode test), shim at `src/jfs-codec.js` for one release.
4. B2 command history (undo/redo, checkpoints) and `src/shortcuts.js` with `isTypingContext` (fixes the Space/L bug; app and map use it).
5. B3 plugin host (tolerant loading of the known-plugin list, manifest loader, registry, Plugins dialog, fake host, error isolation, activate-before-save) and the formats registry with sniff-based import and the save dialog with capability warnings.
**Step C — Make everything load in current JoinFS (now on the new architecture)**
6. C1 converter repo: `writeJfs` → `writeLegacyCurrent` (96-byte frame, no CG field), `convertToTrack`, tests/helpers/reference writer, README, CHANGELOG.
7. C2 `formats-jfs-legacy`: layout probe (`current`/`legacy-staticcg` × tails) and current-layout writer; shared golden fixtures; rewrite `docs/format-notes.md`.
8. C3 re-vendor the converter; `formats-gpx` plugin replaces the `jfs-gpx-modal.js` blob path.
**Step D — Remaining foundation and features**
9. F1 i18n/theme debt (hard-coded strings, canvas colors via tokens, themed confirm); gesture layer; Playwright browser tests (touch, pinch).
10. `formats-jfs2` import → export (experimental).
11. Core timeline/touch (clamp, overview bar, pinch, hints, tappable events).
12. Track Actions menu → `pin` → `trim` → `event-editor` → `analytics` → `analytics-ai`.

## 5. Verification
- `npm test` in both repos; `node --test` for codecs, model, history, shortcuts, plugin contracts and the known-list check; Playwright for gestures, shortcut-vs-input, menu target rule, tolerant plugin loading (a missing or broken plugin leaves the app fully working) and lazy loading, edit cancel/undo, save in both formats.
- Acceptance after Step C: `2026-10-04_130738_D-HXFS.jfs` loads (layout `current`), an old 26.6-beta file loads (layout `legacy-staticcg`), converter and toolkit exports are 96-byte-frame files that load and replay in current JoinFS; typing spaces in the GPX import form works.

## 6. Open points
- #190 questions: distinct versions for the two legacy layouts (≥21010) or straight to the JFS2 magic; `fileVersion` width; time-sorting; header vs payload `time/objectId` authority; home for `nickname` and UTC recording start; non-aircraft representation; extension. The draft's record header is 18 bytes, not "about 10".
- JoinFS side effect to report: the current recorder neither writes nor reads `staticCgToGround`, so recorded real flights replay with clearance 0 and gain `localClearance` (slightly high); fix needs the field back in the file (JFS2 or version bump ≥21010).
- Out of scope here: JoinFS-side version bump/tests, JFP2 recorder (#190), restoring the lost ghost-aircraft guard (`PeerTable.IsKnownOwner`) behind the duplicate replayed aircraft on the live map.
