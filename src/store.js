// Shared application state (PLAN.md Step 2/5). <jfs-map> and <jfs-timeline> each get a reference
// to the same Store instance (assigned as a property, not an attribute) and communicate only
// through it and its events - never directly with each other.

import { setTrackOffset, removeTrack as removeTrackFromProject } from './project-model.js';
import { History } from './history.js';

const EVENTS = ['tracks-changed', 'time-changed', 'playing-changed', 'selection-changed', 'history-changed'];

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
    // Plugin contributions (PLAN-v2.md §3.5): drag vetoes and timeline layers are registered through the plugin host
    this.plugins = null; // the PluginHost, set by the app once created
    this.rangeProviders = new Set();
    this.dragGuards = new Set();
    this.timelineLayers = new Set();
    this.history = new History({
      onChange: () => {
        this._emit('history-changed', { canUndo: this.history.canUndo, canRedo: this.history.canRedo });
        // a command may have changed anything (plugin data included), so views redraw
        this._emit('tracks-changed', { tracks: this.project.tracks });
      },
    });
  }

  _emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  addTracks(tracks) {
    for (const t of tracks) if (!t.ext) t.ext = {}; // plugin-owned data, kept while the plugin is off
    this.project.tracks.push(...tracks);
    this._emit('tracks-changed', { tracks: this.project.tracks });
  }

  /** Runs an undoable command (`{ label, do(), undo() }`); the one way plugins and edits change the project. */
  exec(command) { return this.history.exec(command); }
  undo() { return this.history.undo(); }
  redo() { return this.history.redo(); }

  /** False when any plugin vetoes moving this track (e.g. pin). */
  canDrag(track) {
    for (const guard of this.dragGuards) {
      try { if (guard(track) === false) return false; } catch (err) { console.warn('Drag guard failed:', err); }
    }
    return true;
  }

  /**
   * The part of a track that is shown (and will be saved), in the track's own time: { startS, endS }. Always starts
   * at the timeline's 00:00; plugins (trim) narrow it further through addRangeProvider (providers intersect).
   */
  visibleRange(track, offsetS = track.timeOffsetS) {
    // nothing before the timeline's 00:00 is saved, so nothing before it is shown: track time -offsetS is that point
    let range = { startS: -offsetS, endS: Infinity };
    for (const provider of this.rangeProviders) {
      let r = null;
      try { r = provider(track); } catch (err) { console.warn('Range provider failed:', err); }
      if (!r) continue;
      range = { startS: Math.max(range.startS, r.startS), endS: Math.min(range.endS, r.endS) };
    }
    return range;
  }

  addRangeProvider(fn) {
    this.rangeProviders.add(fn);
    this.requestRedraw();
    return () => { this.rangeProviders.delete(fn); this.requestRedraw(); };
  }

  addDragGuard(guard) { this.dragGuards.add(guard); return () => this.dragGuards.delete(guard); }

  addTimelineLayer(layer) {
    this.timelineLayers.add(layer);
    this.requestRedraw();
    return () => { this.timelineLayers.delete(layer); this.requestRedraw(); };
  }

  /** Asks the views to redraw (a plugin's draft changed). */
  requestRedraw() { this._emit('tracks-changed', { tracks: this.project.tracks }); }

  setTrackOffset(trackId, offsetS) {
    const track = this.project.tracks.find((t) => t.id === trackId);
    if (!track || track.timeOffsetS === offsetS || !this.canDrag(track)) return;
    const before = track.timeOffsetS;
    const apply = (value) => {
      setTrackOffset(this.project, trackId, value);
      this._emit('tracks-changed', { tracks: this.project.tracks, offsetChangedTrackId: trackId });
    };
    this.exec({ label: 'Move track', do: () => apply(offsetS), undo: () => apply(before) });
  }

  removeTrack(trackId) {
    const index = this.project.tracks.findIndex((t) => t.id === trackId);
    if (index < 0) return;
    const track = this.project.tracks[index];
    this.exec({
      label: 'Remove track',
      do: () => {
        removeTrackFromProject(this.project, trackId);
        if (this.selectedTrackId === trackId) this.selectTrack(null);
        this._emit('tracks-changed', { tracks: this.project.tracks });
      },
      undo: () => {
        this.project.tracks.splice(Math.min(index, this.project.tracks.length), 0, track);
        this._emit('tracks-changed', { tracks: this.project.tracks });
      },
    });
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

  /** Selects a track; clicking the selected one again clears it, unless `toggle` is false (context menu). */
  selectTrack(trackId, { toggle = true } = {}) {
    const next = toggle && this.selectedTrackId === trackId ? null : trackId;
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
