// Shared application state (PLAN.md Step 2/5). <jfs-map> and <jfs-timeline> each get a reference
// to the same Store instance (assigned as a property, not an attribute) and communicate only
// through it and its events - never directly with each other.

import { setTrackOffset, removeTrack as removeTrackFromProject } from './project-model.js';

const EVENTS = ['tracks-changed', 'time-changed', 'playing-changed', 'selection-changed'];

export class Store extends EventTarget {
  constructor() {
    super();
    this.project = { tracks: [] };
    this.currentTimeS = 0;
    this.playing = false;
    this.playbackRate = 1;
    this.selectedTrackId = null;
    this.mapTileTheme = 'dark';
    this.appTheme = 'auto';
    this.locale = 'en';
  }

  _emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  addTracks(tracks) {
    this.project.tracks.push(...tracks);
    this._emit('tracks-changed', { tracks: this.project.tracks });
  }

  setTrackOffset(trackId, offsetS) {
    setTrackOffset(this.project, trackId, offsetS);
    this._emit('tracks-changed', { tracks: this.project.tracks, offsetChangedTrackId: trackId });
  }

  removeTrack(trackId) {
    removeTrackFromProject(this.project, trackId);
    if (this.selectedTrackId === trackId) this.selectTrack(null);
    this._emit('tracks-changed', { tracks: this.project.tracks });
  }

  setTrackVisible(trackId, visible) {
    const t = this.project.tracks.find((x) => x.id === trackId);
    if (t) { t.visible = visible; this._emit('tracks-changed', { tracks: this.project.tracks }); }
  }

  setTrackLane(trackId, lane, shown) {
    const t = this.project.tracks.find((x) => x.id === trackId);
    if (!t) return;
    if (lane === 'altitude') t.showAltitude = shown;
    if (lane === 'speed') t.showSpeed = shown;
    if (lane === 'events') t.showEvents = shown;
    this._emit('tracks-changed', { tracks: this.project.tracks });
  }

  selectTrack(trackId) {
    const next = this.selectedTrackId === trackId ? null : trackId;
    this.selectedTrackId = next;
    this._emit('selection-changed', { selectedTrackId: next });
  }

  clearSelection() {
    if (this.selectedTrackId === null) return;
    this.selectedTrackId = null;
    this._emit('selection-changed', { selectedTrackId: null });
  }

  setCurrentTime(t) {
    this.currentTimeS = Math.max(0, t);
    this._emit('time-changed', { currentTimeS: this.currentTimeS });
  }

  setPlaying(playing) {
    this.playing = playing;
    this._emit('playing-changed', { playing });
  }

  setPlaybackRate(rate) {
    this.playbackRate = rate;
  }

  projectDurationS() {
    let max = 0;
    for (const t of this.project.tracks) {
      const times = t.frames.times;
      if (times.length === 0) continue;
      const end = times[times.length - 1] + t.timeOffsetS;
      if (end > max) max = end;
    }
    return max;
  }
}
