# Known Limitations

What the toolkit does not do (yet), so nothing comes as a surprise.

## Saving

- **Non-aircraft objects (scenery) are not preserved.** They are not shown or edited and are not written back.
- **Livery is only kept with the FS2024 build variant.** The "other builds" tail has no livery field.
- **The static CG height is not stored.** Current JoinFS neither writes nor reads it, so older files lose that one
  value when saved (a notice tells you). Altitudes are not affected. See [Saving and Formats](Saving-and-Formats).
- **Pins are not saved.** Pin and the draft of a trim are working aids of the open page; an applied trim is carried
  out when you save. There is no project file: re-opening the saved `.jfs` is how you continue.

## Reading

- **The file layout is detected, not declared.** Older and current `.jfs` files share one version number, so the
  reader tries each layout and keeps the first that parses the whole file cleanly. A file that fits none is refused
  with a message listing what was tried; if something looks obviously wrong after loading, check the source file.

## Showing and editing

- **Event markers exist for gear, flaps and lights only.** Other recorded variables are kept and saved but do not
  produce a marker.
- **Single events cannot be edited yet.** Adding, deleting or moving gear, flaps and light events is planned as a
  plugin (see the roadmap in [Plugin Concept](Plugin-Concept#roadmap)). Today you can move, remove, pin and trim whole
  tracks.
- **A trimmed range is not marked on the map beyond hiding the cut part;** plugins have no map layer hook yet.
- **The aircraft on the map is a simple rotated arrow,** not an aircraft-type-shaped icon.
- **No Plugins dialog yet:** switching a plugin off or adding one by URL is not available in the interface.

## Replaying in JoinFS

- **Several aircraft in one replay can look wrong on websocket-fed maps.** JoinFS identifies websocket updates by the
  owner node, which replayed aircraft share, so a live map fed from the websocket may show only one of them, stop
  moving, or jump. The saved file is fine; this is a JoinFS-side issue and is not fixed by the toolkit.

## GPX and IGC

- **GPX import needs the converter dialog.** The track must carry timestamps, and you confirm aircraft and options in
  the embedded converter instead of getting a silent automatic conversion. See [Saving and Formats](Saving-and-Formats).
- **IGC logs are read as one flight per file,** with the GNSS altitude (pressure altitude for 2D fixes). The security signature
  is not checked, and no task, turn points or events are imported. The ICAO type is the generic `GLID` unless you change it.
