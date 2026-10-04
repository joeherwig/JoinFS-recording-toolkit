// <jfs-timeline> - video-editor-style timeline: one row per aircraft track, two stacked toggleable
// lanes (altitude/speed), drag-to-shift-time, remove, wheel-zoom/Ctrl+wheel-pan, scrubber, focus/dim
// synced with <jfs-map> through the shared Store. See PLAN.md Step 5.
//
// Layout: a single scrollable region (native vertical scrollbar) holds a sticky ruler header plus a
// body row of [sidebar | canvas-wrap], so the sidebar's track rows and the canvas's drawn rows
// scroll together by construction (one scroll context, not two panes synced by hand), and the ruler
// stays visible (position: sticky) no matter how far down you've scrolled - see the fix for
// "scrollbar on the timeline, time points shown for all tracks" below.

import { buildLodPyramid, pickLodLevel, altColor, desaturate, horizontalSpeedKt, findFrameIndexAtTime } from '../geo.js';
import { t } from '../i18n.js';

const ROW_HEIGHT = 56;
const RULER_HEIGHT = 24;
const SIDEBAR_WIDTH = 190;
const MIN_PPS = 0.01, MAX_PPS = 200;

const STYLE = `
  :host { display: grid; grid-template-rows: auto 1fr; height: 100%; background: var(--panel-bg, #12141a); color: var(--fg, #e2e8f0); font: 12px/1.4 system-ui, sans-serif; overflow: hidden; }
  .transport { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--border, #262b36); }
  .transport button { background: var(--btn-bg, #1e2433); color: inherit; border: 1px solid var(--border, #262b36); border-radius: 4px; padding: 3px 8px; cursor: pointer; }
  .transport button:hover { background: var(--btn-bg-hover, #2d3748); }
  select { background: var(--btn-bg, #1e2433); color: inherit; border: 1px solid var(--border, #262b36); border-radius: 4px; }
  .time-readout { margin-left: auto; font-variant-numeric: tabular-nums; opacity: .85; }
  .scroll-area { overflow-y: auto; overflow-x: hidden; position: relative; }
  .scroll-header { position: sticky; top: 0; z-index: 2; display: flex; background: var(--panel-bg, #12141a); }
  .sidebar-header-spacer { width: ${SIDEBAR_WIDTH}px; flex: none; border-right: 1px solid var(--border, #262b36); border-bottom: 1px solid var(--border, #262b36); }
  #ruler { flex: 1; display: block; height: ${RULER_HEIGHT}px; border-bottom: 1px solid var(--border, #262b36); touch-action: none; }
  .scroll-body { display: flex; }
  .sidebar { width: ${SIDEBAR_WIDTH}px; flex: none; border-right: 1px solid var(--border, #262b36); }
  .row { height: ${ROW_HEIGHT}px; box-sizing: border-box; display: flex; align-items: center; gap: 6px; padding: 0 6px; border-bottom: 1px solid var(--border, #1c2129); cursor: pointer; }
  .row.selected { background: rgba(255,255,255,.06); }
  .row .swatch { width: 10px; height: 10px; border-radius: 2px; flex: none; }
  .row .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row .lane-toggle { font-size: 10px; padding: 1px 4px; border-radius: 3px; border: 1px solid var(--border, #262b36); background: transparent; color: inherit; cursor: pointer; opacity: .55; }
  .row .lane-toggle.on { opacity: 1; }
  .row .remove-btn { border: none; background: transparent; color: #f87171; cursor: pointer; font-size: 14px; line-height: 1; padding: 2px 4px; }
  .canvas-wrap { position: relative; flex: 1; }
  canvas { display: block; touch-action: none; }
  #fx { position: absolute; left: 0; top: 0; }
  .empty-hint { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--muted, #6b7280); text-align: center; padding: 20px; pointer-events: none; }
`;

