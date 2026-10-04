// Project/Track data model and editing operations (PLAN.md Step 2).
// A Project is just `{ tracks: Track[] }` - no persisted project format; re-opening an exported
// .jfs file IS the resume-editing workflow (see REQUIREMENTS.md).

import { formats } from './formats/index.js';

/** Sets a track's cumulative time offset (does not touch frame data - see PLAN.md Step 2). */
export function setTrackOffset(project, trackId, offsetS) {
  const track = project.tracks.find((t) => t.id === trackId);
  if (track) track.timeOffsetS = offsetS;
}

/** Removes a track from the project entirely. No undo/tombstoning in v1. */
export function removeTrack(project, trackId) {
  const i = project.tracks.findIndex((t) => t.id === trackId);
  if (i >= 0) project.tracks.splice(i, 1);
}

/**
 * Builds the export: effective times (frame.time + track.timeOffsetS), plugin transforms, then rebase to start at 0;
 * encodes the merged file with the chosen format (default: legacy .jfs, `{ buildVariant }` as option). Rebase happens only here, at
 * export time - not continuously during editing (PLAN.md Step 2).
 */
export function exportProject(project, { formatId = 'jfs-legacy', transform, ...options } = {}) {
  if (project.tracks.length === 0) throw new Error('Project has no tracks to export.');

  // 1. effective (offset-applied) copies, 2. plugin transforms (e.g. trim) on those copies, never on the live
  // project, 3. rebase so the earliest remaining frame of the result is exactly at t = 0 (a trimmed recording must not start with silence)
  let tracks = project.tracks.map((track) => {
    const times = new Float64Array(track.frames.times.length);
    for (let i = 0; i < times.length; i++) times[i] = track.frames.times[i] + track.timeOffsetS;
    return { ...track, frames: { ...track.frames, times } };
  });
  if (transform) tracks = transform(tracks);

  let minT = Infinity;
  for (const track of tracks) {
    const times = track.frames.times;
    if (times.length && times[0] < minT) minT = times[0];
    for (let i = 1; i < times.length; i++) if (times[i] < minT) minT = times[i];
  }
  if (!Number.isFinite(minT)) throw new Error('Nothing left to export after the plugin transforms.');
  const rebase = -minT;
  if (rebase) for (const track of tracks) for (let i = 0; i < track.frames.times.length; i++) track.frames.times[i] += rebase;

  return formats.encode(formatId, tracks, options);
}
