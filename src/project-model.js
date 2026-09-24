// Project/Track data model and editing operations (PLAN.md Step 2).
// A Project is just `{ tracks: Track[] }` - no persisted project format; re-opening an exported
// .jfs file IS the resume-editing workflow (see REQUIREMENTS.md).

import { decodeJfsFile, encodeJfsFile } from './jfs-codec.js';
import { colorForTrackId } from './colors.js';

/** Decodes a .jfs ArrayBuffer into an array of Tracks ready to add to a project. */
export function tracksFromJfsBuffer(arrayBuffer, sourceFileName) {
  const { tracks, warnings } = decodeJfsFile(arrayBuffer, { sourceFileName });
  for (const t of tracks) t.color = colorForTrackId(t.id);
  return { tracks, warnings };
}

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
 * Rebases every track's frame times so the minimum effective time (frame.time + track.timeOffsetS)
 * across the whole project is >= 0, then encodes the merged .jfs file. Rebase happens only here, at
 * export time - not continuously during editing (PLAN.md Step 2).
 */
export function exportProject(project, { buildVariant = 'fs2024' } = {}) {
  if (project.tracks.length === 0) throw new Error('Project has no tracks to export.');

  let minT = Infinity;
  for (const track of project.tracks) {
    const times = track.frames.times;
    for (let i = 0; i < times.length; i++) {
      const eff = times[i] + track.timeOffsetS;
      if (eff < minT) minT = eff;
    }
  }
  const rebase = minT < 0 ? -minT : 0;

  const finalTracks = project.tracks.map((track) => {
    const times = new Float64Array(track.frames.times.length);
    for (let i = 0; i < times.length; i++) times[i] = track.frames.times[i] + track.timeOffsetS + rebase;
    return { ...track, frames: { ...track.frames, times } };
  });

  return encodeJfsFile(finalTracks, { buildVariant });
}