export class JfsTimeline extends HTMLElement {
  constructor() {
    super();
    this._root = this.attachShadow({ mode: 'open' });
    this._root.innerHTML = `
      <style>${STYLE}</style>
      <div class="transport">
        <button id="playBtn" title="${t('timeline.playPause')}" aria-label="${t('timeline.playPause')}">▶</button>
        <select id="rateSel">
          ${[0.5, 1, 2, 5, 10, 25, 50].map((r) => `<option value="${r}" ${r === 1 ? 'selected' : ''}>${r}x</option>`).join('')}
        </select>
        <button id="zoomOut" title="${t('timeline.zoomOut')}" aria-label="${t('timeline.zoomOut')}">−</button>
        <button id="zoomIn" title="${t('timeline.zoomIn')}" aria-label="${t('timeline.zoomIn')}">+</button>
        <span class="time-readout" id="timeReadout">0:00</span>
      </div>
      <div class="scroll-area" id="scrollArea">
        <div class="scroll-header">
          <div class="sidebar-header-spacer"></div>
          <canvas id="ruler"></canvas>
        </div>
        <div class="scroll-body">
          <div class="sidebar" id="rows"></div>
          <div class="canvas-wrap" id="canvasWrap" title="${t('timeline.zoomHint')}">
            <canvas id="bg"></canvas>
            <canvas id="fx"></canvas>
            <div class="empty-hint" id="emptyHint">${t('toolbar.noTracks')}</div>
          </div>
        </div>
      </div>
    `;
    this._scrollArea = this._root.getElementById('scrollArea');
    this._rowsEl = this._root.getElementById('rows');
    this._canvasWrap = this._root.getElementById('canvasWrap');
    this._ruler = this._root.getElementById('ruler');
    this._bg = this._root.getElementById('bg');
    this._fx = this._root.getElementById('fx');
    this._emptyHint = this._root.getElementById('emptyHint');
    this._timeReadout = this._root.getElementById('timeReadout');
    this._store = null;
    this._pixelsPerSecond = 5;
    this._scrollTimeS = 0;
    this._lod = new Map(); // trackId -> { alt: pyramid, speed: pyramid }
    this._drag = null;
    this._rafHandle = null;
    this._needsFullDraw = true; // see _scheduleDraw()
    this._lastRafTs = null;
    this._lastSizeKey = ''; // "width,height" - resize (which clears canvases) only runs when this changes
    this._didInitialFit = false; // whether the one-time "zoom to fit all tracks on first load" has run yet

    this._root.getElementById('playBtn').addEventListener('click', () => this._togglePlay());
    this._root.getElementById('rateSel').addEventListener('change', (e) => this._store && this._store.setPlaybackRate(parseFloat(e.target.value)));
    this._root.getElementById('zoomOut').addEventListener('click', () => this._zoomAround(this._canvasWrap.clientWidth / 2, 0.5));
    this._root.getElementById('zoomIn').addEventListener('click', () => this._zoomAround(this._canvasWrap.clientWidth / 2, 2));

    this._canvasWrap.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    this._ruler.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    this._fx.addEventListener('pointerdown', (e) => this._onRowPointerDown(e));
    this._ruler.addEventListener('pointerdown', (e) => this._startScrubberDrag(e));
  }

  set store(store) {
    this._store = store;
    store.addEventListener('tracks-changed', () => {
      this._invalidateAll();
      this._renderRows();
      this._maybeFitAllTracks();
      this._resizeAndDraw();
    });
    store.addEventListener('time-changed', () => this._scheduleDraw(true));
    store.addEventListener('selection-changed', () => { this._renderRows(); this._scheduleDraw(); });
    store.addEventListener('playing-changed', ({ detail }) => this._onPlayingChanged(detail.playing));
    this._renderRows();
    this._maybeFitAllTracks();
    this._resizeAndDraw();
  }

  get store() { return this._store; }

  connectedCallback() {
    this._resizeObserver = new ResizeObserver(() => this._resizeAndDraw());
    this._resizeObserver.observe(this._scrollArea);
    this._resizeAndDraw();
  }

  disconnectedCallback() {
    if (this._resizeObserver) this._resizeObserver.disconnect();
    if (this._rafHandle) cancelAnimationFrame(this._rafHandle);
  }

  // ---- playback -------------------------------------------------------

  /** Public entry point so joinfs-recorder-toolkit.js can trigger this from the global Space hotkey. */
  togglePlay() { this._togglePlay(); }

  _togglePlay() {
    if (!this._store) return;
    this._store.setPlaying(!this._store.playing);
  }

