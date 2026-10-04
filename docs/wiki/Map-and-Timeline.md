# Map and Timeline

![Map and timeline with three tracks](images/overview-dark.png)

## Map

- **Path colour:** altitude, in steps of 500 ft; **grey** while the aircraft is on the ground. The grey is tuned per
  map layer so it stays readable.
- **Arrow:** the aircraft at the playhead time, rotated to its heading and coloured by altitude.
- **Event markers:** small dots where gear, flaps or lights changed; hover for the text ("Gear: Down"). They can be
  switched off per track with the **EVT** button on the timeline.
- **Legend** (bottom right): one entry per track; click to select.
- **Layer button** (top right, or press **L**): cycles *Dark → Light (OSM) → Satellite*. See
  [Language and Theme](Language-and-Theme#map-layer).
- The map zooms to all tracks when you add or remove tracks, not on every change.
- Positions at exactly 0/0 (some recordings have a placeholder before the first real fix) are ignored.

Zoom with the wheel or the +/− buttons; drag to pan.

## Timeline

One row per track. The left column shows the colour, the callsign, the lane buttons and a remove button; the right
side is the chart.

| Element | What it does |
|---|---|
| ▶ / **Space** | play and pause; at the end it jumps back to the start |
| speed (0.5x … 50x) | playback speed |
| − / + | zoom the time axis |
| ⋮ | the track actions menu for the selected track (or the only track); see [Editing Tracks](Editing-Tracks) |
| time readout | the playhead time |
| ruler | click or drag to scrub the playhead |
| **ALT** / **SPD** / **EVT** | show or hide the altitude chart, the speed line, the event markers of that track |
| × | remove the track (asks first; undoable) |

Gestures on the chart:

- **wheel:** zoom around the pointer; **Ctrl + wheel:** pan; **Shift + wheel:** scroll the rows vertically (when
  there are more rows than fit)
- **drag a row:** move that track in time (see [Editing Tracks](Editing-Tracks))
- touch devices work with the same drags

The timeline starts at **00:00**. What lies before it is not shown and is not saved.

## Selection and focus

Selecting a track dims all others on both the map and the timeline. Select the same track again, click an empty
spot on the map, or press **Esc** to clear.
