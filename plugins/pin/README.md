# pin

Locks a track in time. Right-click the track row (or use the ⋮ button in the timeline header) and choose **Pin / unpin track**. A pinned track shows a pin marker on its
timeline row and cannot be dragged (its time offset cannot change), which protects a reference track while the others
are lined up against it. Toggling is undoable (Ctrl+Z).

- State: `track.ext.pin` (kept while the plugin is off, not written into the recording).
- Host API used: `tracks.registerDragGuard`, `ui.registerTimelineLayer`, `ui.registerTrackAction`, `exec`.
- Strings: `locales/en.json`, `locales/de.json`.
- Tests: `node --test plugins/pin/test`.