  _onPlayingChanged(playing) {
    this._root.getElementById('playBtn').textContent = playing ? '⏸' : '▶';
    if (playing) { this._lastRafTs = null; this._tickPlayback(); }
  }

  _tickPlayback() {
    if (!this._store || !this._store.playing) return;
    const now = performance.now();
    const dt = this._lastRafTs ? (now - this._lastRafTs) / 1000 : 0;
    this._lastRafTs = now;
    const next = this._store.currentTimeS + dt * this._store.playbackRate;
    const duration = this._store.projectDurationS();
    if (next >= duration) {
      this._store.setPlaying(false);
      this._store.setCurrentTime(0); // back to start, ready to replay
      return;
    }
    this._store.setCurrentTime(next);
    requestAnimationFrame(() => this._tickPlayback());
  }

  // ---- LOD cache --------------------------------------------------------

  _invalidateAll() { this._lod.clear(); }

  // ---- initial zoom-to-fit -------------------------------------------------
  // "Initial zoom should show all timelines in full" - fits pixelsPerSecond so the whole project
  // duration is visible the first time tracks go from empty to non-empty (mirrors <jfs-map>'s
  // fitBounds-on-track-set-change, but only on that first load, not on every later add/remove, so
  // it doesn't fight a zoom level the user has since chosen deliberately).

  _maybeFitAllTracks() {
    if (!this._store) return;
    const tracks = this._store.project.tracks;
    if (tracks.length === 0) { this._didInitialFit = false; return; }
    if (this._didInitialFit) return;
    this._didInitialFit = true;
    this._fitAllTracks();
  }

  _fitAllTracks() {
    const duration = this._store.projectDurationS();
    const width = this._canvasWrap.clientWidth;
    if (duration > 0 && width > 0) {
      this._pixelsPerSecond = Math.min(MAX_PPS, Math.max(MIN_PPS, width / duration));
    }
    this._scrollTimeS = 0;
  }

  _lodFor(track) {
    let cached = this._lod.get(track.id);
    if (cached && cached.frameCount === track.frames.times.length) return cached;
    const times = track.frames.times;
    const n = times.length;
    const speed = new Float32Array(n);
    for (let i = 0; i < n; i++) speed[i] = horizontalSpeedKt(track.frames.vX[i], track.frames.vZ[i]);
    const altFt = new Float32Array(n);
    for (let i = 0; i < n; i++) altFt[i] = track.frames.alt[i] * 3.28084;
    cached = {
      frameCount: n,
      alt: buildLodPyramid(times, altFt),
      speed: buildLodPyramid(times, speed),
    };
    this._lod.set(track.id, cached);
    return cached;
  }

  // ---- sidebar rows -------------------------------------------------------

