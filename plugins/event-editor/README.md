# event-editor

Moves, adds and deletes the gear, flaps and light events of a track, and can force its "on ground" flag. Select a track, then right-click the track row (or use the ⋮ button) and choose **Edit gear, flaps and light events**. Press **?** for the key list.

- **Lanes:** each signal (gear, flaps, nav, beacon, landing, taxi, strobe) has a lane in the track row with state bands and markers. The timeline makes its rows taller while the editor is open (`ui.requestRowHeight`); the timeline's **↕+** / **↕−**, Alt + wheel over the chart, or Shift + wheel over the track names can change it further.
- **Touch and mouse:** tap/click a marker to select it, drag to move it; tap empty space to move the playhead. The dock panel (top right; full width on phones) has the event list, add at playhead, delete, nudge ±0.1 s / ±1 s, a time field and undo / redo for the draft. Buttons are at least 44 px.
- **No no-op events:** a channel is a list of state changes. Only values that differ from the state at the playhead can be added; moving stops at the neighbours of the same lane; events that become redundant after an add or delete are removed (with a message). Rules: `src/track-variables.js`.
- **Force on ground:** sets bit 0 of `groundFlags` on every position frame. The imported flags are kept in `track.ext.forceOnGround.original` and come back when unchecked. Altitude is not touched (see `ground-height` for terrain).
- **Done** applies the draft as one undoable command (events and ground flag together); **Cancel** / Esc discards it. Nothing changes in the track before Done.
- On save, the recording's own refresh frames are kept and rewritten to the edited state; new variable frames are added only where an event has none.

- Host API used: `variables`, `ui.registerTimelinePointer`, `ui.registerTimelineLayer({ replacesEvents })`, `ui.requestRowHeight`, `ui.registerTrackAction`, `ui.openModal` (help), `shortcuts` (`first`), `time`, `exec`.
- Keys: Del / ⌫ delete, ← → nudge 0.1 s (Shift 1 s), ↑ ↓ select previous / next, Enter focus the add buttons, ? help, Esc cancel. The same list fills the help dialog (`SHORTCUTS` in `editor.js`).
- Strings: `locales/en.json`, `locales/de.json` (same keys and placeholders; checked by the tests).
- Tests: `node --test plugins/event-editor/test/event-editor.test.js`, core rules `node --test test/track-variables.test.js`.
