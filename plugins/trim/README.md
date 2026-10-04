# trim

Cuts the start and end off a track without changing it. Select a track, then right-click the track row (or use the ⋮ button in the timeline header) and choose **Trim track…**. A floating dialog over the map
offers start and end (seconds from the start of the recording), **Start = playhead**, **End = playhead**,
**Reset**, **Cancel** and **Apply**. The timeline shades what will be cut; Apply is one undoable command.

The cut happens when saving (export transform, runs before the shared rebase, so the saved file starts at 0). JoinFS
writes gear, flaps, lights and strings only when they change, so the plugin writes the last value of every variable
seen before the new start again as one frame per kind at the start; the replay then begins in the right state.
Simulator events before the start are dropped.

- State: `track.ext.trim = { startS, endS }` in the recording's own time; it follows the track when it is moved.
- Host API used: `ui.openDialog`, `ui.registerTimelineLayer`, `ui.registerTrackAction`, `io.registerExportTransform`, `time`, `exec`.
- Not shown yet: the trimmed range on the map.
- Strings: `locales/en.json`, `locales/de.json`.
- Tests: `node --test plugins/trim/test`.