  _renderRows() {
    if (!this._store) return;
    const tracks = this._store.project.tracks;
    this._emptyHint.style.display = tracks.length === 0 ? 'flex' : 'none';
    this._rowsEl.innerHTML = '';
    tracks.forEach((track) => {
      const row = document.createElement('div');
      row.className = 'row' + (this._store.selectedTrackId === track.id ? ' selected' : '');
      row.innerHTML = `
        <span class="swatch" style="background:${track.color}"></span>
        <span class="name" title="${track.callsign || track.model}">${track.callsign || track.model || track.id}</span>
        <button class="lane-toggle ${track.showAltitude ? 'on' : ''}" data-lane="altitude">ALT</button>
        <button class="lane-toggle ${track.showSpeed ? 'on' : ''}" data-lane="speed">SPD</button>
        <button class="lane-toggle ${track.showEvents ? 'on' : ''}" data-lane="events" title="${t('timeline.eventsTitle')}">EVT</button>
        <button class="remove-btn" title="${t('timeline.remove')}">×</button>
      `;
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-lane]') || e.target.closest('.remove-btn')) return;
        this._store.selectTrack(track.id);
      });
      const LANE_FIELD = { altitude: 'showAltitude', speed: 'showSpeed', events: 'showEvents' };
      row.querySelectorAll('[data-lane]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const lane = btn.dataset.lane;
          this._store.setTrackLane(track.id, lane, !track[LANE_FIELD[lane]]);
        });
      });
      row.querySelector('.remove-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(t('timeline.removeConfirm'))) this._store.removeTrack(track.id);
      });
      this._rowsEl.appendChild(row);
    });
  }

  // ---- zoom / pan -------------------------------------------------------

  _onWheel(e) {
    e.preventDefault();
    if (e.shiftKey) {
      // Plain wheel already means "zoom" over the canvas/ruler (confirmed behavior, see
      // REQUIREMENTS.md), so the native scrollbar never receives a plain wheel event there to
      // scroll vertically with - Shift+wheel is the escape hatch for that (dragging the native
      // scrollbar, or hovering the sidebar - which has no wheel handler - both still work too).
      this._scrollArea.scrollTop += e.deltaY;
    } else if (e.ctrlKey || e.metaKey) {
      this._scrollTimeS = Math.max(0, this._scrollTimeS + e.deltaY / this._pixelsPerSecond);
      this._scheduleDraw();
    } else {
      const rect = this._canvasWrap.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      this._zoomAround(e.clientX - rect.left, factor);
    }
  }

  _zoomAround(px, factor) {
    const tAtPx = this._scrollTimeS + px / this._pixelsPerSecond;
    this._pixelsPerSecond = Math.min(MAX_PPS, Math.max(MIN_PPS, this._pixelsPerSecond * factor));
    this._scrollTimeS = Math.max(0, tAtPx - px / this._pixelsPerSecond);
    this._keepCursorInView();
    this._scheduleDraw();
  }

  // Zooming around the mouse/button position (above) can otherwise leave the current time cursor
  // outside the new visible window (e.g. zooming in near the right edge while the cursor sits far to
  // the left) - nudge scrollTimeS just enough to bring it back into view, with a small margin so it
  // doesn't end up flush against an edge.
  _keepCursorInView() {
    if (!this._store) return;
    const width = this._canvasWrap.clientWidth;
    const visibleDuration = width / this._pixelsPerSecond;
    const margin = Math.min(visibleDuration * 0.08, 2);
    const cursor = this._store.currentTimeS;
    if (cursor < this._scrollTimeS + margin) {
      this._scrollTimeS = Math.max(0, cursor - margin);
    } else if (cursor > this._scrollTimeS + visibleDuration - margin) {
      this._scrollTimeS = Math.max(0, cursor - visibleDuration + margin);
    }
  }

  // ---- pointer input: ruler (scrub) vs. row body (drag-to-shift-time) -----
  // These now live on two different elements (#ruler is a separate, sticky element - see the class
  // header comment), so no more y-coordinate dispatching within one shared canvas.

  _startScrubberDrag(e) {
    if (!this._store) return;
    const rect = this._ruler.getBoundingClientRect();
    const scrub = (clientX) => {
      const x = clientX - rect.left;
      this._store.setCurrentTime(this._scrollTimeS + x / this._pixelsPerSecond);
    };
    scrub(e.clientX);
    const onMove = (ev) => scrub(ev.clientX);
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }

  _onRowPointerDown(e) {
    if (!this._store) return;
    const rect = this._fx.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const rowIndex = Math.floor(y / ROW_HEIGHT);
    const track = this._store.project.tracks[rowIndex];
    if (!track) return;
    this._startRowDrag(e, track.id, track.timeOffsetS);
  }

  _startRowDrag(e, trackId, startOffsetS) {
    this._drag = { trackId, startOffsetS, startX: e.clientX };
    const onMove = (ev) => {
      const dx = ev.clientX - this._drag.startX;
      this._drag.previewDx = dx;
      this._scheduleDraw();
    };
    const onUp = (ev) => {
      const dx = ev.clientX - this._drag.startX;
      const dtSeconds = dx / this._pixelsPerSecond;
      this._store.setTrackOffset(trackId, startOffsetS + dtSeconds);
      this._drag = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }

  // ---- drawing --------------------------------------------------------

  // Canvas resizing (via the .width/.height properties) always clears the canvas's contents, even
  // when reassigned to the same value - so this must only run when the size actually changes, never
  // unconditionally from every draw. Doing so unconditionally was the bug behind "timeline shows no
  // chart during playback": every 'time-changed' tick called a fxOnly draw that still resized (and
  // therefore cleared) #bg, which a fxOnly draw then never redraws.
  _resizeCanvases() {
    const width = this._scrollArea.clientWidth - SIDEBAR_WIDTH;
    const trackCount = this._store ? this._store.project.tracks.length : 0;
    const contentHeight = Math.max(trackCount * ROW_HEIGHT, this._scrollArea.clientHeight - RULER_HEIGHT);
    const key = `${width}x${contentHeight}`;
    if (key === this._lastSizeKey) return;
    this._lastSizeKey = key;

    const dpr = window.devicePixelRatio || 1;
    for (const c of [this._bg, this._fx]) {
      c.width = Math.max(1, width * dpr);
      c.height = Math.max(1, contentHeight * dpr);
      c.style.width = width + 'px';
      c.style.height = contentHeight + 'px';
      c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this._ruler.width = Math.max(1, width * dpr);
    this._ruler.height = Math.max(1, RULER_HEIGHT * dpr);
    this._ruler.style.width = width + 'px';
    this._ruler.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _resizeAndDraw() {
    this._resizeCanvases();
    this._scheduleDraw();
  }

  // `_rafHandle`-based coalescing means a caller during an already-pending frame doesn't get its own
  // rAF - so its `fxOnly` value must not simply be discarded, or a full-redraw request (e.g. zooming)
  // that arrives while a playback tick's fx-only request is already pending would be silently
  // dropped, and the pending frame (captured with fxOnly=true from that first request) would run
  // #bg-canvas-skipping forever as long as playback keeps re-triggering fx-only requests every
  // frame - this was the "can't zoom during replay" bug: pixelsPerSecond/scrollTimeS DID update,
  // #bg just never got a chance to redraw with the new values. `_needsFullDraw` accumulates across
  // every call in the same pending-frame window instead, so any full-redraw request wins.
  _scheduleDraw(fxOnly) {
    if (!fxOnly) this._needsFullDraw = true;
    if (this._rafHandle) return;
    this._rafHandle = requestAnimationFrame(() => {
      this._rafHandle = null;
      const full = this._needsFullDraw;
      this._needsFullDraw = false;
      this._drawRuler();
      if (full) this._drawBg();
      this._drawFx();
      if (this._store) {
        const curT = this._store.currentTimeS;
        const mm = Math.floor(curT / 60), ss = Math.floor(curT % 60);
        this._timeReadout.textContent = `${mm}:${String(ss).padStart(2, '0')}`;
      }
    });
  }

  _drawRuler() {
    const ctx = this._ruler.getContext('2d');
    const w = this._ruler.clientWidth;
    ctx.clearRect(0, 0, w, RULER_HEIGHT);
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.fillRect(0, 0, w, RULER_HEIGHT);
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.font = '10px system-ui, sans-serif';
    const pps = this._pixelsPerSecond;
    const visibleStart = this._scrollTimeS;
    const visibleDuration = w / pps;
    const step = this._niceStep(visibleDuration / (w / 80));
    for (let tm = Math.ceil(visibleStart / step) * step; tm < visibleStart + visibleDuration; tm += step) {
      const x = (tm - visibleStart) * pps;
      ctx.fillRect(x, RULER_HEIGHT - 6, 1, 6);
      ctx.fillText(this._fmtTime(tm), x + 3, RULER_HEIGHT - 8);
    }
  }

  _drawBg() {
    const ctx = this._bg.getContext('2d');
    const w = this._bg.clientWidth, h = this._bg.clientHeight;
    ctx.clearRect(0, 0, w, h);
    if (!this._store) return;
    const tracks = this._store.project.tracks;
    const pps = this._pixelsPerSecond;
    const visibleStart = this._scrollTimeS;
    const visibleDuration = w / pps;

    tracks.forEach((track, rowIndex) => {
      const rowTop = rowIndex * ROW_HEIGHT;
      const dim = this._store.selectedTrackId && this._store.selectedTrackId !== track.id;
      const offset = this._drag && this._drag.trackId === track.id
        ? this._drag.startOffsetS + (this._drag.previewDx || 0) / pps
        : track.timeOffsetS;
      this._drawRow(ctx, track, rowTop, visibleStart, visibleDuration, pps, dim, offset, w);
      ctx.strokeStyle = 'rgba(255,255,255,.08)';
      ctx.beginPath(); ctx.moveTo(0, rowTop + ROW_HEIGHT); ctx.lineTo(w, rowTop + ROW_HEIGHT); ctx.stroke();
    });
  }

  _niceStep(rough) {
    const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
    return steps.find((s) => s >= rough) || steps[steps.length - 1];
  }

  _fmtTime(t) {
    const mm = Math.floor(t / 60), ss = Math.floor(((t % 60) + 60) % 60);
    return `${mm}:${String(ss).padStart(2, '0')}`;
  }

  _drawRow(ctx, track, rowTop, visibleStart, visibleDuration, pps, dim, offsetOverride, canvasWidth) {
    const lod = this._lodFor(track);
    const level = pickLodLevel(lod.alt, visibleDuration, pps);
    const speedLevel = pickLodLevel(lod.speed, visibleDuration, pps);
    const laneH = ROW_HEIGHT - 4;
    const baseColor = dim ? desaturate(track.color.startsWith('#') ? this._hexToHsl(track.color) : track.color) : track.color;
    const alpha = dim ? 0.35 : 0.9;

    if (track.showAltitude && level.times.length) {
      let altMin = Infinity, altMax = -Infinity;
      for (let i = 0; i < level.min.length; i++) { if (level.min[i] < altMin) altMin = level.min[i]; if (level.max[i] > altMax) altMax = level.max[i]; }
      if (altMax === altMin) altMax = altMin + 1;
      ctx.globalAlpha = alpha * 0.55;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < level.times.length; i++) {
        const x = (level.times[i] + offsetOverride - visibleStart) * pps;
        if (x < -50 || x > canvasWidth + 50) continue;
        const yTop = rowTop + 2 + laneH * (1 - (level.max[i] - altMin) / (altMax - altMin));
        if (!started) { ctx.moveTo(x, rowTop + 2 + laneH); ctx.lineTo(x, yTop); started = true; } else ctx.lineTo(x, yTop);
      }
      if (started) {
        const lastX = (level.times[level.times.length - 1] + offsetOverride - visibleStart) * pps;
        ctx.lineTo(lastX, rowTop + 2 + laneH);
        ctx.closePath();
        ctx.fillStyle = baseColor;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    if (track.showSpeed && speedLevel.times.length) {
      let spMax = 1;
      for (let i = 0; i < speedLevel.max.length; i++) if (speedLevel.max[i] > spMax) spMax = speedLevel.max[i];
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = baseColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < speedLevel.times.length; i++) {
        const x = (speedLevel.times[i] + offsetOverride - visibleStart) * pps;
        if (x < -50 || x > canvasWidth + 50) continue;
        const y = rowTop + 2 + laneH * (1 - speedLevel.max[i] / spMax);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      if (started) ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Gated by the track's own showEvents toggle (EVT button), not focus/selection - see jfs-map.js's
    // matching change for why (markers were invisible by default since nothing starts selected).
    if (track.showEvents && track.events && track.events.length) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#f8fafc';
      for (const evt of track.events) {
        const x = (evt.timeS + offsetOverride - visibleStart) * pps;
        if (x < 0 || x > canvasWidth) continue;
        ctx.beginPath();
        ctx.moveTo(x, rowTop + 2); ctx.lineTo(x + 4, rowTop + 8); ctx.lineTo(x - 4, rowTop + 8);
        ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  _hexToHsl(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0; const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return `hsl(${Math.round(h)},${Math.round(s * 100)}%,${Math.round(l * 100)}%)`;
  }

  _drawFx() {
    const ctx = this._fx.getContext('2d');
    const w = this._fx.clientWidth, h = this._fx.clientHeight;
    ctx.clearRect(0, 0, w, h);
    if (!this._store) return;
    const x = (this._store.currentTimeS - this._scrollTimeS) * this._pixelsPerSecond;
    if (x >= 0 && x <= w) {
      ctx.strokeStyle = '#f87171';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
  }
}

customElements.define('jfs-timeline', JfsTimeline);
