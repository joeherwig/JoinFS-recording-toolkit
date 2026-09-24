# `.jfs` format notes for this toolkit

The authoritative format spec lives in the main JoinFS repo at `JoinFS/docs/recording-protocol.md`.
This file only documents choices `src/jfs-codec.js` makes that aren't fully spelled out there, or
that this toolkit deliberately narrows for v1.

## Units

The wire format stores latitude/longitude/pitch/bank/heading in **radians** and
altitude/elevation/staticCgToGround in **metres**. `jfs-codec.js` converts to/from degrees at the
decode/encode boundary, so every other module in this app (map, timeline, project model) only ever
deals in degrees - see `DEG2RAD`/`RAD2DEG` in `src/jfs-codec.js`.

## What's preserved on a round-trip, and what isn't

- **Position, attitude (pitch/bank/heading), horizontal+vertical velocity, elevation, on-ground
  flag, static CG-to-ground**: fully decoded and re-encoded.
- **Control surfaces (rudder/elevator/aileron/brakes) and angular velocity/acceleration**: read but
  discarded - not part of this toolkit's `Track` data model (see `PLAN.md` Step 2), so they're
  always written back as zero. A JoinFS playback of a saved file will show centered control surfaces
  regardless of what the original recording had.
- **`SimEvent`/`IntegerVariables`/`FloatVariables`/`String8Variables` frames**: kept as opaque,
  byte-exact payloads (`opaquePayload`) and re-emitted unchanged except for their frame `time`
  (shifted the same way position frames are, on export). `IntegerVariables`/`FloatVariables` entries
  are *additionally* decoded (without touching the opaque bytes) into `track.events` when their
  variable id matches the fixed table in `src/variables.js` (gear/flaps/lights) - see that file's
  header comment for why only those.
- **Non-aircraft `Obj[]` records** (scenery objects): not decoded at all beyond reading `objectCount`
  to warn the user; not represented in the app; dropped entirely on save. There's no length prefix
  on this section in the format (recording-protocol.md §7.3/§8.3), so a reader that doesn't fully
  implement `Obj` frame parsing can't safely skip past it either - this is a deliberate v1 scope cut,
  not an oversight.
- **Livery**: only ever written when the user chooses the `fs2024` build-variant target at save
  time; the `other` target's 2-string tail has no livery field in the format at all, so it's not "an
  empty string" but genuinely absent.

## Reading foreign files (tail-layout ambiguity)

Per recording-protocol.md §7.1, whether a per-aircraft record ends with 0, 1, 2, or 3 trailing
strings depends on *which JoinFS build* wrote the file, and that isn't recorded anywhere in the
file itself. `detectTail()` in `src/jfs-codec.js` tries the plausible candidate counts for the
file's version and validates each by checking what should immediately follow (the next aircraft's
`plane` bool, or a sane `objectCount`). This is a heuristic, not a guarantee - if a file is
genuinely ambiguous, the toolkit surfaces a warning rather than failing silently, and readers should
sanity-check the loaded callsigns/frame counts.

## Degenerate (0,0) position frames

Some real recordings contain a frame at exactly `lat=0, lon=0` ("Null Island") - most likely an
aircraft that was armed for recording before the simulator delivered its first real position
update. This toolkit treats an exact 0,0 as a missing/invalid fix rather than a real one
(`geo.js#isValidLatLon`): such frames are excluded from the map polyline and from the bounds used to
auto-fit the map, and the playhead marker holds its last valid position instead of jumping to Null
Island when scrubbing lands on one. The frame itself is still preserved byte-for-byte on save - this
is a rendering-time filter, not a data-cleaning one.

## GPX import

GPX import embeds the real `joinfs-gpx-to-jfs-webcomponent` converter directly (vendored verbatim at
`src/vendor/joinfs-gpx-to-jfs.js`, opened in a modal by `src/components/jfs-gpx-modal.js`) rather than
reimplementing its conversion. This is a deliberate change from an earlier version of this toolkit,
which had its own much-simplified GPX importer (`src/gpx-import.js`, now removed) that only derived
position/altitude/heading/ground-speed straight from the raw `<trkpt>` elements - no ground-clamping
(so on-ground altitude could show GPS vertical noise/sinking-into-terrain), no derived attitude, and
no derived gear/flaps/lights, meaning GPX-sourced tracks had no event markers and always flew with
pitch/bank at 0. Embedding the real component gets all of that "for free" from tested upstream logic
instead. The one added cost is a modal step per GPX file (the user reviews the real component's own
form before it converts) rather than a silent, no-UI import - see `PLAN.md` Step 6b.
